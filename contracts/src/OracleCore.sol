// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

interface IIdentityRegistry {
    function ownerOf(uint256 agentId) external view returns (address);
    function getAgentWallet(uint256 agentId) external view returns (address);
}

interface IValidationRegistry {
    function getValidationStatus(bytes32 requestHash)
        external
        view
        returns (address validator, uint256 agentId, uint8 response, uint256 respondedAt);
}

interface IReputationRegistry {
    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        bytes32 tag1,
        bytes32 tag2,
        string calldata endpointURI,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external;
}

/// @title OracleCore — outcome markets for agent trust (DESIGN.md v1.0, frozen)
/// @notice Binary parimutuel market over "will worker agent W complete task T
///         before the deadline?", settled against an ERC-8004 ValidationRegistry
///         response with a deterministic timeout ladder (R0–R7). Payouts are
///         pull-only. Non-upgradeable; all parameters immutable (§6.2).
contract OracleCore is ReentrancyGuard, Ownable2Step, Pausable {
    using SafeERC20 for IERC20;

    // ---------------- types ----------------

    enum TaskState {
        None,
        Created,
        Open,
        Executing, // UI label only — never stored (§7.3)
        Delivered,
        Settled,
        Cancelled
    }

    enum Outcome {
        Unresolved,
        Yes,
        No
    }

    enum Side {
        Yes,
        No
    }

    /// Constructor parameter pack (§6.2 — every field becomes an immutable).
    struct Params {
        uint16 minSelfStakeBps;
        uint16 protocolFeeBps;
        uint16 validatorFeeShareBps;
        uint32 bettingWindow;
        uint32 acceptWindow;
        uint32 disputeWindow;
        uint32 graceWindow;
        uint8 validationThreshold;
        uint128 minBet;
        uint128 maxPoolPerSide;
        uint128 minReward;
    }

    struct Task {
        // --- set at createTask ---
        address client;
        uint64 workerAgentId;
        uint64 validatorAgentId;
        address validatorWallet; // resolved from IdentityRegistry at creation
        uint128 reward;
        uint64 createdAt;
        uint64 deadline; // absolute timestamp for delivery
        bytes32 specHash; // keccak256 of task spec JSON
        string specURI;
        // --- set at acceptAndStake ---
        address workerWallet;
        uint128 selfStake;
        uint64 acceptedAt;
        uint64 betCutoff;
        // --- set at submitDelivery ---
        uint64 deliveredAt;
        bytes32 deliverableHash;
        bytes32 validationRequestHash; // keccak256(abi.encode(taskId, deliverableHash))
        // --- settlement ---
        TaskState state;
        Outcome outcome;
        uint128 yesPool; // includes selfStake
        uint128 noPool;
    }

    // ---------------- immutables ----------------

    IERC20 internal immutable USDC;
    IIdentityRegistry internal immutable IDENTITY;
    IReputationRegistry internal immutable REPUTATION;
    IValidationRegistry internal immutable VALIDATION;

    uint16 internal immutable MIN_SELF_STAKE_BPS;
    uint16 internal immutable PROTOCOL_FEE_BPS;
    uint16 internal immutable VALIDATOR_FEE_SHARE_BPS;
    uint32 internal immutable BETTING_WINDOW;
    uint32 internal immutable ACCEPT_WINDOW;
    uint32 internal immutable DISPUTE_WINDOW;
    uint32 internal immutable GRACE_WINDOW;
    uint8 internal immutable VALIDATION_THRESHOLD;
    uint128 internal immutable MIN_BET;
    uint128 internal immutable MAX_POOL_PER_SIDE;
    uint128 internal immutable MIN_REWARD;

    uint256 internal constant BPS = 10_000;
    uint256 internal constant DUST_SWEEP_DELAY = 30 days;
    bytes32 internal constant FEEDBACK_TAG1 = bytes32("oracle.outcome");

    // ---------------- storage ----------------

    /// taskId => Task
    mapping(uint256 => Task) public tasks;
    /// taskId => bettor => side (uint8) => amount
    mapping(uint256 => mapping(address => mapping(uint8 => uint128))) public positions;
    /// taskId => account => claimed?
    mapping(uint256 => mapping(address => bool)) public claimed;
    uint256 public nextTaskId; // starts at 1
    uint128 public treasuryAccrued;
    /// DR-8: validator fee share accrues per wallet, withdrawn via withdrawValidatorFees()
    mapping(address => uint128) public validatorAccrued;

    // internal bookkeeping (kept private: external surface = shared/src/abi.ts)
    mapping(uint256 => uint64) private _settledAt;
    mapping(uint256 => uint128) private _claimedTotal;
    mapping(uint256 => uint32) private _pendingClaims;
    mapping(uint256 => mapping(uint8 => uint32)) private _bettorCount;
    mapping(uint256 => bool) private _dustSwept;

    // ---------------- events ----------------

    event TaskCreated(
        uint256 indexed taskId,
        address indexed client,
        uint64 workerAgentId,
        uint64 validatorAgentId,
        uint128 reward,
        uint64 deadline,
        string specURI
    );
    event TaskAccepted(
        uint256 indexed taskId, uint64 indexed workerAgentId, address workerWallet, uint128 selfStake, uint64 betCutoff
    );
    event BetPlaced(
        uint256 indexed taskId,
        uint64 indexed agentId,
        address bettor,
        Side side,
        uint128 amount,
        uint128 yesPool,
        uint128 noPool
    );
    event ExecutionStarted(uint256 indexed taskId);
    event DeliverySubmitted(
        uint256 indexed taskId, bytes32 deliverableHash, bytes32 validationRequestHash, string evidenceURI
    );
    event OutcomeResolved(uint256 indexed taskId, Outcome outcome, uint8 viaRule, uint8 validatorScore);
    event Claimed(uint256 indexed taskId, address indexed account, uint128 amount);
    event FeedbackPosted(uint256 indexed taskId, uint64 indexed workerAgentId, int128 value);
    event TaskCancelled(uint256 indexed taskId);

    // ---------------- errors ----------------

    error NotAgentController();
    error WrongState();
    error BetWindowClosed();
    error RoleBanned();
    error BelowMinBet();
    error PoolCapExceeded();
    error BelowMinSelfStake();
    error DeadlinePassed();
    error TooEarly();
    error ValidationLate();
    error ValidationMissing();
    error AlreadyClaimed();
    error NothingToClaim();
    error BadParams();

    // ---------------- constructor ----------------

    constructor(
        address usdc_,
        address identityRegistry_,
        address reputationRegistry_,
        address validationRegistry_,
        address owner_,
        Params memory p
    ) Ownable(owner_) {
        if (
            usdc_ == address(0) || identityRegistry_ == address(0) || reputationRegistry_ == address(0)
                || validationRegistry_ == address(0)
        ) revert BadParams();
        if (p.protocolFeeBps > BPS || p.validatorFeeShareBps > BPS || p.minSelfStakeBps > BPS) revert BadParams();
        if (p.validationThreshold > 100 || p.minReward == 0) revert BadParams();

        USDC = IERC20(usdc_);
        IDENTITY = IIdentityRegistry(identityRegistry_);
        REPUTATION = IReputationRegistry(reputationRegistry_);
        VALIDATION = IValidationRegistry(validationRegistry_);

        MIN_SELF_STAKE_BPS = p.minSelfStakeBps;
        PROTOCOL_FEE_BPS = p.protocolFeeBps;
        VALIDATOR_FEE_SHARE_BPS = p.validatorFeeShareBps;
        BETTING_WINDOW = p.bettingWindow;
        ACCEPT_WINDOW = p.acceptWindow;
        DISPUTE_WINDOW = p.disputeWindow;
        GRACE_WINDOW = p.graceWindow;
        VALIDATION_THRESHOLD = p.validationThreshold;
        MIN_BET = p.minBet;
        MAX_POOL_PER_SIDE = p.maxPoolPerSide;
        MIN_REWARD = p.minReward;

        nextTaskId = 1;
    }

    // ---------------- task lifecycle ----------------

    /// @notice Client posts a task and escrows the full reward (state: None -> Created).
    function createTask(
        uint64 workerAgentId,
        uint64 validatorAgentId,
        uint128 reward,
        uint64 deadline,
        bytes32 specHash,
        string calldata specURI
    ) external whenNotPaused nonReentrant returns (uint256 taskId) {
        if (reward < MIN_REWARD) revert BadParams();
        // workerAgentId == 0 ⇒ OPEN job: any eligible registered worker may claim
        // it via acceptAndStake (autonomous job board). A non-zero workerAgentId
        // pre-assigns the worker (must exist and differ from the validator).
        if (validatorAgentId == 0) revert BadParams();
        if (workerAgentId != 0) {
            if (workerAgentId == validatorAgentId) revert BadParams();
            if (_agentOwner(workerAgentId) == address(0)) revert BadParams(); // worker agent must exist
        }
        if (deadline <= block.timestamp + BETTING_WINDOW) revert BadParams();
        address validatorWallet = _agentWallet(validatorAgentId);
        if (validatorWallet == address(0)) revert BadParams(); // validator agent must exist

        taskId = nextTaskId++;
        Task storage t = tasks[taskId];
        t.client = msg.sender;
        t.workerAgentId = workerAgentId;
        t.validatorAgentId = validatorAgentId;
        t.validatorWallet = validatorWallet;
        t.reward = reward;
        t.createdAt = uint64(block.timestamp);
        t.deadline = deadline;
        t.specHash = specHash;
        t.specURI = specURI;
        t.state = TaskState.Created;

        emit TaskCreated(taskId, msg.sender, workerAgentId, validatorAgentId, reward, deadline, specURI);
        USDC.safeTransferFrom(msg.sender, address(this), reward);
    }

    /// @notice R0 — nobody accepted in time: anyone may cancel; deposits become
    ///         claimable 1:1 (E3) via claim().
    function cancelUnaccepted(uint256 taskId) external nonReentrant {
        Task storage t = tasks[taskId];
        if (t.state != TaskState.Created) revert WrongState();
        if (block.timestamp <= uint256(t.createdAt) + ACCEPT_WINDOW) revert TooEarly();
        t.state = TaskState.Cancelled;
        _pendingClaims[taskId] = 1; // client refund
        emit TaskCancelled(taskId);
    }

    /// @notice Worker accepts by self-staking >= MIN_SELF_STAKE_BPS of the reward
    ///         on YES — acceptance IS a bet (DR-3). State: Created -> Open.
    function acceptAndStake(uint256 taskId, uint64 workerAgentId, uint128 stake) external whenNotPaused nonReentrant {
        Task storage t = tasks[taskId];
        if (t.state != TaskState.Created) revert WrongState();
        if (workerAgentId == 0) revert BadParams();
        // OPEN job (t.workerAgentId == 0): any eligible registered worker may
        // claim it first-come. Pre-assigned job: the claimer must match.
        if (t.workerAgentId == 0) {
            if (workerAgentId == t.validatorAgentId) revert RoleBanned(); // validator can't be the worker
            if (msg.sender == t.client) revert RoleBanned(); // client can't be the worker
            t.workerAgentId = workerAgentId;
        } else if (workerAgentId != t.workerAgentId) {
            revert BadParams();
        }
        if (block.timestamp > uint256(t.createdAt) + ACCEPT_WINDOW) revert DeadlinePassed();
        if (!_isAgentController(workerAgentId, msg.sender)) revert NotAgentController();
        if (uint256(stake) < (uint256(t.reward) * MIN_SELF_STAKE_BPS) / BPS) revert BelowMinSelfStake();
        if (stake > MAX_POOL_PER_SIDE) revert PoolCapExceeded();

        t.workerWallet = msg.sender;
        t.selfStake = stake;
        t.acceptedAt = uint64(block.timestamp);
        t.betCutoff = uint64(block.timestamp + BETTING_WINDOW);
        t.yesPool = stake;
        t.state = TaskState.Open;
        positions[taskId][msg.sender][uint8(Side.Yes)] = stake;
        _bettorCount[taskId][uint8(Side.Yes)] = 1;

        emit TaskAccepted(taskId, workerAgentId, msg.sender, stake, t.betCutoff);
        USDC.safeTransferFrom(msg.sender, address(this), stake);
    }

    /// @notice Open-window pool deposit (§6.3 B1–B5). Role bans enforced by
    ///         address AND agentId; the worker may only add YES.
    function placeBet(uint256 taskId, uint64 agentId, Side side, uint128 amount) external whenNotPaused nonReentrant {
        Task storage t = tasks[taskId];
        if (t.state != TaskState.Open) revert WrongState();
        if (block.timestamp >= t.betCutoff) revert BetWindowClosed();
        if (amount < MIN_BET) revert BelowMinBet();
        if (!_isAgentController(agentId, msg.sender)) revert NotAgentController();

        // B2 role bans
        if (msg.sender == t.client) revert RoleBanned();
        if (msg.sender == t.validatorWallet || agentId == t.validatorAgentId) revert RoleBanned();
        if (side == Side.No && (msg.sender == t.workerWallet || agentId == t.workerAgentId)) revert RoleBanned();

        uint128 newYes = t.yesPool;
        uint128 newNo = t.noPool;
        if (side == Side.Yes) {
            newYes += amount;
            if (newYes > MAX_POOL_PER_SIDE) revert PoolCapExceeded();
            t.yesPool = newYes;
        } else {
            newNo += amount;
            if (newNo > MAX_POOL_PER_SIDE) revert PoolCapExceeded();
            t.noPool = newNo;
        }
        if (positions[taskId][msg.sender][uint8(side)] == 0) {
            _bettorCount[taskId][uint8(side)] += 1;
        }
        positions[taskId][msg.sender][uint8(side)] += amount;

        emit BetPlaced(taskId, agentId, msg.sender, side, amount, newYes, newNo);
        USDC.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Worker submits the deliverable in (betCutoff, deadline]. Records
    ///         validationRequestHash only — DR-6 path (b): the worker calls
    ///         ValidationRegistry.validationRequest itself. State: Open -> Delivered.
    function submitDelivery(uint256 taskId, bytes32 deliverableHash, string calldata evidenceURI)
        external
        whenNotPaused
        nonReentrant
    {
        Task storage t = tasks[taskId];
        if (t.state != TaskState.Open) revert WrongState();
        if (msg.sender != t.workerWallet) revert NotAgentController();
        if (block.timestamp < t.betCutoff) revert TooEarly();
        if (block.timestamp > t.deadline) revert DeadlinePassed();

        t.deliveredAt = uint64(block.timestamp);
        t.deliverableHash = deliverableHash;
        bytes32 requestHash = keccak256(abi.encode(taskId, deliverableHash));
        t.validationRequestHash = requestHash;
        t.state = TaskState.Delivered;

        emit ExecutionStarted(taskId);
        emit DeliverySubmitted(taskId, deliverableHash, requestHash, evidenceURI);
    }

    // ---------------- resolution ladder (§6.4) ----------------

    /// @notice R2/R3 — settle from the ValidationRegistry's stored status for the
    ///         exact requestHash recorded at delivery (R7). Verifies the response
    ///         came from the assigned validator about the assigned worker (DR-6),
    ///         and was posted within the dispute window (R6).
    function settleWithValidation(uint256 taskId) external nonReentrant {
        Task storage t = tasks[taskId];
        if (t.state != TaskState.Delivered) revert WrongState();

        (address respValidator, uint256 respAgentId, uint8 response, uint256 respondedAt) =
            VALIDATION.getValidationStatus(t.validationRequestHash);
        if (respondedAt == 0) revert ValidationMissing();
        if (respValidator != t.validatorWallet || respAgentId != t.workerAgentId) revert ValidationMissing();
        if (respondedAt > uint256(t.deliveredAt) + DISPUTE_WINDOW) revert ValidationLate();

        bool yes = response >= VALIDATION_THRESHOLD;
        _finalize(taskId, yes ? Outcome.Yes : Outcome.No, yes ? 2 : 3, response);
    }

    /// @notice R4 — client attestation, only in (deliveredAt+D, deliveredAt+D+G]
    ///         and only while the validator stayed silent.
    function attest(uint256 taskId, bool approved) external nonReentrant {
        Task storage t = tasks[taskId];
        if (t.state != TaskState.Delivered) revert WrongState();
        if (msg.sender != t.client) revert NotAgentController();
        if (block.timestamp <= uint256(t.deliveredAt) + DISPUTE_WINDOW) revert TooEarly();
        if (block.timestamp > uint256(t.deliveredAt) + DISPUTE_WINDOW + GRACE_WINDOW) revert DeadlinePassed();
        if (_hasValidResponse(t)) revert WrongState(); // R2/R3 take precedence

        _finalize(taskId, approved ? Outcome.Yes : Outcome.No, 4, 0);
    }

    /// @notice R1 — no delivery past the deadline => NO.
    ///         R5 — delivered, validator AND client silent past D+G => YES.
    function settleByTimeout(uint256 taskId) external nonReentrant {
        Task storage t = tasks[taskId];
        if (t.state == TaskState.Open) {
            if (block.timestamp <= t.deadline) revert TooEarly();
            _finalize(taskId, Outcome.No, 1, 0);
        } else if (t.state == TaskState.Delivered) {
            if (block.timestamp <= uint256(t.deliveredAt) + DISPUTE_WINDOW + GRACE_WINDOW) revert TooEarly();
            if (_hasValidResponse(t)) revert WrongState(); // R2/R3 take precedence
            _finalize(taskId, Outcome.Yes, 5, 0);
        } else {
            revert WrongState();
        }
    }

    // ---------------- money out (§6.5) ----------------

    /// @notice Pull-payment of a caller's full entitlement: winning position plus
    ///         pro-rata share of the losing pool; worker reward on YES; client
    ///         refund (+E2 damages) on NO; 1:1 refunds on Cancelled (E3).
    function claim(uint256 taskId) external nonReentrant {
        Task storage t = tasks[taskId];
        if (t.state != TaskState.Settled && t.state != TaskState.Cancelled) revert WrongState();
        if (claimed[taskId][msg.sender]) revert AlreadyClaimed();
        if (_dustSwept[taskId]) revert NothingToClaim();

        uint128 amount = _entitlement(t, taskId, msg.sender);
        if (amount == 0) revert NothingToClaim();

        claimed[taskId][msg.sender] = true;
        _claimedTotal[taskId] += amount;
        if (_pendingClaims[taskId] > 0) {
            _pendingClaims[taskId] -= 1;
        }

        emit Claimed(taskId, msg.sender, amount);
        USDC.safeTransfer(msg.sender, amount);
    }

    /// @notice Sweeps integer-division dust (and, after 30 days, abandoned
    ///         entitlements) of a settled task to the treasury (§6.5).
    function sweepDust(uint256 taskId) external nonReentrant {
        Task storage t = tasks[taskId];
        if (t.state != TaskState.Settled) revert WrongState();
        if (_dustSwept[taskId]) revert AlreadyClaimed();
        bool allClaimed = _pendingClaims[taskId] == 0;
        if (!allClaimed && block.timestamp < uint256(_settledAt[taskId]) + DUST_SWEEP_DELAY) revert TooEarly();

        uint256 pot = uint256(t.yesPool) + t.noPool + t.reward;
        uint256 losing = t.outcome == Outcome.Yes ? t.noPool : t.yesPool;
        uint256 fee = (losing * PROTOCOL_FEE_BPS) / BPS;
        uint256 remaining = pot - fee - _claimedTotal[taskId];

        _dustSwept[taskId] = true;
        treasuryAccrued += uint128(remaining);
    }

    function withdrawTreasury(address to) external onlyOwner nonReentrant {
        uint128 amount = treasuryAccrued;
        if (amount == 0) revert NothingToClaim();
        treasuryAccrued = 0;
        USDC.safeTransfer(to, amount);
    }

    /// @notice DR-8: validators withdraw their accrued fee share.
    function withdrawValidatorFees() external nonReentrant {
        uint128 amount = validatorAccrued[msg.sender];
        if (amount == 0) revert NothingToClaim();
        validatorAccrued[msg.sender] = 0;
        USDC.safeTransfer(msg.sender, amount);
    }

    // ---------------- admin (demo safety brake) ----------------

    /// @dev S6: pause gates ONLY inflows; settlement and claim stay callable.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ---------------- views ----------------

    function impliedProbabilityBps(uint256 taskId) external view returns (uint16) {
        Task storage t = tasks[taskId];
        uint256 total = uint256(t.yesPool) + t.noPool;
        if (total == 0) return 0;
        return uint16((uint256(t.yesPool) * BPS) / total);
    }

    function previewPayout(uint256 taskId, address account) external view returns (uint128) {
        Task storage t = tasks[taskId];
        if (t.state != TaskState.Settled && t.state != TaskState.Cancelled) return 0;
        if (claimed[taskId][account] || _dustSwept[taskId]) return 0;
        return _entitlement(t, taskId, account);
    }

    // ---------------- internals ----------------

    /// @dev DESIGN §4 wallet-binding rule, tolerant of unregistered agentIds.
    function _isAgentController(uint64 agentId, address addr) internal view returns (bool) {
        if (_agentOwner(agentId) == addr) return true;
        try IDENTITY.getAgentWallet(agentId) returns (address wallet) {
            return wallet == addr && wallet != address(0);
        } catch {
            return false;
        }
    }

    function _agentOwner(uint64 agentId) internal view returns (address) {
        try IDENTITY.ownerOf(agentId) returns (address agentOwner) {
            return agentOwner;
        } catch {
            return address(0);
        }
    }

    function _agentWallet(uint64 agentId) internal view returns (address) {
        try IDENTITY.getAgentWallet(agentId) returns (address wallet) {
            return wallet;
        } catch {
            return address(0);
        }
    }

    /// @dev True iff the assigned validator answered about the assigned worker
    ///      within the dispute window (used to give R2/R3 precedence in R4/R5).
    function _hasValidResponse(Task storage t) internal view returns (bool) {
        (address respValidator, uint256 respAgentId,, uint256 respondedAt) =
            VALIDATION.getValidationStatus(t.validationRequestHash);
        return respondedAt != 0 && respondedAt <= uint256(t.deliveredAt) + DISPUTE_WINDOW
            && respValidator == t.validatorWallet && respAgentId == t.workerAgentId;
    }

    /// @dev Single settlement implementation (S2, S3): mutate, emit, then the
    ///      terminal try/catch reputation write-back — a registry revert MUST NOT
    ///      block settlement.
    function _finalize(uint256 taskId, Outcome outcome, uint8 viaRule, uint8 score) internal {
        Task storage t = tasks[taskId];
        if (t.state == TaskState.Settled || t.outcome != Outcome.Unresolved) revert WrongState(); // S3 write-once

        t.state = TaskState.Settled;
        t.outcome = outcome;
        _settledAt[taskId] = uint64(block.timestamp);

        uint128 losing = outcome == Outcome.Yes ? t.noPool : t.yesPool;
        uint128 fee = uint128((uint256(losing) * PROTOCOL_FEE_BPS) / BPS);
        uint128 validatorFee = 0;
        if (viaRule == 2 || viaRule == 3) {
            // §6.5: validator fee share only when the outcome came via validation
            validatorFee = uint128((uint256(fee) * VALIDATOR_FEE_SHARE_BPS) / BPS);
        }
        uint128 treasuryFee = fee - validatorFee;
        if (validatorFee > 0) validatorAccrued[t.validatorWallet] += validatorFee;
        if (treasuryFee > 0) treasuryAccrued += treasuryFee;

        uint8 winSide = outcome == Outcome.Yes ? uint8(Side.Yes) : uint8(Side.No);
        uint32 pending = _bettorCount[taskId][winSide];
        if (outcome == Outcome.No) pending += 1; // client refund claim
        _pendingClaims[taskId] = pending;

        emit OutcomeResolved(taskId, outcome, viaRule, score);

        int128 value = outcome == Outcome.Yes ? int128(100) : int128(0);
        try REPUTATION.giveFeedback(
            t.workerAgentId, value, 0, FEEDBACK_TAG1, bytes32(taskId), "", "", bytes32(0)
        ) {
            emit FeedbackPosted(taskId, t.workerAgentId, value);
        } catch {}
    }

    /// @dev §6.5 payout math, computed in uint256 before narrowing (S4).
    function _entitlement(Task storage t, uint256 taskId, address account) internal view returns (uint128) {
        uint256 amount = 0;
        if (t.state == TaskState.Cancelled) {
            // E3: every deposit back 1:1
            if (account == t.client) amount += t.reward;
            amount += positions[taskId][account][uint8(Side.Yes)];
            amount += positions[taskId][account][uint8(Side.No)];
        } else if (t.outcome == Outcome.Yes) {
            uint256 w = positions[taskId][account][uint8(Side.Yes)];
            if (w > 0) {
                uint256 losing = t.noPool; // E1: losing == 0 => fee == 0, share == 0
                uint256 distributable = losing - (losing * PROTOCOL_FEE_BPS) / BPS;
                amount += w + (w * distributable) / t.yesPool;
            }
            if (account == t.workerWallet) amount += t.reward; // reward in the same claim
        } else if (t.outcome == Outcome.No) {
            uint256 losing = t.yesPool; // never 0: mandatory self-stake
            uint256 distributable = losing - (losing * PROTOCOL_FEE_BPS) / BPS;
            uint256 winning = t.noPool;
            uint256 w = positions[taskId][account][uint8(Side.No)];
            if (w > 0) {
                amount += w + (w * distributable) / winning;
            }
            if (account == t.client) {
                amount += t.reward; // full refund
                if (winning == 0) amount += distributable; // E2: damages to the client
            }
        }
        return uint128(amount);
    }
}
