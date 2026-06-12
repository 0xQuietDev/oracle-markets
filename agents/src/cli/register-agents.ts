// Registers the six fleet agents in the IdentityRegistry (plan §5/C5):
//   worker, validator, bettorRep, bettorSkeptic, bettorMirror, vendor
// agentURI = http://localhost:8402/.well-known/agents/<name>.json
//
// Side effects:
//   1. PATCHes the deployment JSON in place ($ORACLE_DEPLOYMENT or
//      deployments/local.json): agents = { name: { address, agentId } }.
//   2. Writes the six registration JSONs to server/static/well-known/agents/
//      (shape per plan §5.6 / DESIGN §8.3 common).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { IDENTITY_REGISTRY_ABI, PORTS, type Deployment } from "@oracle/shared";
import { makeClients, type Role } from "../lib/chain.js";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url)); // agents/src/cli -> repo root
const WELL_KNOWN_DIR = join(REPO_ROOT, "server", "static", "well-known", "agents");

const FLEET: { role: Exclude<Role, "client">; file: string; name: string; description: string }[] = [
  {
    role: "worker",
    file: "worker",
    name: "ORACLE Worker",
    description: "Autonomous worker agent. Accepts tasks by self-staking USDC on its own success, buys inputs and validation over x402, and delivers machine-checkable code.",
  },
  {
    role: "validator",
    file: "validator",
    name: "ORACLE Validator",
    description: "Deterministic validator agent. Sells an x402-gated evaluation intake, runs the hidden vitest harness, and posts scores to the ERC-8004 ValidationRegistry.",
  },
  {
    role: "bettorRep",
    file: "bettor-rep",
    name: "ORACLE RepBot",
    description: "Reputation-following bettor. Buys the ORACLE Trust Tuple over x402 and bets YES on workers with strong settled track records.",
  },
  {
    role: "bettorSkeptic",
    file: "bettor-skeptic",
    name: "ORACLE Skeptic",
    description: "Skeptic bettor. Bets NO against thin self-stakes and cold-start workers — the designated villain the audience roots against.",
  },
  {
    role: "bettorMirror",
    file: "bettor-mirror",
    name: "ORACLE Mirror",
    description: "Momentum bettor. Waits, reads the x402 odds feed, and follows the larger pool when the market has conviction.",
  },
  {
    role: "vendor",
    file: "vendor",
    name: "ORACLE Vendor",
    description: "Input vendor agent. Sells task inputs to the worker over x402 ($0.01 per call).",
  },
];

function deploymentPath(): string {
  return process.env.ORACLE_DEPLOYMENT
    ? resolve(process.env.ORACLE_DEPLOYMENT)
    : join(REPO_ROOT, "deployments", "local.json");
}

async function main() {
  const depPath = deploymentPath();
  const deployment = JSON.parse(readFileSync(depPath, "utf8")) as Deployment;
  const agents: Deployment["agents"] = { ...deployment.agents };
  mkdirSync(WELL_KNOWN_DIR, { recursive: true });

  for (const f of FLEET) {
    const c = makeClients(f.role, deployment);
    const agentURI = `http://localhost:${PORTS.server}/.well-known/agents/${f.file}.json`;
    const { result, request } = await c.publicClient.simulateContract({
      account: c.account,
      address: deployment.contracts.identityRegistry,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: "register",
      args: [agentURI],
    });
    const hash = await c.walletClient.writeContract(request);
    await c.publicClient.waitForTransactionReceipt({ hash });
    const agentId = Number(result);
    agents[f.role] = { address: c.account.address, agentId };
    console.log(`[register] ${f.role.padEnd(14)} agentId=${agentId} address=${c.account.address}`);

    const registration = {
      name: f.name,
      description: f.description,
      registrations: [
        {
          agentRegistry: `eip155:${deployment.chainId}:${deployment.contracts.identityRegistry}`,
          agentId,
        },
      ],
      supportedTrust: ["reputation"],
    };
    writeFileSync(join(WELL_KNOWN_DIR, `${f.file}.json`), JSON.stringify(registration, null, 2) + "\n");
  }

  const patched: Deployment = { ...deployment, agents };
  writeFileSync(depPath, JSON.stringify(patched, null, 2) + "\n");
  console.log(`[register] patched ${depPath} (agents map) and wrote ${FLEET.length} registration JSONs to ${WELL_KNOWN_DIR}`);
}

main().catch((err) => {
  console.error("[register] fatal:", err);
  process.exit(1);
});
