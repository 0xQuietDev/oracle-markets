// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @notice Minimal local stand-in for the ERC-8004 Identity Registry.
///         ERC-721 based; agentIds auto-increment from 1.
contract MockIdentityRegistry is ERC721 {
    uint256 private _nextAgentId = 1;
    mapping(uint256 => string) private _agentURIs;
    mapping(uint256 => address) private _agentWallets;

    event Registered(uint256 indexed agentId, address indexed owner, string agentURI);
    event AgentWalletSet(uint256 indexed agentId, address wallet);

    error NotAgentOwner();

    constructor() ERC721("ERC-8004 Agents (local)", "AGENT") {}

    function register(string calldata agentURI) external returns (uint256 agentId) {
        agentId = _nextAgentId++;
        _mint(msg.sender, agentId);
        _agentURIs[agentId] = agentURI;
        emit Registered(agentId, msg.sender, agentURI);
    }

    function tokenURI(uint256 agentId) public view override returns (string memory) {
        _requireOwned(agentId);
        return _agentURIs[agentId];
    }

    /// @notice Defaults to ownerOf unless explicitly set by the token owner.
    function getAgentWallet(uint256 agentId) external view returns (address) {
        address wallet = _agentWallets[agentId];
        return wallet == address(0) ? ownerOf(agentId) : wallet;
    }

    function setAgentWallet(uint256 agentId, address wallet) external {
        if (ownerOf(agentId) != msg.sender) revert NotAgentOwner();
        _agentWallets[agentId] = wallet;
        emit AgentWalletSet(agentId, wallet);
    }

    function agentExists(uint256 agentId) external view returns (bool) {
        return _ownerOf(agentId) != address(0);
    }
}
