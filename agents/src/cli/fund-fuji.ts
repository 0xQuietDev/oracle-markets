// Fund the Fuji fleet from a single funded DEPLOYER wallet (one faucet action).
// - sends a little AVAX (gas) to every fleet wallet that signs txs
// - mints MockUSDC to each wallet that needs to spend (client/worker/bettors/human)
//   NOTE: only works when the deployment USDC is our MockUSDC (public mint()).
//   With canonical Circle USDC, fund those wallets from the Circle faucet instead.
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseEther,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { USDC_ABI, loadDeployment } from "@oracle/shared";

const RPC = process.env.FUJI_RPC ?? "https://api.avax-test.network/ext/bc/C/rpc";

// gas top-up per wallet, and USDC mint per spender. Fuji gas is ~2 gwei, so a
// full multi-task run costs ~0.02 AVAX total — these tiny top-ups let one small
// zero-prerequisite faucet drip cover the entire fleet.
const GAS_AVAX = process.env.FUND_GAS_AVAX ?? "0.004";
const USDC_EACH = BigInt(process.env.FUND_USDC_EACH ?? "200") * 1_000_000n; // 200 USDC (our mint — free)

// role -> env key name
const KEYS: Record<string, string> = {
  deployer: "FUJI_DEPLOYER_KEY",
  client: "FUJI_CLIENT_KEY",
  worker: "FUJI_WORKER_KEY",
  validator: "FUJI_VALIDATOR_KEY",
  bettorRep: "FUJI_BETTORREP_KEY",
  bettorSkeptic: "FUJI_BETTORSKEPTIC_KEY",
  bettorMirror: "FUJI_BETTORMIRROR_KEY",
  vendor: "FUJI_VENDOR_KEY",
  human: "FUJI_HUMAN_KEY",
  revenue: "FUJI_REVENUE_KEY",
  relayer: "FUJI_RELAYER_KEY",
};

// who needs gas (signs on-chain txs) and who needs USDC (spends).
// vendor sends no chain txs (HTTP-only x402 seller), so it needs no gas.
const NEEDS_GAS = ["client", "worker", "validator", "bettorRep", "bettorSkeptic", "bettorMirror", "human", "relayer"];
const NEEDS_USDC = ["client", "worker", "bettorRep", "bettorSkeptic", "bettorMirror", "human"];

function addrOf(role: string): { key: Hex; address: Hex } {
  const key = process.env[KEYS[role]] as Hex | undefined;
  if (!key) throw new Error(`missing ${KEYS[role]} in env (.env.fuji)`);
  const a = privateKeyToAccount(key);
  return { key, address: a.address };
}

async function main() {
  const dep = loadDeployment();
  const chain = defineChain({
    id: dep.chainId,
    name: "avalanche-fuji",
    nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
    rpcUrls: { default: { http: [RPC] } },
  });
  const transport = http(RPC);
  const pub = createPublicClient({ chain, transport });

  const deployer = addrOf("deployer");
  const dWallet = createWalletClient({ account: privateKeyToAccount(deployer.key), chain, transport });
  const bal = await pub.getBalance({ address: deployer.address });
  console.log(`[fund] deployer ${deployer.address} AVAX=${Number(bal) / 1e18}`);
  if (bal === 0n) throw new Error("deployer has no AVAX — fund it from the Avalanche Fuji faucet first");

  // 1) AVAX gas to each signer
  for (const role of NEEDS_GAS) {
    const { address } = addrOf(role);
    const have = await pub.getBalance({ address });
    if (have >= parseEther(GAS_AVAX)) {
      console.log(`[fund] ${role} already has gas (${Number(have) / 1e18} AVAX)`);
      continue;
    }
    const hash = await dWallet.sendTransaction({ to: address, value: parseEther(GAS_AVAX) });
    await pub.waitForTransactionReceipt({ hash });
    console.log(`[fund] ${role} <- ${GAS_AVAX} AVAX  ${hash}`);
  }

  // 2) USDC to each spender (MockUSDC public mint; deployer signs)
  for (const role of NEEDS_USDC) {
    const { address } = addrOf(role);
    try {
      const hash = await dWallet.writeContract({
        address: dep.contracts.usdc,
        abi: USDC_ABI,
        functionName: "mint",
        args: [address, USDC_EACH],
        chain,
        account: privateKeyToAccount(deployer.key),
      });
      await pub.waitForTransactionReceipt({ hash });
      console.log(`[fund] ${role} <- ${USDC_EACH / 1_000_000n} USDC (mint)  ${hash}`);
    } catch (err) {
      console.error(`[fund] mint to ${role} failed (canonical USDC? fund via Circle faucet): ${(err as Error).message}`);
    }
  }
  console.log("[fund] done.");
}

main().catch((e) => {
  console.error("[fund] fatal:", e);
  process.exit(1);
});
