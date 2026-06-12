// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Minimal ERC-8004-style Validation Registry, deployed on BOTH local
///         anvil and Fuji (no canonical Fuji deployment exists; DESIGN §7.1).
///         Request/response semantics per plan Task A1; interface fragments of
///         DESIGN §7.2 are normative.
contract ValidationRegistry {
    struct Status {
        address validator;
        uint256 agentId;
        uint8 response;
        uint256 respondedAt;
    }

    mapping(bytes32 => Status) private _statuses;
    mapping(bytes32 => string) public requestURIs;
    mapping(bytes32 => string) public responseURIs;

    event ValidationRequested(
        address indexed validator, uint256 indexed agentId, string requestURI, bytes32 indexed requestHash
    );
    event ValidationResponded(
        bytes32 indexed requestHash, uint8 response, string responseURI, bytes32 reportHash, string tag
    );

    error RequestAlreadyExists();
    error RequestNotFound();
    error NotAssignedValidator();
    error AlreadyResponded();
    error ResponseOutOfRange();
    error ZeroValidator();

    function validationRequest(
        address validatorAddress,
        uint256 agentId,
        string calldata requestURI,
        bytes32 requestHash
    ) external {
        if (validatorAddress == address(0)) revert ZeroValidator();
        if (_statuses[requestHash].validator != address(0)) revert RequestAlreadyExists();
        _statuses[requestHash] = Status({validator: validatorAddress, agentId: agentId, response: 0, respondedAt: 0});
        requestURIs[requestHash] = requestURI;
        emit ValidationRequested(validatorAddress, agentId, requestURI, requestHash);
    }

    function validationResponse(
        bytes32 requestHash,
        uint8 response,
        string calldata responseURI,
        bytes32 reportHash,
        string calldata tag
    ) external {
        Status storage s = _statuses[requestHash];
        if (s.validator == address(0)) revert RequestNotFound();
        if (msg.sender != s.validator) revert NotAssignedValidator();
        if (s.respondedAt != 0) revert AlreadyResponded();
        if (response > 100) revert ResponseOutOfRange();
        s.response = response;
        s.respondedAt = block.timestamp;
        responseURIs[requestHash] = responseURI;
        emit ValidationResponded(requestHash, response, responseURI, reportHash, tag);
    }

    function getValidationStatus(bytes32 requestHash)
        external
        view
        returns (address validator, uint256 agentId, uint8 response, uint256 respondedAt)
    {
        Status storage s = _statuses[requestHash];
        return (s.validator, s.agentId, s.response, s.respondedAt);
    }
}
