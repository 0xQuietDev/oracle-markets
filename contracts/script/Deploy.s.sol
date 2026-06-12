// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {OracleCore} from "../src/OracleCore.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {MockIdentityRegistry} from "../src/mocks/MockIdentityRegistry.sol";
import {MockReputationRegistry} from "../src/mocks/MockReputationRegistry.sol";
import {ValidationRegistry} from "../src/registries/ValidationRegistry.sol";

/// @notice PROFILE env selects the §6.2 parameter column and the target stack:
///   - local | e2e   : windows 15/120/30/15   (fast local iteration / e2e runs)
///   - demo          : windows 180/300/120/60 (stage demo column)
///   - default       : windows 600/3600/600/300
///     all four deploy the FULL local stack on anvil (MockUSDC + mock
///     registries + ValidationRegistry + OracleCore), mint 10_000e6 USDC to
///     anvil accounts 0–9 and write ../deployments/local.json (agents: {}).
///   - fuji          : reads canonical addresses + params from
///     ../deployments/fuji.json, deploys ONLY ValidationRegistry + OracleCore,
///     writes the completed fuji.json back.
contract Deploy is Script {
    // anvil mnemonic "test test ... junk" accounts 0..9 (plan §2.3)
    address[10] internal ANVIL = [
        0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266,
        0x70997970C51812dc3A010C7d01b50e0d17dc79C8,
        0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC,
        0x90F79bf6EB2c4f870365E785982E1f101E93b906,
        0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65,
        0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc,
        0x976EA74026E726554dB657fA54763abd0C3a0aa9,
        0x14dC79964da2C08b23698B3D3cc7Ca32193d9955,
        0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f,
        0xa0Ee7A142d267C1f36714E4a8F75612F20a79720
    ];

    function run() external {
        string memory profile = vm.envOr("PROFILE", string("local"));
        if (_eq(profile, "fuji")) {
            _deployFuji();
        } else {
            _deployLocal(profile);
        }
    }

    // ------------------------------------------------------------------

    function _params(string memory profile) internal pure returns (OracleCore.Params memory p) {
        // §6.2 default column
        p = OracleCore.Params({
            minSelfStakeBps: 1000,
            protocolFeeBps: 200,
            validatorFeeShareBps: 5000,
            bettingWindow: 600,
            acceptWindow: 3600,
            disputeWindow: 600,
            graceWindow: 300,
            validationThreshold: 80,
            minBet: 100_000,
            maxPoolPerSide: 10_000e6,
            minReward: 1_000_000
        });
        if (_eq(profile, "demo")) {
            p.bettingWindow = 180;
            p.acceptWindow = 300;
            p.disputeWindow = 120;
            p.graceWindow = 60;
        } else if (_eq(profile, "e2e") || _eq(profile, "local")) {
            p.bettingWindow = 15;
            p.acceptWindow = 120;
            p.disputeWindow = 30;
            p.graceWindow = 15;
        } else if (!_eq(profile, "default")) {
            revert("Deploy: unknown PROFILE (local|e2e|demo|default|fuji)");
        }
    }

    function _deployLocal(string memory profile) internal {
        OracleCore.Params memory p = _params(profile);

        vm.startBroadcast();
        MockUSDC usdc = new MockUSDC();
        MockIdentityRegistry idReg = new MockIdentityRegistry();
        MockReputationRegistry repReg = new MockReputationRegistry();
        ValidationRegistry valReg = new ValidationRegistry();
        OracleCore core = new OracleCore(
            address(usdc), address(idReg), address(repReg), address(valReg), msg.sender, p
        );
        for (uint256 i = 0; i < ANVIL.length; i++) {
            usdc.mint(ANVIL[i], 10_000e6);
        }
        vm.stopBroadcast();

        string memory json = _deploymentJson(
            block.chainid,
            "http://127.0.0.1:8545",
            block.number,
            address(core),
            address(usdc),
            address(idReg),
            address(repReg),
            address(valReg),
            p
        );
        vm.writeFile("../deployments/local.json", json);
    }

    function _deployFuji() internal {
        string memory existing = vm.readFile("../deployments/fuji.json");
        address usdc = vm.parseJsonAddress(existing, ".contracts.usdc");
        address idReg = vm.parseJsonAddress(existing, ".contracts.identityRegistry");
        address repReg = vm.parseJsonAddress(existing, ".contracts.reputationRegistry");
        string memory rpcUrl = vm.parseJsonString(existing, ".rpcUrl");

        OracleCore.Params memory p = OracleCore.Params({
            minSelfStakeBps: uint16(vm.parseJsonUint(existing, ".params.minSelfStakeBps")),
            protocolFeeBps: uint16(vm.parseJsonUint(existing, ".params.protocolFeeBps")),
            validatorFeeShareBps: uint16(vm.parseJsonUint(existing, ".params.validatorFeeShareBps")),
            bettingWindow: uint32(vm.parseJsonUint(existing, ".params.bettingWindow")),
            acceptWindow: uint32(vm.parseJsonUint(existing, ".params.acceptWindow")),
            disputeWindow: uint32(vm.parseJsonUint(existing, ".params.disputeWindow")),
            graceWindow: uint32(vm.parseJsonUint(existing, ".params.graceWindow")),
            validationThreshold: uint8(vm.parseJsonUint(existing, ".params.validationThreshold")),
            minBet: uint128(vm.parseUint(vm.parseJsonString(existing, ".params.minBet"))),
            maxPoolPerSide: uint128(vm.parseUint(vm.parseJsonString(existing, ".params.maxPoolPerSide"))),
            minReward: uint128(vm.parseUint(vm.parseJsonString(existing, ".params.minReward")))
        });

        vm.startBroadcast();
        ValidationRegistry valReg = new ValidationRegistry();
        OracleCore core = new OracleCore(usdc, idReg, repReg, address(valReg), msg.sender, p);
        vm.stopBroadcast();

        string memory json = _deploymentJson(
            block.chainid, rpcUrl, block.number, address(core), usdc, idReg, repReg, address(valReg), p
        );
        vm.writeFile("../deployments/fuji.json", json);
    }

    // ------------------------------------------------------------------

    /// @dev Serializes the shared/src/config.ts `Deployment` shape (agents: {}
    ///      — scripts/register-agents.ts patches the agent map afterwards).
    function _deploymentJson(
        uint256 chainId,
        string memory rpcUrl,
        uint256 deployBlock,
        address core,
        address usdc,
        address idReg,
        address repReg,
        address valReg,
        OracleCore.Params memory p
    ) internal pure returns (string memory) {
        string memory contracts = string.concat(
            '{\n    "oracleCore": "',
            vm.toString(core),
            '",\n    "usdc": "',
            vm.toString(usdc),
            '",\n    "identityRegistry": "',
            vm.toString(idReg),
            '",\n    "reputationRegistry": "',
            vm.toString(repReg),
            '",\n    "validationRegistry": "',
            vm.toString(valReg),
            '"\n  }'
        );
        string memory params = string.concat(
            '{\n    "minSelfStakeBps": ',
            vm.toString(p.minSelfStakeBps),
            ', "protocolFeeBps": ',
            vm.toString(p.protocolFeeBps),
            ', "validatorFeeShareBps": ',
            vm.toString(p.validatorFeeShareBps),
            ',\n    "bettingWindow": ',
            vm.toString(p.bettingWindow),
            ', "acceptWindow": ',
            vm.toString(p.acceptWindow),
            ', "disputeWindow": ',
            vm.toString(p.disputeWindow),
            ', "graceWindow": ',
            vm.toString(p.graceWindow),
            ',\n    "validationThreshold": ',
            vm.toString(p.validationThreshold),
            ', "minBet": "',
            vm.toString(p.minBet),
            '", "maxPoolPerSide": "',
            vm.toString(p.maxPoolPerSide),
            '", "minReward": "',
            vm.toString(p.minReward),
            '"\n  }'
        );
        return string.concat(
            '{\n  "chainId": ',
            vm.toString(chainId),
            ',\n  "rpcUrl": "',
            rpcUrl,
            '",\n  "deployBlock": ',
            vm.toString(deployBlock),
            ',\n  "contracts": ',
            contracts,
            ',\n  "usdcDomain": { "name": "USD Coin", "version": "2" },\n  "params": ',
            params,
            ',\n  "agents": {}\n}\n'
        );
    }

    function _eq(string memory a, string memory b) internal pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }
}
