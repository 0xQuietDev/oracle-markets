// x402 payment middleware config — DESIGN §8.2 (values normative).
import type { Address } from "viem";
import type { Deployment } from "@oracle/shared/config";

export const X402_NETWORK_FUJI = "avalanche-fuji"; // chainId 43113
export const X402_NETWORK_LOCAL = "anvil-local";

// anvil account 8 (plan §2.3 account assignment) — env override is the real path
const DEFAULT_LOCAL_REVENUE_WALLET = "0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f" as Address;

export function networkName(chainId: number): string {
  return chainId === 43113 ? X402_NETWORK_FUJI : X402_NETWORK_LOCAL;
}

export type X402Gate = {
  payTo: Address;
  asset: Address;
  network: string;
  facilitatorUrl: string;
  usdcDomain: { name: string; version: string };
};

export function gateFromEnv(dep: Deployment): X402Gate {
  return {
    payTo: (process.env.ORACLE_REVENUE_WALLET as Address | undefined) ?? DEFAULT_LOCAL_REVENUE_WALLET,
    asset: dep.contracts.usdc,
    network: networkName(dep.chainId),
    facilitatorUrl: process.env.X402_FACILITATOR ?? "http://localhost:8405",
    usdcDomain: dep.usdcDomain,
  };
}
