// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

/// EIP-3009 surface used by the x402 facilitator (DR-7): domain "USD Coin"/"2",
/// 6 decimals, transferWithAuthorization (v,r,s + bytes), authorizationState.
contract MockUSDCTest is Test {
    MockUSDC usdc;
    uint256 internal payerKey = 0xA11CE;
    address internal payer;
    address internal payee = address(0xBEEF);

    function setUp() public {
        vm.warp(1_750_000_000);
        usdc = new MockUSDC();
        payer = vm.addr(payerKey);
        usdc.mint(payer, 100e6);
    }

    function _digest(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce)
        internal
        view
        returns (bytes32)
    {
        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("USD Coin")),
                keccak256(bytes("2")),
                block.chainid,
                address(usdc)
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(usdc.TRANSFER_WITH_AUTHORIZATION_TYPEHASH(), from, to, value, validAfter, validBefore, nonce)
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    function test_metadata() public view {
        assertEq(usdc.name(), "USD Coin");
        assertEq(usdc.symbol(), "USDC");
        assertEq(usdc.decimals(), 6);
        assertEq(usdc.version(), "2");
    }

    function test_transferWithAuthorization_happyPath_vrs() public {
        bytes32 nonce = bytes32(uint256(1));
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(payerKey, _digest(payer, payee, 5e6, 0, block.timestamp + 600, nonce));

        assertFalse(usdc.authorizationState(payer, nonce));
        vm.prank(address(0xFAC1)); // anyone may relay (facilitator)
        usdc.transferWithAuthorization(payer, payee, 5e6, 0, block.timestamp + 600, nonce, v, r, s);
        assertEq(usdc.balanceOf(payee), 5e6);
        assertTrue(usdc.authorizationState(payer, nonce));
    }

    function test_transferWithAuthorization_bytesOverload() public {
        bytes32 nonce = bytes32(uint256(2));
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(payerKey, _digest(payer, payee, 3e6, 0, block.timestamp + 600, nonce));
        usdc.transferWithAuthorization(payer, payee, 3e6, 0, block.timestamp + 600, nonce, abi.encodePacked(r, s, v));
        assertEq(usdc.balanceOf(payee), 3e6);
    }

    function test_transferWithAuthorization_rejectsReuseWindowAndBadSig() public {
        bytes32 nonce = bytes32(uint256(3));
        uint256 validBefore = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(payerKey, _digest(payer, payee, 1e6, 0, validBefore, nonce));
        usdc.transferWithAuthorization(payer, payee, 1e6, 0, validBefore, nonce, v, r, s);

        // nonce reuse
        vm.expectRevert(MockUSDC.AuthorizationReused.selector);
        usdc.transferWithAuthorization(payer, payee, 1e6, 0, validBefore, nonce, v, r, s);

        // not yet valid
        bytes32 nonce2 = bytes32(uint256(4));
        (v, r, s) = vm.sign(payerKey, _digest(payer, payee, 1e6, block.timestamp + 100, validBefore, nonce2));
        vm.expectRevert(MockUSDC.AuthorizationNotYetValid.selector);
        usdc.transferWithAuthorization(payer, payee, 1e6, block.timestamp + 100, validBefore, nonce2, v, r, s);

        // expired
        bytes32 nonce3 = bytes32(uint256(5));
        (v, r, s) = vm.sign(payerKey, _digest(payer, payee, 1e6, 0, block.timestamp, nonce3));
        vm.expectRevert(MockUSDC.AuthorizationExpired.selector);
        usdc.transferWithAuthorization(payer, payee, 1e6, 0, block.timestamp, nonce3, v, r, s);

        // signature by someone other than `from`
        bytes32 nonce4 = bytes32(uint256(6));
        (v, r, s) = vm.sign(0xB0B, _digest(payer, payee, 1e6, 0, validBefore, nonce4));
        vm.expectRevert(MockUSDC.InvalidSignature.selector);
        usdc.transferWithAuthorization(payer, payee, 1e6, 0, validBefore, nonce4, v, r, s);
    }
}
