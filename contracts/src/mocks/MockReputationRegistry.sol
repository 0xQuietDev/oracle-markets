// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Minimal local stand-in for the ERC-8004 Reputation Registry.
contract MockReputationRegistry {
    struct Feedback {
        address client;
        uint256 agentId;
        int128 value;
        uint8 valueDecimals;
        bytes32 tag1;
        bytes32 tag2;
        string endpointURI;
        string feedbackURI;
        bytes32 feedbackHash;
    }

    Feedback[] public feedbacks;

    event NewFeedback(uint256 indexed agentId, address indexed client, int128 value, bytes32 tag1, bytes32 tag2);

    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        bytes32 tag1,
        bytes32 tag2,
        string calldata endpointURI,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external {
        feedbacks.push(
            Feedback({
                client: msg.sender,
                agentId: agentId,
                value: value,
                valueDecimals: valueDecimals,
                tag1: tag1,
                tag2: tag2,
                endpointURI: endpointURI,
                feedbackURI: feedbackURI,
                feedbackHash: feedbackHash
            })
        );
        emit NewFeedback(agentId, msg.sender, value, tag1, tag2);
    }

    function feedbackCount() external view returns (uint256) {
        return feedbacks.length;
    }

    /// @notice Naive aggregation over stored rows, filtered by clients/tags.
    function getSummary(uint256 agentId, address[] calldata clients, bytes32 tag1, bytes32 tag2)
        external
        view
        returns (uint64 count, int128 sum)
    {
        for (uint256 i = 0; i < feedbacks.length; i++) {
            Feedback storage f = feedbacks[i];
            if (f.agentId != agentId) continue;
            if (tag1 != bytes32(0) && f.tag1 != tag1) continue;
            if (tag2 != bytes32(0) && f.tag2 != tag2) continue;
            if (clients.length > 0) {
                bool found = false;
                for (uint256 j = 0; j < clients.length; j++) {
                    if (clients[j] == f.client) {
                        found = true;
                        break;
                    }
                }
                if (!found) continue;
            }
            count += 1;
            sum += f.value;
        }
    }
}

/// @notice Always-reverting reputation registry used by U-18 to prove that
///         settlement survives a registry revert (funds > feedback).
contract MockRevertingReputation {
    error AlwaysReverts();

    function giveFeedback(uint256, int128, uint8, bytes32, bytes32, string calldata, string calldata, bytes32)
        external
        pure
    {
        revert AlwaysReverts();
    }
}
