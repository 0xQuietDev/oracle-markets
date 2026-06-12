// Canonical ABIs for the ORACLE protocol — BINDING INTERFACE (plan §2.1).
// OracleCore entries mirror docs/DESIGN.md §7.2 exactly (enums surface as uint8).
// Integration phase diffs this against the forge artifact; the forge artifact wins
// only via an orchestrator-approved update to this file.
import { parseAbi } from "viem";

export const ORACLE_CORE_ABI = parseAbi([
  // ---- events ----
  "event TaskCreated(uint256 indexed taskId, address indexed client, uint64 workerAgentId, uint64 validatorAgentId, uint128 reward, uint64 deadline, string specURI)",
  "event TaskAccepted(uint256 indexed taskId, uint64 indexed workerAgentId, address workerWallet, uint128 selfStake, uint64 betCutoff)",
  "event BetPlaced(uint256 indexed taskId, uint64 indexed agentId, address bettor, uint8 side, uint128 amount, uint128 yesPool, uint128 noPool)",
  "event ExecutionStarted(uint256 indexed taskId)",
  "event DeliverySubmitted(uint256 indexed taskId, bytes32 deliverableHash, bytes32 validationRequestHash, string evidenceURI)",
  "event OutcomeResolved(uint256 indexed taskId, uint8 outcome, uint8 viaRule, uint8 validatorScore)",
  "event Claimed(uint256 indexed taskId, address indexed account, uint128 amount)",
  "event FeedbackPosted(uint256 indexed taskId, uint64 indexed workerAgentId, int128 value)",
  "event TaskCancelled(uint256 indexed taskId)",
  // ---- errors ----
  "error NotAgentController()",
  "error WrongState()",
  "error BetWindowClosed()",
  "error RoleBanned()",
  "error BelowMinBet()",
  "error PoolCapExceeded()",
  "error BelowMinSelfStake()",
  "error DeadlinePassed()",
  "error TooEarly()",
  "error ValidationLate()",
  "error ValidationMissing()",
  "error AlreadyClaimed()",
  "error NothingToClaim()",
  "error BadParams()",
  // ---- mutating functions ----
  "function createTask(uint64 workerAgentId, uint64 validatorAgentId, uint128 reward, uint64 deadline, bytes32 specHash, string specURI) returns (uint256 taskId)",
  "function acceptAndStake(uint256 taskId, uint64 workerAgentId, uint128 stake)",
  "function placeBet(uint256 taskId, uint64 agentId, uint8 side, uint128 amount)",
  "function submitDelivery(uint256 taskId, bytes32 deliverableHash, string evidenceURI)",
  "function settleWithValidation(uint256 taskId)",
  "function attest(uint256 taskId, bool approved)",
  "function settleByTimeout(uint256 taskId)",
  "function cancelUnaccepted(uint256 taskId)",
  "function claim(uint256 taskId)",
  "function sweepDust(uint256 taskId)",
  "function withdrawTreasury(address to)",
  "function withdrawValidatorFees()", // DR-8: validator fee share accrues per-wallet
  "function pause()",
  "function unpause()",
  // ---- views ----
  "function impliedProbabilityBps(uint256 taskId) view returns (uint16)",
  "function previewPayout(uint256 taskId, address account) view returns (uint128)",
  "function nextTaskId() view returns (uint256)",
  "function treasuryAccrued() view returns (uint128)",
  "function validatorAccrued(address wallet) view returns (uint128)",
  "function positions(uint256 taskId, address bettor, uint8 side) view returns (uint128)",
  "function claimed(uint256 taskId, address account) view returns (bool)",
  // public mapping getter: struct fields in declaration order (DESIGN §7.2), strings included
  "function tasks(uint256 taskId) view returns (address client, uint64 workerAgentId, uint64 validatorAgentId, address validatorWallet, uint128 reward, uint64 createdAt, uint64 deadline, bytes32 specHash, string specURI, address workerWallet, uint128 selfStake, uint64 acceptedAt, uint64 betCutoff, uint64 deliveredAt, bytes32 deliverableHash, bytes32 validationRequestHash, uint8 state, uint8 outcome, uint128 yesPool, uint128 noPool)",
]);

// Side / TaskState / Outcome numeric encodings (DESIGN §7.2 enum order)
export const SIDE = { Yes: 0, No: 1 } as const;
export const TASK_STATE = ["None", "Created", "Open", "Executing", "Delivered", "Settled", "Cancelled"] as const;
export const OUTCOME = ["Unresolved", "Yes", "No"] as const;

export const IDENTITY_REGISTRY_ABI = parseAbi([
  "function register(string agentURI) returns (uint256 agentId)",
  "function ownerOf(uint256 agentId) view returns (address)",
  "function getAgentWallet(uint256 agentId) view returns (address)",
  "function setApprovalForAll(address operator, bool approved)",
]);

export const VALIDATION_REGISTRY_ABI = parseAbi([
  "event ValidationRequested(address indexed validator, uint256 indexed agentId, string requestURI, bytes32 indexed requestHash)",
  "event ValidationResponded(bytes32 indexed requestHash, uint8 response, string responseURI, bytes32 reportHash, string tag)",
  "function validationRequest(address validatorAddress, uint256 agentId, string requestURI, bytes32 requestHash)",
  "function validationResponse(bytes32 requestHash, uint8 response, string responseURI, bytes32 reportHash, string tag)",
  "function getValidationStatus(bytes32 requestHash) view returns (address validator, uint256 agentId, uint8 response, uint256 respondedAt)",
]);

export const REPUTATION_REGISTRY_ABI = parseAbi([
  "function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, bytes32 tag1, bytes32 tag2, string endpointURI, string feedbackURI, bytes32 feedbackHash)",
  "function getSummary(uint256 agentId, address[] clients, bytes32 tag1, bytes32 tag2) view returns (uint64 count, int128 sum)",
]);

// ERC-20 + EIP-3009 surface used by x402-lite, the facilitator, and agent boot approvals
export const USDC_ABI = parseAbi([
  "function name() view returns (string)",
  "function version() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function transfer(address to, uint256 value) returns (bool)",
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)",
  "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
  "function mint(address to, uint256 amount)", // MockUSDC only
]);
