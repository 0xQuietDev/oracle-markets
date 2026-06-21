// viem client factories + on-chain helpers for the agent fleet (plan §5/C1).
// Daemon glue only — all strategy/solver/confidence logic lives in pure modules.
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  maxUint256,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  IDENTITY_REGISTRY_ABI,
  ORACLE_CORE_ABI,
  TASK_STATE,
  USDC_ABI,
  VALIDATION_REGISTRY_ABI,
  loadDeployment,
  type Deployment,
} from "@oracle/shared";

export type Role =
  | "client"
  | "worker"
  | "validator"
  | "bettorRep"
  | "bettorSkeptic"
  | "bettorMirror"
  | "vendor"
  | "human";

// Anvil mnemonic ("test test ... junk") account assignment per plan §2.3.
// `human` = the UI's manual bettor (anvil index 0 — has ETH + USDC, and is
// neither client/worker/validator so the role bans don't block it).
export const ANVIL_KEYS: Record<Role, Hex> = {
  client: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // index 1
  worker: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", // index 2
  validator: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6", // index 3
  bettorRep: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a", // index 4
  bettorSkeptic: "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba", // index 5
  bettorMirror: "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e", // index 6
  vendor: "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356", // index 7
  human: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // index 0
};

// Env override names (Fuji / non-anvil runs).
const KEY_ENV: Record<Role, string> = {
  client: "CLIENT_KEY",
  worker: "WORKER_KEY",
  validator: "VALIDATOR_KEY",
  bettorRep: "BETTOR_REP_KEY",
  bettorSkeptic: "BETTOR_SKEPTIC_KEY",
  bettorMirror: "BETTOR_MIRROR_KEY",
  vendor: "VENDOR_KEY",
  human: "HUMAN_KEY",
};

export function keyFor(role: Role): Hex {
  const env = process.env[KEY_ENV[role]];
  return (env as Hex | undefined) ?? ANVIL_KEYS[role];
}

export function makeClients(role: Role, deployment: Deployment = loadDeployment()) {
  const chain = defineChain({
    id: deployment.chainId,
    name: deployment.chainId === 43113 ? "avalanche-fuji" : "anvil-local",
    nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
    rpcUrls: { default: { http: [deployment.rpcUrl] } },
  });
  const account = privateKeyToAccount(keyFor(role));
  const publicClient = createPublicClient({ chain, transport: http(deployment.rpcUrl) });
  const walletClient = createWalletClient({ account, chain, transport: http(deployment.rpcUrl) });
  return { role, deployment, chain, account, publicClient, walletClient };
}
export type Clients = ReturnType<typeof makeClients>;

const sleepMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const sleep = sleepMs;

/** simulate -> write -> wait one receipt, against any contract. */
export async function writeAndWait(
  c: Clients,
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[],
) {
  const { request } = await c.publicClient.simulateContract({
    account: c.account,
    address,
    abi: abi as Abi,
    functionName: functionName as never,
    args: args as never,
  });
  const hash = await c.walletClient.writeContract(request as never);
  return c.publicClient.waitForTransactionReceipt({ hash });
}

export function writeOracle(c: Clients, functionName: string, args: readonly unknown[] = []) {
  return writeAndWait(c, c.deployment.contracts.oracleCore, ORACLE_CORE_ABI as unknown as Abi, functionName, args);
}

export function writeValidationRegistry(c: Clients, functionName: string, args: readonly unknown[]) {
  return writeAndWait(
    c,
    c.deployment.contracts.validationRegistry,
    VALIDATION_REGISTRY_ABI as unknown as Abi,
    functionName,
    args,
  );
}

export function writeIdentityRegistry(c: Clients, functionName: string, args: readonly unknown[]) {
  return writeAndWait(
    c,
    c.deployment.contracts.identityRegistry,
    IDENTITY_REGISTRY_ABI as unknown as Abi,
    functionName,
    args,
  );
}

/** One-time max USDC approval to OracleCore (no-op if allowance is ample). */
export async function approveUsdcOnce(c: Clients): Promise<void> {
  const { usdc, oracleCore } = c.deployment.contracts;
  const allowance = (await c.publicClient.readContract({
    address: usdc,
    abi: USDC_ABI,
    functionName: "allowance",
    args: [c.account.address, oracleCore],
  })) as bigint;
  if (allowance >= 10_000_000_000n) return; // >= 10k USDC is plenty for the demo
  await writeAndWait(c, usdc, USDC_ABI as unknown as Abi, "approve", [oracleCore, maxUint256]);
  console.log(`[${c.role}] approved USDC -> OracleCore`);
}

