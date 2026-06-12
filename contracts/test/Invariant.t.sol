// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Fixtures} from "./helpers/Fixtures.sol";
import {OracleCore} from "../src/OracleCore.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {MockIdentityRegistry} from "../src/mocks/MockIdentityRegistry.sol";
import {ValidationRegistry} from "../src/registries/ValidationRegistry.sol";

/// @notice Bounded random-walk handler over the whole task lifecycle.
contract OracleHandler is Test {
    OracleCore internal core;
    MockUSDC internal usdc;
    ValidationRegistry internal valReg;

    address internal owner;
    address internal client;
    address internal worker;
    address internal validator;
    address[3] internal bettors;
    uint64 internal workerId;
    uint64 internal validatorId;
    uint64[3] internal bettorIds;

    uint256[] internal taskIds;

    constructor(
        OracleCore core_,
        MockUSDC usdc_,
        ValidationRegistry valReg_,
        address owner_,
        address client_,
        address worker_,
        address validator_,
        address[3] memory bettors_,
        uint64 workerId_,
        uint64 validatorId_,
        uint64[3] memory bettorIds_
    ) {
        core = core_;
        usdc = usdc_;
        valReg = valReg_;
        owner = owner_;
        client = client_;
        worker = worker_;
        validator = validator_;
        bettors = bettors_;
        workerId = workerId_;
        validatorId = validatorId_;
        bettorIds = bettorIds_;
    }

    function _pick(uint256 seed) internal view returns (uint256 taskId, bool ok) {
        if (taskIds.length == 0) return (0, false);
        return (taskIds[bound(seed, 0, taskIds.length - 1)], true);
    }

    function _dHash(uint256 taskId) internal pure returns (bytes32) {
        return keccak256(abi.encode("deliverable", taskId));
    }

    // ---------------- actions ----------------

    function actCreate(uint96 rewardSeed, uint32 horizonSeed) external {
        uint128 reward = uint128(bound(rewardSeed, 1e6, 500e6));
        uint64 deadline = uint64(block.timestamp + 601 + bound(horizonSeed, 0, 3600));
        vm.prank(client);
        try core.createTask(workerId, validatorId, reward, deadline, bytes32("spec"), "u") returns (uint256 id) {
            taskIds.push(id);
        } catch {}
    }

    function actAccept(uint256 seed, uint96 stakeSeed) external {
        (uint256 taskId, bool ok) = _pick(seed);
        if (!ok) return;
        (uint128 reward,,,) = _meta(taskId);
        uint128 stake = uint128(bound(stakeSeed, (uint256(reward) * 1000) / 10_000, reward));
        vm.prank(worker);
        try core.acceptAndStake(taskId, workerId, stake) {} catch {}
    }

    function actBet(uint256 seed, uint256 actorSeed, uint8 sideSeed, uint96 amountSeed) external {
        (uint256 taskId, bool ok) = _pick(seed);
        if (!ok) return;
        uint256 i = bound(actorSeed, 0, 2);
        OracleCore.Side side = sideSeed % 2 == 0 ? OracleCore.Side.Yes : OracleCore.Side.No;
        uint128 amount = uint128(bound(amountSeed, 100_000, 200e6));
        vm.prank(bettors[i]);
        try core.placeBet(taskId, bettorIds[i], side, amount) {} catch {}
    }

    function actWarp(uint32 dtSeed) external {
        vm.warp(block.timestamp + bound(dtSeed, 1, 700));
    }

    function actDeliver(uint256 seed, bool fileRequest) external {
        (uint256 taskId, bool ok) = _pick(seed);
        if (!ok) return;
        (, OracleCore.TaskState state,,) = _meta(taskId);
        if (state != OracleCore.TaskState.Open) return;
        (uint64 betCutoff, uint64 deadline) = _windows(taskId);
        if (block.timestamp < betCutoff) vm.warp(betCutoff);
        if (block.timestamp > deadline) return;
        bytes32 dHash = _dHash(taskId);
        vm.prank(worker);
        try core.submitDelivery(taskId, dHash, "u") {
            if (fileRequest) {
                bytes32 reqHash = keccak256(abi.encode(taskId, dHash));
                vm.prank(worker);
                try valReg.validationRequest(validator, workerId, "u", reqHash) {} catch {}
            }
        } catch {}
    }

    function actRespond(uint256 seed, uint8 scoreSeed) external {
        (uint256 taskId, bool ok) = _pick(seed);
        if (!ok) return;
        bytes32 reqHash = keccak256(abi.encode(taskId, _dHash(taskId)));
        vm.prank(validator);
        try valReg.validationResponse(reqHash, uint8(bound(scoreSeed, 0, 100)), "u", bytes32(0), "oracle") {} catch {}
    }

    function actSettleWithValidation(uint256 seed) external {
        (uint256 taskId, bool ok) = _pick(seed);
        if (!ok) return;
        try core.settleWithValidation(taskId) {} catch {}
    }

    function actSettleByTimeout(uint256 seed) external {
        (uint256 taskId, bool ok) = _pick(seed);
        if (!ok) return;
        try core.settleByTimeout(taskId) {} catch {}
    }

    function actAttest(uint256 seed, bool approved) external {
        (uint256 taskId, bool ok) = _pick(seed);
        if (!ok) return;
        vm.prank(client);
        try core.attest(taskId, approved) {} catch {}
    }

    function actCancel(uint256 seed) external {
        (uint256 taskId, bool ok) = _pick(seed);
        if (!ok) return;
        try core.cancelUnaccepted(taskId) {} catch {}
    }

    function actClaim(uint256 seed, uint256 actorSeed) external {
        (uint256 taskId, bool ok) = _pick(seed);
        if (!ok) return;
        address[5] memory actors = [client, worker, bettors[0], bettors[1], bettors[2]];
        address actor = actors[bound(actorSeed, 0, 4)];
        vm.prank(actor);
        try core.claim(taskId) {} catch {}
    }

    function actSweepDust(uint256 seed) external {
        (uint256 taskId, bool ok) = _pick(seed);
        if (!ok) return;
        try core.sweepDust(taskId) {} catch {}
    }

    function actWithdrawValidatorFees() external {
        vm.prank(validator);
        try core.withdrawValidatorFees() {} catch {}
    }

    function actWithdrawTreasury() external {
        vm.prank(owner);
        try core.withdrawTreasury(owner) {} catch {}
    }

    // ---------------- views for the invariant ----------------

    function taskCount() external view returns (uint256) {
        return taskIds.length;
    }

    function _meta(uint256 taskId)
        internal
        view
        returns (uint128 reward, OracleCore.TaskState state, uint128 yesPool, uint128 noPool)
    {
        (,,,, reward,,,,,,,,,,,, state,, yesPool, noPool) = core.tasks(taskId);
    }

    function _windows(uint256 taskId) internal view returns (uint64 betCutoff, uint64 deadline) {
        (,,,,,, deadline,,,,,, betCutoff,,,,,,,) = core.tasks(taskId);
    }
}

