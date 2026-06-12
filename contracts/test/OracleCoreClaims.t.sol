// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Fixtures} from "./helpers/Fixtures.sol";
import {OracleCore} from "../src/OracleCore.sol";

/// U-12..U-14, U-17 (DESIGN §12): exact §6.5 payout math, E1/E2 edges,
/// claim idempotence, pause gating, DR-8 validator fees, dust sweep.
contract OracleCoreClaimsTest is Fixtures {
    // ------------------------------------------------------------------
    // U-12 payout matrix equals the §6.5 worked example to the unit
    // ------------------------------------------------------------------

    function test_U12_workedExample_outcomeYes() public {
        uint256 taskId = _exampleTask(); // Y = 15 + 35, N = 30 + 20
        assertEq(core.impliedProbabilityBps(taskId), 5000, "p = 0.50 at cutoff");
        bytes32 reqHash = _deliver(taskId);
        _respond(reqHash, 100);
        core.settleWithValidation(taskId); // R2 => YES

        // §6.5: fee = 1e6 (validator 0.5e6, treasury 0.5e6), Ld = 49e6
        assertEq(core.validatorAccrued(validator), 0.5e6, "validator fee share");
        assertEq(core.treasuryAccrued(), 0.5e6, "treasury fee share");

        assertEq(core.previewPayout(taskId, worker), 129.7e6, "worker: 15 + 14.7 + 100");
        assertEq(core.previewPayout(taskId, bettorP), 69.3e6, "P: 35 + 34.3");
        assertEq(core.previewPayout(taskId, bettorQ), 0);
        assertEq(core.previewPayout(taskId, bettorS), 0);
        assertEq(core.previewPayout(taskId, client), 0, "client receives nothing back on YES");

        uint256 wBefore = usdc.balanceOf(worker);
        vm.prank(worker);
        core.claim(taskId);
        assertEq(usdc.balanceOf(worker) - wBefore, 129.7e6);

        uint256 pBefore = usdc.balanceOf(bettorP);
        vm.prank(bettorP);
        core.claim(taskId);
        assertEq(usdc.balanceOf(bettorP) - pBefore, 69.3e6);

        vm.prank(bettorQ);
        vm.expectRevert(OracleCore.NothingToClaim.selector);
        core.claim(taskId);
        vm.prank(bettorS);
        vm.expectRevert(OracleCore.NothingToClaim.selector);
        core.claim(taskId);

        // DR-8 withdrawal + treasury: contract fully drains, to the unit
        vm.prank(validator);
        core.withdrawValidatorFees();
        assertEq(core.validatorAccrued(validator), 0);
        vm.prank(owner);
        core.withdrawTreasury(owner);
        assertEq(usdc.balanceOf(address(core)), 0, "no dust in the worked example");
    }

    function test_U12_workedExample_outcomeNo() public {
        uint256 taskId = _exampleTask();
        bytes32 reqHash = _deliver(taskId);
        _respond(reqHash, 0);
        core.settleWithValidation(taskId); // R3 => NO

        assertEq(core.validatorAccrued(validator), 0.5e6);
        assertEq(core.treasuryAccrued(), 0.5e6);

        assertEq(core.previewPayout(taskId, bettorQ), 59.4e6, "Q: 30 + 29.4");
        assertEq(core.previewPayout(taskId, bettorS), 39.6e6, "S: 20 + 19.6");
        assertEq(core.previewPayout(taskId, client), 100e6, "client refund");
        assertEq(core.previewPayout(taskId, worker), 0, "worker loses self-stake AND earns nothing");
        assertEq(core.previewPayout(taskId, bettorP), 0, "losing YES bettor");

        uint256 qBefore = usdc.balanceOf(bettorQ);
        vm.prank(bettorQ);
        core.claim(taskId);
        assertEq(usdc.balanceOf(bettorQ) - qBefore, 59.4e6);

        uint256 sBefore = usdc.balanceOf(bettorS);
        vm.prank(bettorS);
        core.claim(taskId);
        assertEq(usdc.balanceOf(bettorS) - sBefore, 39.6e6);

        uint256 cBefore = usdc.balanceOf(client);
        vm.prank(client);
        core.claim(taskId);
        assertEq(usdc.balanceOf(client) - cBefore, 100e6);

        vm.prank(worker);
        vm.expectRevert(OracleCore.NothingToClaim.selector);
        core.claim(taskId);

        vm.prank(validator);
        core.withdrawValidatorFees();
        vm.prank(owner);
        core.withdrawTreasury(owner);
        assertEq(usdc.balanceOf(address(core)), 0);
    }

    // ------------------------------------------------------------------
    // U-13 E1/E2 edges
    // ------------------------------------------------------------------

    function test_U13_E1_noLosingCapital_yes() public {
        // N = 0, outcome YES: yes bettors reclaim exactly their stakes, fee = 0
        uint256 taskId = _acceptedTask();
        bytes32 reqHash = _deliver(taskId);
        _respond(reqHash, 100);
        core.settleWithValidation(taskId);

        assertEq(core.treasuryAccrued(), 0);
        assertEq(core.validatorAccrued(validator), 0);
        assertEq(core.previewPayout(taskId, worker), uint256(STAKE) + REWARD);

        vm.prank(worker);
        core.claim(taskId);
        assertEq(usdc.balanceOf(address(core)), 0);
    }

    function test_U13_E2_noWinners_no_viaValidation() public {
        // N = 0, outcome NO via R3: fee taken, remainder to the client as damages
        uint256 taskId = _acceptedTask(); // Y = 15e6, N = 0
        bytes32 reqHash = _deliver(taskId);
        _respond(reqHash, 10);
        core.settleWithValidation(taskId);

        // fee = floor(15e6 * 2%) = 0.3e6; split with validator under R3
        assertEq(core.validatorAccrued(validator), 0.15e6);
        assertEq(core.treasuryAccrued(), 0.15e6);

        // client: reward refund + damages (15e6 - 0.3e6)
        assertEq(core.previewPayout(taskId, client), 100e6 + 14.7e6);
        assertEq(core.previewPayout(taskId, worker), 0);

        vm.prank(client);
        core.claim(taskId);

        vm.prank(validator);
        core.withdrawValidatorFees();
        vm.prank(owner);
        core.withdrawTreasury(owner);
        assertEq(usdc.balanceOf(address(core)), 0);
    }

    function test_U13_E2_noWinners_no_viaTimeout() public {
        // same edge via R1 (no delivery): full fee to treasury
        uint256 taskId = _acceptedTask();
        (,,,,,, uint64 deadline) = _creationMeta(taskId);
        vm.warp(deadline + 1);
        core.settleByTimeout(taskId);

        assertEq(core.validatorAccrued(validator), 0);
        assertEq(core.treasuryAccrued(), 0.3e6);
        assertEq(core.previewPayout(taskId, client), 100e6 + 14.7e6);
        vm.prank(client);
        core.claim(taskId);
        vm.prank(owner);
        core.withdrawTreasury(owner);
        assertEq(usdc.balanceOf(address(core)), 0);
    }

    // ------------------------------------------------------------------
    // U-14 claim idempotence; previewPayout == claim
    // ------------------------------------------------------------------

    function test_U14_doubleClaimReverts_previewMatchesClaim() public {
        uint256 taskId = _exampleTask();
        bytes32 reqHash = _deliver(taskId);
        _respond(reqHash, 100);
        core.settleWithValidation(taskId);

        address[5] memory accounts = [worker, bettorP, bettorQ, bettorS, client];
        for (uint256 i = 0; i < accounts.length; i++) {
            address a = accounts[i];
            uint128 preview = core.previewPayout(taskId, a);
            uint256 before = usdc.balanceOf(a);
            vm.prank(a);
            if (preview == 0) {
                vm.expectRevert(OracleCore.NothingToClaim.selector);
                core.claim(taskId);
            } else {
                core.claim(taskId);
                assertEq(usdc.balanceOf(a) - before, preview, "previewPayout == claim transfer");
                assertEq(core.previewPayout(taskId, a), 0, "preview zero after claim");
                assertTrue(core.claimed(taskId, a));
                vm.prank(a);
                vm.expectRevert(OracleCore.AlreadyClaimed.selector);
                core.claim(taskId);
            }
        }

        // claiming before settlement reverts WrongState
        uint256 openTask = _acceptedTask();
        vm.prank(worker);
        vm.expectRevert(OracleCore.WrongState.selector);
        core.claim(openTask);
    }

    // ------------------------------------------------------------------
    // dust accounting + sweepDust (§6.5)
    // ------------------------------------------------------------------

    function test_dustSweptToTreasury_afterAllClaims() public {
        // craft 1 unit of rounding dust: W = 16e6, L = 10_000_001
        uint256 taskId = _acceptedTask(); // worker YES 15e6
        vm.prank(bettorP);
        core.placeBet(taskId, pId, OracleCore.Side.Yes, 1e6);
        vm.prank(bettorQ);
        core.placeBet(taskId, qId, OracleCore.Side.No, 10_000_001);

        bytes32 reqHash = _deliver(taskId);
        _respond(reqHash, 100);
        core.settleWithValidation(taskId); // YES

        // fee = floor(10_000_001 * 2%) = 200_000 ; Ld = 9_800_001
        assertEq(core.treasuryAccrued(), 100_000);
        assertEq(core.validatorAccrued(validator), 100_000);
        uint128 workerPay = core.previewPayout(taskId, worker); // 15e6 + floor(15e6*Ld/16e6) + 100e6
        uint128 pPay = core.previewPayout(taskId, bettorP);
        assertEq(workerPay, 15e6 + 9_187_500 + 100e6);
        assertEq(pPay, 1e6 + 612_500);

        // premature sweep: claims pending and < 30 days
        vm.expectRevert(OracleCore.TooEarly.selector);
        core.sweepDust(taskId);

        vm.prank(worker);
        core.claim(taskId);
        vm.prank(bettorP);
        core.claim(taskId);

        // all claims done => anyone can sweep exactly the 1-unit dust
        uint128 treasuryBefore = core.treasuryAccrued();
        vm.prank(stranger);
        core.sweepDust(taskId);
        assertEq(core.treasuryAccrued() - treasuryBefore, 1, "exactly the rounding dust");

        vm.expectRevert(OracleCore.AlreadyClaimed.selector);
        core.sweepDust(taskId);

        vm.prank(validator);
        core.withdrawValidatorFees();
        vm.prank(owner);
        core.withdrawTreasury(owner);
        assertEq(usdc.balanceOf(address(core)), 0, "fully drained to the unit");
    }

    function test_sweepDust_after30Days_collectsAbandonedFunds() public {
        uint256 taskId = _exampleTask();
        bytes32 reqHash = _deliver(taskId);
        _respond(reqHash, 100);
        core.settleWithValidation(taskId);

        vm.prank(worker);
        core.claim(taskId); // bettorP abandons 69.3e6

        vm.warp(block.timestamp + 30 days);
        core.sweepDust(taskId);
        assertEq(core.treasuryAccrued(), 0.5e6 + 69.3e6);

        // abandoned claim is now forfeited
        assertEq(core.previewPayout(taskId, bettorP), 0);
        vm.prank(bettorP);
        vm.expectRevert(OracleCore.NothingToClaim.selector);
        core.claim(taskId);

        vm.prank(validator);
        core.withdrawValidatorFees();
        vm.prank(owner);
        core.withdrawTreasury(owner);
        assertEq(usdc.balanceOf(address(core)), 0);
    }

    // ------------------------------------------------------------------
    // U-17 pause gates ONLY inflows (S6)
    // ------------------------------------------------------------------

    function test_U17_pauseGatesOnlyInflows() public {
        // prepared positions before pausing
        uint256 deliveredTask = _exampleTask();
        bytes32 reqHash = _deliver(deliveredTask);
        _respond(reqHash, 100);
        uint256 createdTask = _createTask();
        uint256 openTask = _acceptedTask();

        vm.prank(owner);
        core.pause();

        // inflows blocked
        vm.prank(client);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        core.createTask(workerId, validatorId, REWARD, uint64(block.timestamp + 3000), keccak256("s"), "u");
        vm.prank(worker);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        core.acceptAndStake(createdTask, workerId, STAKE);
        vm.prank(bettorP);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        core.placeBet(openTask, pId, OracleCore.Side.Yes, 1e6);
        (,,, uint64 cutoff) = _acceptMeta(openTask);
        vm.warp(cutoff);
        vm.prank(worker);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        core.submitDelivery(openTask, keccak256("d"), "u");

        // settlement + exits stay callable while paused (users can always exit)
        core.settleWithValidation(deliveredTask);
        vm.prank(worker);
        core.claim(deliveredTask);

        (,,,,,, uint64 deadline) = _creationMeta(openTask);
        vm.warp(deadline + 1);
        core.settleByTimeout(openTask); // R1 while paused

        vm.warp(block.timestamp + ACCEPT_WINDOW + 1);
        core.cancelUnaccepted(createdTask); // R0 while paused
        vm.prank(client);
        core.claim(createdTask);

        vm.prank(validator);
        core.withdrawValidatorFees(); // fee exit while paused

        // unpause restores inflows
        vm.prank(owner);
        core.unpause();
        uint256 newTask = _createTask();
        assertGt(newTask, 0);
    }

    // ------------------------------------------------------------------
    // access control on admin functions
    // ------------------------------------------------------------------

    function test_adminFunctionsOnlyOwner() public {
        vm.expectRevert();
        vm.prank(stranger);
        core.pause();
        vm.expectRevert();
        vm.prank(stranger);
        core.withdrawTreasury(stranger);
    }
}