export type TaskOnChain = {
  client: Address;
  workerAgentId: bigint;
  validatorAgentId: bigint;
  validatorWallet: Address;
  reward: bigint;
  createdAt: bigint;
  deadline: bigint;
  specHash: Hex;
  specURI: string;
  workerWallet: Address;
  selfStake: bigint;
  acceptedAt: bigint;
  betCutoff: bigint;
  deliveredAt: bigint;
  deliverableHash: Hex;
  validationRequestHash: Hex;
  state: number;
  outcome: number;
  yesPool: bigint;
  noPool: bigint;
};

export async function getTask(c: Clients, taskId: bigint): Promise<TaskOnChain> {
  const t = (await c.publicClient.readContract({
    address: c.deployment.contracts.oracleCore,
    abi: ORACLE_CORE_ABI,
    functionName: "tasks",
    args: [taskId],
  })) as readonly unknown[];
  return {
    client: t[0] as Address,
    workerAgentId: BigInt(t[1] as bigint),
    validatorAgentId: BigInt(t[2] as bigint),
    validatorWallet: t[3] as Address,
    reward: t[4] as bigint,
    createdAt: BigInt(t[5] as bigint),
    deadline: BigInt(t[6] as bigint),
    specHash: t[7] as Hex,
    specURI: t[8] as string,
    workerWallet: t[9] as Address,
    selfStake: t[10] as bigint,
    acceptedAt: BigInt(t[11] as bigint),
    betCutoff: BigInt(t[12] as bigint),
    deliveredAt: BigInt(t[13] as bigint),
    deliverableHash: t[14] as Hex,
    validationRequestHash: t[15] as Hex,
    state: Number(t[16]),
    outcome: Number(t[17]),
    yesPool: t[18] as bigint,
    noPool: t[19] as bigint,
  };
}

export function stateName(state: number): string {
  return TASK_STATE[state] ?? `Unknown(${state})`;
}

/** Watch one OracleCore event (poll-based; works on anvil and Fuji). */
export function watchOracleEvent(
  c: Clients,
  eventName: string,
  onLogs: (logs: { args: Record<string, unknown>; blockNumber: bigint | null }[]) => void,
) {
  return c.publicClient.watchContractEvent({
    address: c.deployment.contracts.oracleCore,
    abi: ORACLE_CORE_ABI,
    eventName: eventName as never,
    onLogs: onLogs as never,
    poll: true,
    pollingInterval: 1000,
  });
}

/** Catch-up scan from deployBlock for events emitted before the daemon booted. */
export async function getOracleEvents(c: Clients, eventName: string) {
  return c.publicClient.getContractEvents({
    address: c.deployment.contracts.oracleCore,
    abi: ORACLE_CORE_ABI,
    eventName: eventName as never,
    fromBlock: BigInt(c.deployment.deployBlock),
    toBlock: "latest",
  }) as Promise<{ args: Record<string, unknown>; blockNumber: bigint | null }[]>;
}

/** Poll block timestamps until chain time is strictly greater than tsSec. */
export async function waitForTimestamp(c: Clients, tsSec: bigint): Promise<void> {
  for (;;) {
    const block = await c.publicClient.getBlock();
    if (block.timestamp > tsSec) return;
    await sleepMs(1000);
  }
}

/** Poll until the task reaches the named state (e.g. "Settled"). */
export async function waitForState(
  c: Clients,
  taskId: bigint,
  state: (typeof TASK_STATE)[number],
  opts: { pollMs?: number; timeoutMs?: number } = {},
): Promise<TaskOnChain> {
  const pollMs = opts.pollMs ?? 2000;
  const deadline = opts.timeoutMs ? Date.now() + opts.timeoutMs : Infinity;
  for (;;) {
    const t = await getTask(c, taskId);
    if (stateName(t.state) === state) return t;
    if (Date.now() > deadline) throw new Error(`timeout waiting for task ${taskId} -> ${state}`);
    await sleepMs(pollMs);
  }
}
