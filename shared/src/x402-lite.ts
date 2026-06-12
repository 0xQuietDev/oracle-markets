// x402-lite — minimal, wire-compatible subset of x402-express/x402-fetch.
// Owned by WS-B (plan §2.4); exported signatures are BINDING — WS-C consumes
// wrapFetchWithPayment, the server consumes x402Middleware.
import { randomBytes } from "node:crypto";
import type { RequestHandler, Request } from "express";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  EIP3009_TYPES,
  decodePaymentHeader,
  encodePaymentHeader,
  type Eip3009Authorization,
  type PaymentPayload,
  type PaymentRequirements,
  type SettleResponse,
  type VerifyResponse,
  type X402Challenge,
} from "./x402-types.js";

export type X402MiddlewareOptions = {
  payTo: Address;
  priceUnits: bigint;
  asset: Address;
  network: string;
  facilitatorUrl: string;
  description: string;
  usdcDomain: { name: string; version: string };
};

export type WrapFetchOptions = {
  privateKey: Hex;
  chainId: number;
  usdc: Address;
  usdcDomain: { name: string; version: string };
};

function requirementsFor(o: X402MiddlewareOptions, req: Request): PaymentRequirements {
  const raw = req.originalUrl || req.url || "";
  return {
    scheme: "exact",
    network: o.network,
    maxAmountRequired: o.priceUnits.toString(),
    resource: raw.split("?")[0],
    description: o.description,
    mimeType: "application/json",
    payTo: o.payTo,
    asset: o.asset,
    maxTimeoutSeconds: 60,
    extra: { name: o.usdcDomain.name, version: o.usdcDomain.version },
  };
}

function challengeFor(o: X402MiddlewareOptions, req: Request): X402Challenge {
  return { x402Version: 1, error: "Payment required", accepts: [requirementsFor(o, req)] };
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`facilitator ${url} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Express middleware gating a route behind an x402 `exact` payment.
 * No/invalid payment -> 402 with the DESIGN §8.2 challenge body.
 * Valid payment -> facilitator /verify + /settle, sets X-PAYMENT-RESPONSE, next().
 */
export function x402Middleware(o: X402MiddlewareOptions): RequestHandler {
  return (req, res, next) => {
    const reject = () => {
      res.status(402).json(challengeFor(o, req));
    };
    (async () => {
      const header = req.header("X-PAYMENT");
      if (!header) return reject();

      let payment: PaymentPayload;
      try {
        payment = decodePaymentHeader(header);
      } catch {
        return reject();
      }
      const auth = payment?.payload?.authorization;
      if (!auth || payment.scheme !== "exact" || payment.network !== o.network) return reject();

      let value: bigint;
      try {
        value = BigInt(auth.value);
      } catch {
        return reject();
      }
      if (value < o.priceUnits) return reject();
      if (auth.to.toLowerCase() !== o.payTo.toLowerCase()) return reject();

      const now = BigInt(Math.floor(Date.now() / 1000));
      let validAfter: bigint, validBefore: bigint;
      try {
        validAfter = BigInt(auth.validAfter);
        validBefore = BigInt(auth.validBefore);
      } catch {
        return reject();
      }
      if (validAfter > now || validBefore <= now) return reject();

      const requirements = requirementsFor(o, req);
      const verify = await postJson<VerifyResponse>(`${o.facilitatorUrl}/verify`, {
        paymentPayload: payment,
        paymentRequirements: requirements,
      });
      if (!verify.isValid) return reject();

      const settle = await postJson<SettleResponse>(`${o.facilitatorUrl}/settle`, {
        paymentPayload: payment,
        paymentRequirements: requirements,
      });
      if (!settle.success) return reject();

      res.setHeader(
        "X-PAYMENT-RESPONSE",
        Buffer.from(
          JSON.stringify({ success: true, txHash: settle.txHash, networkId: o.network }),
          "utf8",
        ).toString("base64"),
      );
      next();
    })().catch((err) => {
      res.status(502).json({ error: "facilitator_unreachable", detail: String(err) });
    });
  };
}

/**
 * Wraps fetch: on a 402 challenge, signs an EIP-3009 transferWithAuthorization
 * (validAfter=0, validBefore=now+600, random 32-byte nonce) over accepts[0]
 * and retries once with the X-PAYMENT header.
 */
export function wrapFetchWithPayment(f: typeof fetch, o: WrapFetchOptions): typeof fetch {
  const account = privateKeyToAccount(o.privateKey);
  const wrapped = async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    const first = await f(input, init);
    if (first.status !== 402) return first;

    let challenge: X402Challenge;
    try {
      challenge = (await first.json()) as X402Challenge;
    } catch {
      return first;
    }
    const req = challenge?.accepts?.[0];
    if (!req || req.scheme !== "exact") return first;

    const authorization: Eip3009Authorization = {
      from: account.address,
      to: req.payTo,
      value: req.maxAmountRequired,
      validAfter: "0",
      validBefore: String(Math.floor(Date.now() / 1000) + 600),
      nonce: `0x${randomBytes(32).toString("hex")}` as Hex,
    };
    const signature = await account.signTypedData({
      domain: {
        name: o.usdcDomain.name,
        version: o.usdcDomain.version,
        chainId: o.chainId,
        verifyingContract: o.usdc,
      },
      types: EIP3009_TYPES,
      primaryType: "TransferWithAuthorization",
      message: {
        from: authorization.from,
        to: authorization.to,
        value: BigInt(authorization.value),
        validAfter: BigInt(authorization.validAfter),
        validBefore: BigInt(authorization.validBefore),
        nonce: authorization.nonce,
      },
    });
    const payload: PaymentPayload = {
      x402Version: 1,
      scheme: "exact",
      network: req.network,
      payload: { signature, authorization },
    };

    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    headers.set("X-PAYMENT", encodePaymentHeader(payload));
    const url = input instanceof Request ? input.url : input;
    return f(url, { ...(init ?? {}), headers });
  };
  return wrapped as typeof fetch;
}
