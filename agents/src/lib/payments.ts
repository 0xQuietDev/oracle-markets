// x402 client/server glue shared by all daemons (plan §2.4 signatures).
import { wrapFetchWithPayment, x402Middleware } from "@oracle/shared/x402-lite";
import { PORTS, type Deployment } from "@oracle/shared";
import type { Hex } from "viem";
import type { RequestHandler } from "express";

export function x402Network(chainId: number): string {
  return chainId === 43113 ? "avalanche-fuji" : "anvil-local";
}

export function facilitatorUrl(): string {
  return process.env.X402_FACILITATOR ?? `http://localhost:${PORTS.facilitatorLocal}`;
}

/** fetch that transparently answers 402 challenges by signing EIP-3009 payments. */
export function makePaidFetch(deployment: Deployment, privateKey: Hex): typeof fetch {
  return wrapFetchWithPayment(fetch, {
    privateKey,
    chainId: deployment.chainId,
    usdc: deployment.contracts.usdc,
    usdcDomain: deployment.usdcDomain,
  });
}

/** x402 gate for an endpoint sold by one of our agents (vendor, validator). */
export function makeGate(
  deployment: Deployment,
  o: { payTo: `0x${string}`; priceUnits: bigint; description: string },
): RequestHandler {
  return x402Middleware({
    payTo: o.payTo,
    priceUnits: o.priceUnits,
    asset: deployment.contracts.usdc,
    network: x402Network(deployment.chainId),
    facilitatorUrl: facilitatorUrl(),
    description: o.description,
    usdcDomain: deployment.usdcDomain,
  });
}
