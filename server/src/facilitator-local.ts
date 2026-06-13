// Mini x402 facilitator for local dev (DESIGN §8.2 fallback 4, DR-7).
// /verify: recovers the EIP-712 signer and checks value/payee/window/nonce.
// /settle: relayer submits transferWithAuthorization and waits 1 confirmation.
import express from "express";
import { pathToFileURL } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http as viemHttp,
  parseSignature,
  verifyTypedData,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadDeployment, PORTS, type Deployment } from "@oracle/shared/config";
import { USDC_ABI } from "@oracle/shared/abi";
import {
  EIP3009_TYPES,
  type SettleRequest,
  type SettleResponse,
  type VerifyRequest,
  type VerifyResponse,
} from "@oracle/shared/x402-types";

// anvil account 9
const DEFAULT_RELAYER_KEY =
  "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6" as Hex;

export function createFacilitator(
  dep: Deployment = loadDeployment(),
  relayerKey: Hex = (process.env.FACILITATOR_RELAYER_KEY as Hex | undefined) ?? DEFAULT_RELAYER_KEY,
): express.Express {
  const chain = defineChain({
    id: dep.chainId,
    name: `chain-${dep.chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [dep.rpcUrl] } },
  });
  const publicClient = createPublicClient({ chain, transport: viemHttp(dep.rpcUrl) });
  const relayer = privateKeyToAccount(relayerKey);
  const walletClient = createWalletClient({ account: relayer, chain, transport: viemHttp(dep.rpcUrl) });

  async function verify(body: VerifyRequest): Promise<VerifyResponse> {
    const { paymentPayload: p, paymentRequirements: r } = body;
    const a = p.payload.authorization;

    let sigOk = false;
    try {
      sigOk = await verifyTypedData({
        address: a.from,
        domain: {
          name: r.extra.name,
          version: r.extra.version,
          chainId: dep.chainId,
          verifyingContract: r.asset,
        },
        types: EIP3009_TYPES,
        primaryType: "TransferWithAuthorization",
        message: {
          from: a.from,
          to: a.to,
          value: BigInt(a.value),
          validAfter: BigInt(a.validAfter),
          validBefore: BigInt(a.validBefore),
          nonce: a.nonce,
        },
        signature: p.payload.signature,
      });
    } catch {
      sigOk = false;
    }
    if (!sigOk) return { isValid: false, invalidReason: "invalid_signature" };
    if (BigInt(a.value) < BigInt(r.maxAmountRequired)) return { isValid: false, invalidReason: "insufficient_value" };
    if (a.to.toLowerCase() !== r.payTo.toLowerCase()) return { isValid: false, invalidReason: "wrong_payee" };
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (BigInt(a.validAfter) > now) return { isValid: false, invalidReason: "not_yet_valid" };
    if (BigInt(a.validBefore) <= now) return { isValid: false, invalidReason: "expired" };
    const used = await publicClient.readContract({
      address: r.asset,
      abi: USDC_ABI,
      functionName: "authorizationState",
      args: [a.from, a.nonce],
    });
    if (used) return { isValid: false, invalidReason: "nonce_already_used" };
    return { isValid: true };
  }

  const app = express();
  app.use(express.json({ limit: "100kb" }));

  app.post("/verify", (req, res) => {
    verify(req.body as VerifyRequest)
      .then((out) => res.json(out))
      .catch((err) => res.json({ isValid: false, invalidReason: String(err) } satisfies VerifyResponse));
  });

  app.post("/settle", (req, res) => {
    (async (): Promise<SettleResponse> => {
      const body = req.body as SettleRequest;
      const v = await verify(body);
      if (!v.isValid) return { success: false, errorReason: v.invalidReason };
      const a = body.paymentPayload.payload.authorization;
      const sig = parseSignature(body.paymentPayload.payload.signature);
      const vNum = sig.v !== undefined ? Number(sig.v) : sig.yParity + 27;
      const txHash = await walletClient.writeContract({
        address: body.paymentRequirements.asset,
        abi: USDC_ABI,
        functionName: "transferWithAuthorization",
        args: [
          a.from,
          a.to,
          BigInt(a.value),
          BigInt(a.validAfter),
          BigInt(a.validBefore),
          a.nonce,
          vNum,
          sig.r,
          sig.s,
        ],
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 1 });
      console.log(`[facilitator-local] settled ${a.value} units ${a.from} -> ${a.to} tx=${txHash}`);
      return { success: true, txHash };
    })()
      .then((out) => res.json(out))
      .catch((err) => res.json({ success: false, errorReason: String(err) } satisfies SettleResponse));
  });

  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = createFacilitator();
  app.listen(PORTS.facilitatorLocal, () => {
    console.log(`[facilitator-local] listening on :${PORTS.facilitatorLocal}`);
  });
}
