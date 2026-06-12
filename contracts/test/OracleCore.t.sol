// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Fixtures} from "./helpers/Fixtures.sol";
import {OracleCore} from "../src/OracleCore.sol";

/// U-1..U-6 (DESIGN §12): creation, R0 cancel, accept/stake, bet eligibility,
/// role bans, R1 timeout.
contract OracleCoreTest is Fixtures {
    // ------------------------------------------------------------------
    // U-1 createTask escrows reward & emits
    // ------------------------------------------------------------------

    function test_U1_createTask_escrowsRewardAndEmits() public {
        uint256 clientBefore = usdc.balanceOf(client);
        uint64 deadline = uint64(block.timestamp + 3000);

        vm.expectEmit(true, true, false, true, address(core));
        emit OracleCore.TaskCreated(1, client, workerId, validatorId, REWARD, deadline, "http://spec.json");
        vm.prank(client);
        uint256 taskId =
            core.createTask(workerId, validatorId, REWARD, deadline, keccak256("spec"), "http://spec.json");

        assertEq(taskId, 1, "first taskId is 1");
        assertEq(core.nextTaskId(), 2);
        assertEq(usdc.balanceOf(address(core)), REWARD, "reward escrowed");
        assertEq(usdc.balanceOf(client), clientBefore - REWARD);

        (
            address client_,
            uint64 wId,
            uint64 vId,
            address vWallet,
            uint128 reward,
            uint64 createdAt,
            uint64 storedDeadline
        ) = _creationMeta(taskId);
        assertEq(client_, client);
        assertEq(wId, workerId);
        assertEq(vId, validatorId);
        assertEq(vWallet, validator, "validator wallet resolved from IdentityRegistry");
        assertEq(reward, REWARD);
        assertEq(createdAt, uint64(block.timestamp));
        assertEq(storedDeadline, deadline);
        (OracleCore.TaskState state,,,) = _taskMeta(taskId);
        assertEq(uint8(state), uint8(OracleCore.TaskState.Created));
    }

    function test_U1_createTask_badParamsRevert() public {
        uint64 deadline = uint64(block.timestamp + 3000);

        // reward below MIN_REWARD
        vm.prank(client);
        vm.expectRevert(OracleCore.BadParams.selector);
        core.createTask(workerId, validatorId, MIN_REWARD - 1, deadline, keccak256("s"), "u");

        // deadline must exceed now + BETTING_WINDOW
        vm.prank(client);
        vm.expectRevert(OracleCore.BadParams.selector);
        core.createTask(workerId, validatorId, REWARD, uint64(block.timestamp + BETTING_WINDOW), keccak256("s"), "u");

        // worker and validator agents must be distinct
        vm.prank(client);
        vm.expectRevert(OracleCore.BadParams.selector);
        core.createTask(workerId, workerId, REWARD, deadline, keccak256("s"), "u");

        // nonexistent agent ids
        vm.prank(client);
        vm.expectRevert(OracleCore.BadParams.selector);
        core.createTask(999, validatorId, REWARD, deadline, keccak256("s"), "u");
        vm.prank(client);
        vm.expectRevert(OracleCore.BadParams.selector);
        core.createTask(workerId, 999, REWARD, deadline, keccak256("s"), "u");
    }

    // ------------------------------------------------------------------
    // U-2 R0: cancelUnaccepted + full refund
    // ------------------------------------------------------------------

    function test_U2_R0_cancelUnacceptedRefundsClient() public {
        uint256 taskId = _createTask();

        // too early
        vm.expectRevert(OracleCore.TooEarly.selector);
        core.cancelUnaccepted(taskId);

        vm.warp(block.timestamp + ACCEPT_WINDOW + 1);
        vm.expectEmit(true, false, false, true, address(core));
        emit OracleCore.TaskCancelled(taskId);
        vm.prank(stranger); // anyone may trigger R0
        core.cancelUnaccepted(taskId);

        (OracleCore.TaskState state,,,) = _taskMeta(taskId);
        assertEq(uint8(state), uint8(OracleCore.TaskState.Cancelled));

        // acceptance is no longer possible
        vm.prank(worker);
        vm.expectRevert(OracleCore.WrongState.selector);
        core.acceptAndStake(taskId, workerId, STAKE);

        // E3: client reclaims the full reward via claim()
        uint256 before = usdc.balanceOf(client);
        assertEq(core.previewPayout(taskId, client), REWARD);
        vm.expectEmit(true, true, false, true, address(core));
        emit OracleCore.Claimed(taskId, client, REWARD);
        vm.prank(client);
        core.claim(taskId);
        assertEq(usdc.balanceOf(client) - before, REWARD);
        assertEq(usdc.balanceOf(address(core)), 0);

        // double cancel reverts
        vm.expectRevert(OracleCore.WrongState.selector);
        core.cancelUnaccepted(taskId);
    }

    function test_U2_R0_acceptAfterWindowReverts() public {
        uint256 taskId = _createTask();
        vm.warp(block.timestamp + ACCEPT_WINDOW + 1);
        vm.prank(worker);
        vm.expectRevert(OracleCore.DeadlinePassed.selector);
        core.acceptAndStake(taskId, workerId, STAKE);
    }

    // ------------------------------------------------------------------
    // U-3 acceptAndStake enforces min stake & atomic pull
    // ------------------------------------------------------------------

    function test_U3_acceptAndStake_enforcesMinStakeAndPulls() public {
        uint256 taskId = _createTask();
        uint128 minStake = uint128((uint256(REWARD) * MIN_SELF_STAKE_BPS) / 10_000); // 10e6

        vm.prank(worker);
        vm.expectRevert(OracleCore.BelowMinSelfStake.selector);
        core.acceptAndStake(taskId, workerId, minStake - 1);

        // caller must control the worker agent
        vm.prank(stranger);
        vm.expectRevert(OracleCore.NotAgentController.selector);
        core.acceptAndStake(taskId, workerId, STAKE);

        // agentId must match the task's worker agent
        vm.prank(bettorP);
        vm.expectRevert(OracleCore.BadParams.selector);
        core.acceptAndStake(taskId, pId, STAKE);

        uint256 workerBefore = usdc.balanceOf(worker);
        vm.expectEmit(true, true, false, true, address(core));
        emit OracleCore.TaskAccepted(taskId, workerId, worker, STAKE, uint64(block.timestamp + BETTING_WINDOW));
        vm.prank(worker);
        core.acceptAndStake(taskId, workerId, STAKE);

        assertEq(workerBefore - usdc.balanceOf(worker), STAKE, "stake pulled atomically");
        assertEq(usdc.balanceOf(address(core)), REWARD + STAKE);

        (address workerWallet, uint128 selfStake, uint64 acceptedAt, uint64 betCutoff) = _acceptMeta(taskId);
        assertEq(workerWallet, worker);
        assertEq(selfStake, STAKE);
        assertEq(acceptedAt, uint64(block.timestamp));
        assertEq(betCutoff, uint64(block.timestamp) + BETTING_WINDOW);

        (OracleCore.TaskState state,, uint128 yesPool, uint128 noPool) = _taskMeta(taskId);
        assertEq(uint8(state), uint8(OracleCore.TaskState.Open));
        assertEq(yesPool, STAKE, "self-stake seeds YES pool");
        assertEq(noPool, 0);
        assertEq(core.positions(taskId, worker, 0), STAKE, "self-stake tracked as YES position");

        // double accept reverts
        vm.prank(worker);
        vm.expectRevert(OracleCore.WrongState.selector);
        core.acceptAndStake(taskId, workerId, STAKE);
    }

    // ------------------------------------------------------------------
    // U-4 bet eligibility
    // ------------------------------------------------------------------

    function test_U4_placeBet_eligibility() public {
        uint256 taskId = _acceptedTask();

        // caller does not control the named agent
        vm.prank(stranger);
        vm.expectRevert(OracleCore.NotAgentController.selector);
        core.placeBet(taskId, pId, OracleCore.Side.Yes, 1e6);

        // unregistered agent id
        vm.prank(stranger);
        vm.expectRevert(OracleCore.NotAgentController.selector);
        core.placeBet(taskId, 999, OracleCore.Side.Yes, 1e6);

        // dust bet
        vm.prank(bettorP);
        vm.expectRevert(OracleCore.BelowMinBet.selector);
        core.placeBet(taskId, pId, OracleCore.Side.Yes, MIN_BET - 1);

        // pool cap
        vm.prank(bettorP);
        vm.expectRevert(OracleCore.PoolCapExceeded.selector);
        core.placeBet(taskId, pId, OracleCore.Side.Yes, MAX_POOL_PER_SIDE); // 15e6 already in YES

        // happy path: B5 event carries the new pools
        vm.expectEmit(true, true, false, true, address(core));
        emit OracleCore.BetPlaced(taskId, pId, bettorP, OracleCore.Side.Yes, 35e6, STAKE + 35e6, 0);
        vm.prank(bettorP);
        core.placeBet(taskId, pId, OracleCore.Side.Yes, 35e6);

        vm.prank(bettorQ);
        core.placeBet(taskId, qId, OracleCore.Side.No, 30e6);

        (,, uint128 yesPool, uint128 noPool) = _taskMeta(taskId);
        assertEq(yesPool, 50e6);
        assertEq(noPool, 30e6);
        assertEq(core.positions(taskId, bettorP, 0), 35e6);
        assertEq(core.positions(taskId, bettorQ, 1), 30e6);
        assertEq(core.impliedProbabilityBps(taskId), 6250); // 50/80

        // B3: same bettor may add on both sides
        vm.prank(bettorQ);
        core.placeBet(taskId, qId, OracleCore.Side.Yes, 1e6);
        assertEq(core.positions(taskId, bettorQ, 0), 1e6);

        // betting on an unaccepted task reverts WrongState
        uint256 created = _createTask();
        vm.prank(bettorP);
        vm.expectRevert(OracleCore.WrongState.selector);
        core.placeBet(created, pId, OracleCore.Side.Yes, 1e6);
    }

    // ------------------------------------------------------------------
    // U-5 role bans (by address AND agentId)
    // ------------------------------------------------------------------

    function test_U5_roleBans() public {
        uint256 taskId = _acceptedTask();

        // client is banned by address even with a freshly registered agent
        vm.prank(client);
        uint64 clientId = uint64(idReg.register("client.json"));
        vm.prank(client);
        vm.expectRevert(OracleCore.RoleBanned.selector);
        core.placeBet(taskId, clientId, OracleCore.Side.Yes, 1e6);

        // validator banned (address + own agentId)
        vm.prank(validator);
        vm.expectRevert(OracleCore.RoleBanned.selector);
        core.placeBet(taskId, validatorId, OracleCore.Side.No, 1e6);

        // validator banned by agentId via a delegated wallet
        address vDelegate = makeAddr("vDelegate");
        usdc.mint(vDelegate, 100e6);
        vm.prank(vDelegate);
        usdc.approve(address(core), type(uint256).max);
        vm.prank(validator);
        idReg.setAgentWallet(validatorId, vDelegate);
        vm.prank(vDelegate);
        vm.expectRevert(OracleCore.RoleBanned.selector);
        core.placeBet(taskId, validatorId, OracleCore.Side.Yes, 1e6);

        // worker MUST NOT bet NO ...
        vm.prank(worker);
        vm.expectRevert(OracleCore.RoleBanned.selector);
        core.placeBet(taskId, workerId, OracleCore.Side.No, 1e6);

        // ... by agentId through a delegated wallet either
        address wDelegate = makeAddr("wDelegate");
        usdc.mint(wDelegate, 100e6);
        vm.prank(wDelegate);
        usdc.approve(address(core), type(uint256).max);
        vm.prank(worker);
        idReg.setAgentWallet(workerId, wDelegate);
        vm.prank(wDelegate);
        vm.expectRevert(OracleCore.RoleBanned.selector);
        core.placeBet(taskId, workerId, OracleCore.Side.No, 1e6);

        // worker MAY add YES via placeBet
        vm.prank(worker);
        core.placeBet(taskId, workerId, OracleCore.Side.Yes, 5e6);
        assertEq(core.positions(taskId, worker, 0), STAKE + 5e6);
    }

    // ------------------------------------------------------------------
    // U-6 R1: no delivery by deadline => NO
    // ------------------------------------------------------------------

    function test_U6_R1_timeoutSettlesNo() public {
        uint256 taskId = _exampleTask();

        (,,,,,, uint64 deadline) = _creationMeta(taskId);
        vm.warp(deadline); // delivery still allowed at the deadline itself
        vm.expectRevert(OracleCore.TooEarly.selector);
        core.settleByTimeout(taskId);

        vm.warp(deadline + 1);
        vm.expectEmit(true, false, false, true, address(core));
        emit OracleCore.OutcomeResolved(taskId, OracleCore.Outcome.No, 1, 0);
        vm.prank(stranger); // anyone
        core.settleByTimeout(taskId);

        (OracleCore.TaskState state, OracleCore.Outcome outcome,,) = _taskMeta(taskId);
        assertEq(uint8(state), uint8(OracleCore.TaskState.Settled));
        assertEq(uint8(outcome), uint8(OracleCore.Outcome.No));

        // R1 is not a validation rule: full fee to treasury, none to validator
        // L = yesPool = 50e6, fee = 1e6
        assertEq(core.treasuryAccrued(), 1e6);
        assertEq(core.validatorAccrued(validator), 0);

        // outcome is write-once
        vm.expectRevert(OracleCore.WrongState.selector);
        core.settleByTimeout(taskId);

        // reputation write-back: value 0 for NO
        assertEq(repReg.feedbackCount(), 1);
        (address fbClient, uint256 fbAgent, int128 fbValue,,,,,,) = repReg.feedbacks(0);
        assertEq(fbClient, address(core));
        assertEq(fbAgent, workerId);
        assertEq(fbValue, 0);
    }
}
