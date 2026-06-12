// Deployment config loader — BINDING INTERFACE (plan §2.2/§2.3).
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Address } from "viem";

export type AgentEntry = { address: Address; agentId: number };

export type Deployment = {
  chainId: number;
  rpcUrl: string;
  deployBlock: number;
  contracts: {
    oracleCore: Address;
    usdc: Address;
    identityRegistry: Address;
    reputationRegistry: Address;
    validationRegistry: Address;
  };
  usdcDomain: { name: string; version: string };
  params: {
    minSelfStakeBps: number;
    protocolFeeBps: number;
    validatorFeeShareBps: number;
    bettingWindow: number;
    acceptWindow: number;
    disputeWindow: number;
    graceWindow: number;
    validationThreshold: number;
    minBet: string;          // USDC units as decimal string
    maxPoolPerSide: string;
    minReward: string;
  };
  agents: Record<string, AgentEntry>; // keys: worker, validator, bettorRep, bettorSkeptic, bettorMirror, vendor
};

const HERE = dirname(fileURLToPath(import.meta.url));

/** Reads $ORACLE_DEPLOYMENT (absolute or repo-relative path) or deployments/local.json. */
export function loadDeployment(): Deployment {
  const p = process.env.ORACLE_DEPLOYMENT ?? resolve(HERE, "../../deployments/local.json");
  return JSON.parse(readFileSync(resolve(p), "utf8")) as Deployment;
}

export const PORTS = {
  server: 8402,
  vendor: 8403,
  validatorIntake: 8404,
  facilitatorLocal: 8405,
} as const;

// Prices in USDC units (6 decimals) — DESIGN §8.2 + §8.3
export const PRICES = {
  odds: 1000n,            // $0.001
  trust: 5000n,           // $0.005
  trustStream: 20000n,    // $0.02 (stretch)
  vendorInput: 10000n,    // $0.01
  validatorIntake: 10000n // $0.01
} as const;

export const SERVER_URL = process.env.ORACLE_SERVER_URL ?? `http://localhost:${PORTS.server}`;
