// x402 v1 wire protocol — FROZEN (plan §2.4). Both the server middleware (WS-B)
// and the agent payment client (WS-C) build against these shapes; they must stay
// wire-compatible with official x402-express/x402-fetch for the Fuji swap-in.
import type { Address, Hex } from "viem";

export type PaymentRequirements = {
  scheme: "exact";
  network: string;              // "avalanche-fuji" | "anvil-local"
  maxAmountRequired: string;    // USDC units, decimal string
  resource: string;             // path of the gated resource
  description: string;
  mimeType: "application/json";
  payTo: Address;
  asset: Address;               // USDC address
  maxTimeoutSeconds: number;
  extra: { name: string; version: string }; // USDC EIP-712 domain
};

export type X402Challenge = {
  x402Version: 1;
  error: "Payment required";
  accepts: PaymentRequirements[];
};

export type Eip3009Authorization = {
  from: Address;
  to: Address;
  value: string;        // decimal string
  validAfter: string;   // decimal string (unix seconds)
  validBefore: string;
  nonce: Hex;           // 32 bytes
};

export type PaymentPayload = {
  x402Version: 1;
  scheme: "exact";
  network: string;
  payload: { signature: Hex; authorization: Eip3009Authorization };
};

// X-PAYMENT header = base64(JSON.stringify(PaymentPayload))
// X-PAYMENT-RESPONSE header = base64(JSON.stringify(SettleResponse & { networkId: string }))

export type VerifyRequest = { paymentPayload: PaymentPayload; paymentRequirements: PaymentRequirements };
export type VerifyResponse = { isValid: boolean; invalidReason?: string };
export type SettleRequest = VerifyRequest;
export type SettleResponse = { success: boolean; txHash?: Hex; errorReason?: string };

export const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export function encodePaymentHeader(p: PaymentPayload): string {
  return Buffer.from(JSON.stringify(p), "utf8").toString("base64");
}
export function decodePaymentHeader(h: string): PaymentPayload {
  return JSON.parse(Buffer.from(h, "base64").toString("utf8")) as PaymentPayload;
}
