// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Vm} from "forge-std/Vm.sol";
import {Fixtures} from "./helpers/Fixtures.sol";
import {OracleCore} from "../src/OracleCore.sol";
import {MockRevertingReputation} from "../src/mocks/MockReputationRegistry.sol";

/// U-7..U-11, U-15, U-16, U-18 (DESIGN §12): cutoff, delivery guards, the
/// R2–R5 resolution ladder, R6 finality, and feedback try/catch.
contract OracleCoreSettlementTest is Fixtures {
    // ------------------------------------------------------------------
    // U-7 cutoff enforcement
    // ------------------------------------------------------------------

    function test_U7_betAtOrAfterCutoffReverts() public {
        uint256 taskId = _acceptedTask();
        (,,, uint64 betCutoff) = _acceptMeta(taskId);

        vm.warp(betCutoff - 1); // last second still open
        vm.prank(bettorP);
        core.placeBet(taskId, pId, OracleCore.Side.Yes, 1e6);

        vm.warp(betCutoff);
        vm.prank(bettorP);
        vm.expectRevert(OracleCore.BetWindowClosed.selector);
        core.placeBet(taskId, pId, OracleCore.Side.Yes, 1e6);
    }

    // ------------------------------------------------------------------
    // U-8 delivery window guards
    // ------------------------------------------------------------------

    function test_U8_deliveryWindowGuards() public {
        uint256 taskId = _acceptedTask();
        (,,, uint64 betCutoff) = _acceptMeta(taskId);
        (,,,,,, uint64 deadline) = _creationMeta(taskId);
        bytes32 dHash = keccak256("deliverable");

        // before cutoff
        vm.prank(worker);
        vm.expectRevert(OracleCore.TooEarly.selector);
        core.submitDelivery(taskId, dHash, "http://evidence.zip");

        // only the worker wallet
        vm.warp(betCutoff);
        vm.prank(bettorP);
        vm.expectRevert(OracleCore.NotAgentController.selector);
        core.submitDelivery(taskId, dHash, "http://evidence.zip");

        // past deadline
        vm.warp(deadline + 1);
        vm.prank(worker);
        vm.expectRevert(OracleCore.DeadlinePassed.selector);
        core.submitDelivery(taskId, dHash, "http://evidence.zip");

        // happy path at the deadline boundary
        vm.warp(deadline);
        bytes32 expectedReqHash = keccak256(abi.encode(taskId, dHash));
        vm.expectEmit(true, false, false, true, address(core));
        emit OracleCore.ExecutionStarted(taskId);
        vm.expectEmit(true, false, false, true, address(core));
        emit OracleCore.DeliverySubmitted(taskId, dHash, expectedReqHash, "http://evidence.zip");
        vm.prank(worker);
        core.submitDelivery(taskId, dHash, "http://evidence.zip");

        (uint64 deliveredAt, bytes32 storedHash, bytes32 storedReqHash) = _deliveryMeta(taskId);
        assertEq(deliveredAt, deadline);
        assertEq(storedHash, dHash);
        assertEq(storedReqHash, expectedReqHash, "validationRequestHash = keccak256(abi.encode(taskId, hash))");
        (OracleCore.TaskState state,,,) = _taskMeta(taskId);
        assertEq(uint8(state), uint8(OracleCore.TaskState.Delivered));

        // double delivery reverts
        vm.prank(worker);
        vm.expectRevert(OracleCore.WrongState.selector);
        core.submitDelivery(taskId, dHash, "http://evidence.zip");
    }

    // ------------------------------------------------------------------
    // U-9 R2: YES at score 80 (threshold boundary)
    // ------------------------------------------------------------------

    function test_U9_R2_yesAtThreshold() public {
        uint256 taskId = _exampleTask();
        bytes32 reqHash = _deliver(taskId);

        // no response yet
        vm.expectRevert(OracleCore.ValidationMissing.selector);
        core.settleWithValidation(taskId);

        _respond(reqHash, 80);

        vm.expectEmit(true, false, false, true, address(core));
        emit OracleCore.OutcomeResolved(taskId, OracleCore.Outcome.Yes, 2, 80);
        vm.expectEmit(true, true, false, true, address(core));
        emit OracleCore.FeedbackPosted(taskId, workerId, 100);
        vm.prank(stranger); // anyone
        core.settleWithValidation(taskId);

        (OracleCore.TaskState state, OracleCore.Outcome outcome,,) = _taskMeta(taskId);
        assertEq(uint8(state), uint8(OracleCore.TaskState.Settled));
        assertEq(uint8(outcome), uint8(OracleCore.Outcome.Yes));

        // fee on losing pool 50e6 = 1e6, split 50/50 with the validator (R2)
        assertEq(core.validatorAccrued(validator), 0.5e6);
        assertEq(core.treasuryAccrued(), 0.5e6);

        // reputation row: value 100, tag1 "oracle.outcome", tag2 = taskId
        (, uint256 fbAgent, int128 fbValue,, bytes32 tag1, bytes32 tag2,,,) = repReg.feedbacks(0);
        assertEq(fbAgent, workerId);
        assertEq(fbValue, 100);
        assertEq(tag1, bytes32("oracle.outcome"));
        assertEq(tag2, bytes32(taskId));

        // settle is write-once
        vm.expectRevert(OracleCore.WrongState.selector);
        core.settleWithValidation(taskId);
    }

    // ------------------------------------------------------------------
    // U-10 R3: NO at score 79
    // ------------------------------------------------------------------

    function test_U10_R3_noBelowThreshold() public {
        uint256 taskId = _exampleTask();
        bytes32 reqHash = _deliver(taskId);
        _respond(reqHash, 79);

        vm.expectEmit(true, false, false, true, address(core));
        emit OracleCore.OutcomeResolved(taskId, OracleCore.Outcome.No, 3, 79);
        core.settleWithValidation(taskId);

        (, OracleCore.Outcome outcome,,) = _taskMeta(taskId);
        assertEq(uint8(outcome), uint8(OracleCore.Outcome.No));
        // R3 still pays the validator its fee share
        assertEq(core.validatorAccrued(validator), 0.5e6);
        assertEq(core.treasuryAccrued(), 0.5e6);
    }

    // ------------------------------------------------------------------
    // U-11 R6: late validation is ignored; DR-6 status must match task
    // ------------------------------------------------------------------

    function test_U11_R6_lateValidationReverts() public {
        uint256 taskId = _exampleTask();
        bytes32 reqHash = _deliver(taskId);
        (uint64 deliveredAt,,) = _deliveryMeta(taskId);

        vm.warp(uint256(deliveredAt) + DISPUTE_WINDOW + 1); // validator responds late
        _respond(reqHash, 100);

        vm.expectRevert(OracleCore.ValidationLate.selector);
        core.settleWithValidation(taskId);
    }

    function test_U11_DR6_wrongValidatorRejected() public {
        // the worker directs the validation request at a friendlier validator
        uint256 taskId = _exampleTask();
        (,,, uint64 betCutoff) = _acceptMeta(taskId);
        vm.warp(betCutoff);
        bytes32 dHash = keccak256("deliverable");
        bytes32 reqHash = keccak256(abi.encode(taskId, dHash));
        vm.prank(worker);
        core.submitDelivery(taskId, dHash, "http://evidence.zip");

        address friendly = makeAddr("friendly");
        vm.prank(worker);
        valReg.validationRequest(friendly, workerId, "http://evidence.zip", reqHash);
        vm.prank(friendly);
        valReg.validationResponse(reqHash, 100, "http://report.json", keccak256("r"), "oracle");

        vm.expectRevert(OracleCore.ValidationMissing.selector);
        core.settleWithValidation(taskId);
    }

    function test_U11_DR6_wrongAgentIdRejected() public {
        // request registered under a different agentId than the task's worker
        uint256 taskId = _exampleTask();
        (,,, uint64 betCutoff) = _acceptMeta(taskId);
        vm.warp(betCutoff);
        bytes32 dHash = keccak256("deliverable");
        bytes32 reqHash = keccak256(abi.encode(taskId, dHash));
        vm.prank(worker);
        core.submitDelivery(taskId, dHash, "http://evidence.zip");

        vm.prank(worker);
        valReg.validationRequest(validator, pId, "http://evidence.zip", reqHash);
        _respond(reqHash, 100);

        vm.expectRevert(OracleCore.ValidationMissing.selector);
        core.settleWithValidation(taskId);
    }

    // ------------------------------------------------------------------
    // U-15 R4: client attestation, both branches + window guards
    // ------------------------------------------------------------------

    function test_U15_R4_attestApproved() public {
        uint256 taskId = _exampleTask();
        _deliver(taskId);
        (uint64 deliveredAt,,) = _deliveryMeta(taskId);

        // too early: dispute window still running
        vm.warp(uint256(deliveredAt) + DISPUTE_WINDOW);
        vm.prank(client);
        vm.expectRevert(OracleCore.TooEarly.selector);
        core.attest(taskId, true);

        // client only
        vm.warp(uint256(deliveredAt) + DISPUTE_WINDOW + 1);
        vm.prank(stranger);
        vm.expectRevert(OracleCore.NotAgentController.selector);
        core.attest(taskId, true);

        vm.expectEmit(true, false, false, true, address(core));
        emit OracleCore.OutcomeResolved(taskId, OracleCore.Outcome.Yes, 4, 0);
        vm.prank(client);
        core.attest(taskId, true);

        (, OracleCore.Outcome outcome,,) = _taskMeta(taskId);
        assertEq(uint8(outcome), uint8(OracleCore.Outcome.Yes));
        // R4 is not a validation rule: full fee to treasury
        assertEq(core.validatorAccrued(validator), 0);
        assertEq(core.treasuryAccrued(), 1e6);
    }

    function test_U15_R4_attestRejected() public {
        uint256 taskId = _exampleTask();
        _deliver(taskId);
        (uint64 deliveredAt,,) = _deliveryMeta(taskId);

        vm.warp(uint256(deliveredAt) + DISPUTE_WINDOW + GRACE_WINDOW); // last valid second
        vm.expectEmit(true, false, false, true, address(core));
        emit OracleCore.OutcomeResolved(taskId, OracleCore.Outcome.No, 4, 0);
        vm.prank(client);
        core.attest(taskId, false);

        (, OracleCore.Outcome outcome,,) = _taskMeta(taskId);
        assertEq(uint8(outcome), uint8(OracleCore.Outcome.No));
    }

    function test_U15_R4_windowAndPrecedenceGuards() public {
        uint256 taskId = _exampleTask();
        bytes32 reqHash = _deliver(taskId);
        (uint64 deliveredAt,,) = _deliveryMeta(taskId);

        // past the grace window
        vm.warp(uint256(deliveredAt) + DISPUTE_WINDOW + GRACE_WINDOW + 1);
        vm.prank(client);
        vm.expectRevert(OracleCore.DeadlinePassed.selector);
        core.attest(taskId, true);

        // a fresh task where the validator DID respond in-window but nobody
        // settled: the client cannot override R2/R3 via R4
        uint256 task2 = _exampleTask();
        bytes32 req2 = _deliver(task2);
        _respond(req2, 50);
        (uint64 deliveredAt2,,) = _deliveryMeta(task2);
        vm.warp(uint256(deliveredAt2) + DISPUTE_WINDOW + 1);
        vm.prank(client);
        vm.expectRevert(OracleCore.WrongState.selector);
        core.attest(task2, true);

        // R3 still settles it
        core.settleWithValidation(task2);
        (, OracleCore.Outcome outcome,,) = _taskMeta(task2);
        assertEq(uint8(outcome), uint8(OracleCore.Outcome.No));
        // silence unused warning
        reqHash;
    }

    // ------------------------------------------------------------------
    // U-16 R5: validator and client both silent => default YES
    // ------------------------------------------------------------------

    function test_U16_R5_defaultYes() public {
        uint256 taskId = _exampleTask();
        _deliver(taskId);
        (uint64 deliveredAt,,) = _deliveryMeta(taskId);

        vm.warp(uint256(deliveredAt) + DISPUTE_WINDOW + GRACE_WINDOW);
        vm.expectRevert(OracleCore.TooEarly.selector);
        core.settleByTimeout(taskId);

        vm.warp(uint256(deliveredAt) + DISPUTE_WINDOW + GRACE_WINDOW + 1);
        vm.expectEmit(true, false, false, true, address(core));
        emit OracleCore.OutcomeResolved(taskId, OracleCore.Outcome.Yes, 5, 0);
        vm.prank(stranger); // anyone
        core.settleByTimeout(taskId);

        (, OracleCore.Outcome outcome,,) = _taskMeta(taskId);
        assertEq(uint8(outcome), uint8(OracleCore.Outcome.Yes));
        // non-validation rule: full fee to treasury
        assertEq(core.validatorAccrued(validator), 0);
        assertEq(core.treasuryAccrued(), 1e6);
    }

    function test_U16_R5_blockedByInWindowResponse() public {
        uint256 taskId = _exampleTask();
        bytes32 reqHash = _deliver(taskId);
        _respond(reqHash, 100); // in-window response, nobody settles
        (uint64 deliveredAt,,) = _deliveryMeta(taskId);

        vm.warp(uint256(deliveredAt) + DISPUTE_WINDOW + GRACE_WINDOW + 1);
        vm.expectRevert(OracleCore.WrongState.selector);
        core.settleByTimeout(taskId); // R2 takes precedence

        core.settleWithValidation(taskId);
        (, OracleCore.Outcome outcome,,) = _taskMeta(taskId);
        assertEq(uint8(outcome), uint8(OracleCore.Outcome.Yes));
    }

    // ------------------------------------------------------------------
    // U-18 feedback try/catch: settlement survives a reverting registry
    // ------------------------------------------------------------------

    function test_U18_settlementSurvivesRegistryRevert() public {
        MockRevertingReputation badRep = new MockRevertingReputation();
        OracleCore core2 = new OracleCore(
            address(usdc), address(idReg), address(badRep), address(valReg), owner, _defaultParams()
        );
        vm.prank(client);
        usdc.approve(address(core2), type(uint256).max);
        vm.prank(worker);
        usdc.approve(address(core2), type(uint256).max);

        vm.prank(client);
        uint256 taskId = core2.createTask(
            workerId, validatorId, REWARD, uint64(block.timestamp + 3000), keccak256("spec"), "http://spec.json"
        );
        vm.prank(worker);
        core2.acceptAndStake(taskId, workerId, STAKE);
        (,,,,,,,,,,,, uint64 betCutoff,,,,,,,) = core2.tasks(taskId);
        vm.warp(betCutoff);
        bytes32 dHash = keccak256("deliverable");
        bytes32 reqHash = keccak256(abi.encode(taskId, dHash));
        vm.prank(worker);
        core2.submitDelivery(taskId, dHash, "http://evidence.zip");
        vm.prank(worker);
        valReg.validationRequest(validator, workerId, "http://evidence.zip", reqHash);
        vm.prank(validator);
        valReg.validationResponse(reqHash, 100, "http://report.json", keccak256("r"), "oracle");

        vm.recordLogs();
        core2.settleWithValidation(taskId); // MUST NOT revert
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) {
            assertTrue(
                logs[i].topics[0] != OracleCore.FeedbackPosted.selector,
                "FeedbackPosted must not be emitted when giveFeedback reverts"
            );
        }

        (,,,,,,,,,,,,,,,, OracleCore.TaskState state, OracleCore.Outcome outcome,,) = core2.tasks(taskId);
        assertEq(uint8(state), uint8(OracleCore.TaskState.Settled));
        assertEq(uint8(outcome), uint8(OracleCore.Outcome.Yes));

        // money still flows: worker claims stake + reward (no other bettors)
        uint256 before = usdc.balanceOf(worker);
        vm.prank(worker);
        core2.claim(taskId);
        assertEq(usdc.balanceOf(worker) - before, uint256(STAKE) + REWARD);
    }
}
