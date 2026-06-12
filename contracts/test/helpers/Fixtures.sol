// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../../src/mocks/MockUSDC.sol";
import {MockIdentityRegistry} from "../../src/mocks/MockIdentityRegistry.sol";
import {MockReputationRegistry, MockRevertingReputation} from "../../src/mocks/MockReputationRegistry.sol";
import {ValidationRegistry} from "../../src/registries/ValidationRegistry.sol";
import {OracleCore} from "../../src/OracleCore.sol";

/// @notice Shared fixture: mocks + ValidationRegistry + OracleCore with the
///         DESIGN §6.2 default parameter column; agents 1=worker, 2=validator,
///         3..5=bettors P/Q/S; everyone funded and approved.
contract Fixtures is Test {
    MockUSDC internal usdc;
    MockIdentityRegistry internal idReg;
    MockReputationRegistry internal repReg;
    ValidationRegistry internal valReg;
    OracleCore internal core;

    address internal owner = makeAddr("owner");
    address internal client = makeAddr("client");
    address internal worker = makeAddr("worker");
    address internal validator = makeAddr("validator");
    address internal bettorP = makeAddr("bettorP");
    address internal bettorQ = makeAddr("bettorQ");
    address internal bettorS = makeAddr("bettorS");
    address internal stranger = makeAddr("stranger");

    uint64 internal workerId;
    uint64 internal validatorId;
    uint64 internal pId;
    uint64 internal qId;
    uint64 internal sId;

    // DESIGN §6.2 default column
    uint16 internal constant MIN_SELF_STAKE_BPS = 1000;
    uint16 internal constant PROTOCOL_FEE_BPS = 200;
    uint16 internal constant VALIDATOR_FEE_SHARE_BPS = 5000;
    uint32 internal constant BETTING_WINDOW = 600;
    uint32 internal constant ACCEPT_WINDOW = 3600;
    uint32 internal constant DISPUTE_WINDOW = 600;
    uint32 internal constant GRACE_WINDOW = 300;
    uint8 internal constant VALIDATION_THRESHOLD = 80;
    uint128 internal constant MIN_BET = 100_000;
    uint128 internal constant MAX_POOL_PER_SIDE = 10_000e6;
    uint128 internal constant MIN_REWARD = 1_000_000;

    // §6.5 worked-example amounts
    uint128 internal constant REWARD = 100e6;
    uint128 internal constant STAKE = 15e6;

    function setUp() public virtual {
        vm.warp(1_750_000_000);
        usdc = new MockUSDC();
        idReg = new MockIdentityRegistry();
        repReg = new MockReputationRegistry();
        valReg = new ValidationRegistry();
        core = new OracleCore(
            address(usdc), address(idReg), address(repReg), address(valReg), owner, _defaultParams()
        );

        vm.prank(worker);
        workerId = uint64(idReg.register("http://localhost:8402/.well-known/agents/worker.json"));
        vm.prank(validator);
        validatorId = uint64(idReg.register("http://localhost:8402/.well-known/agents/validator.json"));
        vm.prank(bettorP);
        pId = uint64(idReg.register("http://localhost:8402/.well-known/agents/bettor-rep.json"));
        vm.prank(bettorQ);
        qId = uint64(idReg.register("http://localhost:8402/.well-known/agents/bettor-skeptic.json"));
        vm.prank(bettorS);
        sId = uint64(idReg.register("http://localhost:8402/.well-known/agents/bettor-mirror.json"));

        address[7] memory accounts = [client, worker, validator, bettorP, bettorQ, bettorS, stranger];
        for (uint256 i = 0; i < accounts.length; i++) {
            usdc.mint(accounts[i], 1_000_000e6);
            vm.prank(accounts[i]);
            usdc.approve(address(core), type(uint256).max);
        }
    }

    function _defaultParams() internal pure returns (OracleCore.Params memory) {
        return OracleCore.Params({
            minSelfStakeBps: MIN_SELF_STAKE_BPS,
            protocolFeeBps: PROTOCOL_FEE_BPS,
            validatorFeeShareBps: VALIDATOR_FEE_SHARE_BPS,
            bettingWindow: BETTING_WINDOW,
            acceptWindow: ACCEPT_WINDOW,
            disputeWindow: DISPUTE_WINDOW,
            graceWindow: GRACE_WINDOW,
            validationThreshold: VALIDATION_THRESHOLD,
            minBet: MIN_BET,
            maxPoolPerSide: MAX_POOL_PER_SIDE,
            minReward: MIN_REWARD
        });
    }

    // ------------------------------------------------------------------
    // task lifecycle helpers
    // ------------------------------------------------------------------

    function _createTask() internal returns (uint256 taskId) {
        vm.prank(client);
        taskId = core.createTask(
            workerId, validatorId, REWARD, uint64(block.timestamp + 3000), keccak256("spec"), "http://spec.json"
        );
    }

    function _acceptedTask() internal returns (uint256 taskId) {
        taskId = _createTask();
        vm.prank(worker);
        core.acceptAndStake(taskId, workerId, STAKE);
    }

    /// §6.5 worked example: Y = 15e6 (worker) + 35e6 (P) ; N = 30e6 (Q) + 20e6 (S)
    function _exampleTask() internal returns (uint256 taskId) {
        taskId = _acceptedTask();
        vm.prank(bettorP);
        core.placeBet(taskId, pId, OracleCore.Side.Yes, 35e6);
        vm.prank(bettorQ);
        core.placeBet(taskId, qId, OracleCore.Side.No, 30e6);
        vm.prank(bettorS);
        core.placeBet(taskId, sId, OracleCore.Side.No, 20e6);
    }

    /// Warps to betCutoff, delivers, and performs DR-6 path (b): the worker
    /// itself files the validationRequest on the ValidationRegistry.
    function _deliver(uint256 taskId) internal returns (bytes32 reqHash) {
        (,,, uint64 betCutoff) = _acceptMeta(taskId);
        if (block.timestamp < betCutoff) vm.warp(betCutoff);
        bytes32 deliverableHash = keccak256("deliverable");
        reqHash = keccak256(abi.encode(taskId, deliverableHash));
        vm.prank(worker);
        core.submitDelivery(taskId, deliverableHash, "http://evidence.zip");
        vm.prank(worker);
        valReg.validationRequest(validator, workerId, "http://evidence.zip", reqHash);
    }

    function _respond(bytes32 reqHash, uint8 score) internal {
        vm.prank(validator);
        valReg.validationResponse(reqHash, score, "http://report.json", keccak256("report"), "oracle");
    }

    // ------------------------------------------------------------------
    // tasks(taskId) getter destructuring helpers (20-field tuple)
    // ------------------------------------------------------------------

    function _creationMeta(uint256 taskId)
        internal
        view
        returns (
            address client_,
            uint64 workerAgentId,
            uint64 validatorAgentId,
            address validatorWallet,
            uint128 reward,
            uint64 createdAt,
            uint64 deadline
        )
    {
        (client_, workerAgentId, validatorAgentId, validatorWallet, reward, createdAt, deadline,,,,,,,,,,,,,) =
            core.tasks(taskId);
    }

    function _acceptMeta(uint256 taskId)
        internal
        view
        returns (address workerWallet, uint128 selfStake, uint64 acceptedAt, uint64 betCutoff)
    {
        (,,,,,,,,, workerWallet, selfStake, acceptedAt, betCutoff,,,,,,,) = core.tasks(taskId);
    }

    function _deliveryMeta(uint256 taskId)
        internal
        view
        returns (uint64 deliveredAt, bytes32 deliverableHash, bytes32 validationRequestHash)
    {
        (,,,,,,,,,,,,, deliveredAt, deliverableHash, validationRequestHash,,,,) = core.tasks(taskId);
    }

    function _taskMeta(uint256 taskId)
        internal
        view
        returns (OracleCore.TaskState state, OracleCore.Outcome outcome, uint128 yesPool, uint128 noPool)
    {
        (,,,,,,,,,,,,,,,, state, outcome, yesPool, noPool) = core.tasks(taskId);
    }
}