/// I-1 (DESIGN §7.4 S7 / §12): for every reachable state,
/// usdc.balanceOf(core) >= Σ unclaimed entitlements + treasuryAccrued + Σ validatorAccrued.
contract InvariantSolvencyTest is Fixtures {
    OracleHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new OracleHandler(
            core,
            usdc,
            valReg,
            owner,
            client,
            worker,
            validator,
            [bettorP, bettorQ, bettorS],
            workerId,
            validatorId,
            [pId, qId, sId]
        );
        targetContract(address(handler));
    }

    function invariant_I1_solvency() public view {
        uint256 owed = uint256(core.treasuryAccrued()) + core.validatorAccrued(validator);

        address[6] memory actors = [client, worker, validator, bettorP, bettorQ, bettorS];
        uint256 n = core.nextTaskId();
        for (uint256 id = 1; id < n; id++) {
            (uint128 reward, OracleCore.TaskState state, uint128 yesPool, uint128 noPool) = _potMeta(id);
            if (state == OracleCore.TaskState.Settled || state == OracleCore.TaskState.Cancelled) {
                for (uint256 a = 0; a < actors.length; a++) {
                    owed += core.previewPayout(id, actors[a]);
                }
            } else if (state != OracleCore.TaskState.None) {
                // pre-settlement: the entire pot is still owed to someone
                owed += uint256(reward) + yesPool + noPool;
            }
        }
        assertGe(usdc.balanceOf(address(core)), owed, "I-1 solvency violated");
    }

    function invariant_taskIdsMonotonic() public view {
        assertGe(core.nextTaskId(), 1);
    }

    function _potMeta(uint256 taskId)
        internal
        view
        returns (uint128 reward, OracleCore.TaskState state, uint128 yesPool, uint128 noPool)
    {
        (,,,, reward,,,,,,,,,,,, state,, yesPool, noPool) = core.tasks(taskId);
    }
}
