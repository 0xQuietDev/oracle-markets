// Control plane: lets the UI drive the demo (create tasks on-chain as the
// client). Kept separate from the read-only indexer/API. Uses the CLIENT_KEY
// (anvil account 1 by default) to approve USDC once and call createTask.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http as viemHttp,
  keccak256,
  maxUint256,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ORACLE_CORE_ABI, USDC_ABI } from "@oracle/shared/abi";
import type { Deployment } from "@oracle/shared/config";

// anvil account #1 (test mnemonic) — the demo "client" that posts tasks.
const DEFAULT_CLIENT_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

export type TemplateInfo = { template: string; file: string; fn: string; title: string };

export type Control = {
  available: boolean;
  reason?: string;
  templates: () => TemplateInfo[];
  createTask: (template: string) => Promise<{ taskId: number; txHash: Hex; deadline: number }>;
};

/** Enumerate spec files in static/specs as the task templates the UI can post. */
function listTemplates(specsDir: string): TemplateInfo[] {
  let files: string[];
  try {
    files = readdirSync(specsDir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  return files.map((file) => {
    let fn = "";
    let template = file.replace(/\.json$/, "");
    try {
      const j = JSON.parse(readFileSync(join(specsDir, file), "utf8")) as { fn?: string; template?: string };
      fn = j.fn ?? "";
      if (j.template) template = j.template;
    } catch {
      /* ignore malformed */
    }
    const title = fn ? fn.split("(")[0] : template;
    return { template, file, fn, title };
  });
}

export function makeControl(dep: Deployment, specsDir: string, baseUrl: string): Control {
  const templates = () => listTemplates(specsDir);

  const worker = dep.agents.worker;
  const validator = dep.agents.validator;
  if (!worker || !validator) {
    return {
      available: false,
      reason: "agents map incomplete — run register-agents",
      templates,
      createTask: async () => {
        throw new Error("control unavailable: agents not registered");
      },
    };
  }

  const key = (process.env.CLIENT_KEY ?? DEFAULT_CLIENT_KEY) as Hex;
  const account = privateKeyToAccount(key);
  const chain = defineChain({
    id: dep.chainId,
    name: dep.chainId === 43113 ? "avalanche-fuji" : "anvil-local",
    nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
    rpcUrls: { default: { http: [dep.rpcUrl] } },
  });
  const transport = viemHttp(dep.rpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ account, chain, transport });

  let approved = false;
  async function approveOnce(): Promise<void> {
    if (approved) return;
    const allowance = await publicClient.readContract({
      address: dep.contracts.usdc,
      abi: USDC_ABI,
      functionName: "allowance",
      args: [account.address, dep.contracts.oracleCore],
    });
    if (allowance < BigInt(dep.params.minReward)) {
      const hash = await walletClient.writeContract({
        address: dep.contracts.usdc,
        abi: USDC_ABI,
        functionName: "approve",
        args: [dep.contracts.oracleCore, maxUint256],
      });
      await publicClient.waitForTransactionReceipt({ hash });
    }
    approved = true;
  }

  return {
    available: true,
    templates,
    async createTask(template: string) {
      const info = templates().find((t) => t.template === template || t.file === template);
      if (!info) throw new Error(`unknown template "${template}"`);
      await approveOnce();

      const specBytes = new Uint8Array(readFileSync(join(specsDir, info.file)));
      const specHash = keccak256(specBytes);
      const specURI = `${baseUrl}/specs/${info.file}`;
      const reward = BigInt(dep.params.minReward) >= 100_000_000n ? BigInt(dep.params.minReward) : 100_000_000n;
      const nowChain = (await publicClient.getBlock()).timestamp;
      const deadline = nowChain + BigInt(dep.params.bettingWindow + 600);

      const { result: taskId, request } = await publicClient.simulateContract({
        account,
        address: dep.contracts.oracleCore,
        abi: ORACLE_CORE_ABI,
        functionName: "createTask",
        args: [BigInt(worker.agentId), BigInt(validator.agentId), reward, deadline, specHash, specURI],
      });
      const txHash = await walletClient.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      return { taskId: Number(taskId), txHash, deadline: Number(deadline) };
    },
  };
}
