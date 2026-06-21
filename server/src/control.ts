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
// anvil account #0 — the UI's manual human bettor (registered as the `human` agent).
const DEFAULT_HUMAN_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

export type TemplateInfo = { template: string; file: string; fn: string; title: string };

export type Control = {
  available: boolean;
  reason?: string;
  templates: () => TemplateInfo[];
  createTask: (template: string) => Promise<{ taskId: number; txHash: Hex; deadline: number }>;
  // manual human trading
  canBet: boolean;
  humanAgentId?: number;
  humanAddress?: string;
  placeBet: (taskId: number, side: 0 | 1, amountUnits: string) => Promise<{ txHash: Hex }>;
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
  const chain = defineChain({
    id: dep.chainId,
    name: dep.chainId === 43113 ? "avalanche-fuji" : "anvil-local",
    nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
    rpcUrls: { default: { http: [dep.rpcUrl] } },
  });
  const transport = viemHttp(dep.rpcUrl);
  const publicClient = createPublicClient({ chain, transport });

  if (!worker || !validator) {
    return {
      available: false,
      reason: "agents map incomplete — run register-agents",
      templates,
      createTask: async () => {
        throw new Error("control unavailable: agents not registered");
      },
      canBet: false,
      placeBet: async () => {
        throw new Error("betting unavailable: agents not registered");
      },
    };
  }

  const key = (process.env.CLIENT_KEY ?? DEFAULT_CLIENT_KEY) as Hex;
  const account = privateKeyToAccount(key);
  const walletClient = createWalletClient({ account, chain, transport });

  // ---- human manual-trading wallet (anvil index 0 by default) ----
  const human = dep.agents.human;
  const humanKey = (process.env.HUMAN_KEY ?? DEFAULT_HUMAN_KEY) as Hex;
  const humanAccount = privateKeyToAccount(humanKey);
  const humanWallet = createWalletClient({ account: humanAccount, chain, transport });

  /** Approve OracleCore to pull USDC from a wallet, once, if under threshold. */
  async function approveUsdc(
    wallet: ReturnType<typeof createWalletClient>,
    owner: `0x${string}`,
  ): Promise<void> {
    const allowance = await publicClient.readContract({
      address: dep.contracts.usdc,
      abi: USDC_ABI,
      functionName: "allowance",
      args: [owner, dep.contracts.oracleCore],
    });
    if (allowance < BigInt(dep.params.minReward)) {
      const hash = await wallet.writeContract({
        address: dep.contracts.usdc,
        abi: USDC_ABI,
        functionName: "approve",
        args: [dep.contracts.oracleCore, maxUint256],
        account: wallet.account!,
        chain,
      });
      await publicClient.waitForTransactionReceipt({ hash });
    }
  }

  let clientApproved = false;
  async function approveOnce(): Promise<void> {
    if (clientApproved) return;
    await approveUsdc(walletClient, account.address);
    clientApproved = true;
  }
  let humanApproved = false;

  return {
    available: true,
    templates,
    canBet: !!human,
    humanAgentId: human?.agentId,
    humanAddress: human?.address,
    async placeBet(taskId: number, side: 0 | 1, amountUnits: string) {
      if (!human) throw new Error("human agent not registered — run register-agents");
      const amount = BigInt(amountUnits);
      if (amount < BigInt(dep.params.minBet)) {
        throw new Error(`below minimum bet (${dep.params.minBet} units)`);
      }
      if (!humanApproved) {
        await approveUsdc(humanWallet, humanAccount.address);
        humanApproved = true;
      }
      const { request } = await publicClient.simulateContract({
        account: humanAccount,
        address: dep.contracts.oracleCore,
        abi: ORACLE_CORE_ABI,
        functionName: "placeBet",
        args: [BigInt(taskId), BigInt(human.agentId), side, amount],
      });
      const txHash = await humanWallet.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      return { txHash };
    },
    async createTask(template: string) {
      const info = templates().find((t) => t.template === template || t.file === template);
      if (!info) throw new Error(`unknown template "${template}"`);
      await approveOnce();

      const specBytes = new Uint8Array(readFileSync(join(specsDir, info.file)));
      const specHash = keccak256(specBytes);
      const specURI = `${baseUrl}/specs/${info.file}`;
      // Reward: TASK_REWARD_USDC env (whole USDC) if set, else 100 USDC, clamped
      // to >= minReward. Keep it modest on Fuji to limit test-token spend.
      const envReward = process.env.TASK_REWARD_USDC ? BigInt(process.env.TASK_REWARD_USDC) * 1_000_000n : 100_000_000n;
      const reward = envReward >= BigInt(dep.params.minReward) ? envReward : BigInt(dep.params.minReward);
      const nowChain = (await publicClient.getBlock()).timestamp;
      const deadline = nowChain + BigInt(dep.params.bettingWindow + 600);

      // Post an OPEN job (workerAgentId = 0): worker agents browse and one
      // autonomously claims it. (Pass OPEN_WORKER=<id> to pre-assign instead.)
      const openWorker = process.env.OPEN_WORKER ? BigInt(process.env.OPEN_WORKER) : 0n;
      const { result: taskId, request } = await publicClient.simulateContract({
        account,
        address: dep.contracts.oracleCore,
        abi: ORACLE_CORE_ABI,
        functionName: "createTask",
        args: [openWorker, BigInt(validator.agentId), reward, deadline, specHash, specURI],
      });
      const txHash = await walletClient.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      return { taskId: Number(taskId), txHash, deadline: Number(deadline) };
    },
  };
}
