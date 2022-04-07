// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import '@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol';

contract PlearnRankingManager is OwnableUpgradeable {
    event AddOrUpdateRank(string indexed id, string name, uint256 minAmount);
    event DeleteRank(string id);
    event PoolCreated(address indexed poolAddress, string poolNmae, address lpToken);
    event SetActivePool(string poolId, bool isActive);

    /**
     * @notice Constructor
     */
    function initialize() public initializer {
        __Ownable_init();
    }

    function addRank(
        string memory id,
        string memory name,
        uint256 minAmount
    ) public onlyOwner {
        emit AddOrUpdateRank(id, name, minAmount);
    }

    function updateRank(
        string memory id,
        string memory name,
        uint256 minAmount
    ) public onlyOwner {
        emit AddOrUpdateRank(id, name, minAmount);
    }

    function deleteRank(string memory id) public onlyOwner {
        emit DeleteRank(id);
    }

    function createPool(
        address poolAddress,
        string calldata poolName,
        address lpToken
    ) public onlyOwner {
        emit PoolCreated(poolAddress, poolName, lpToken);
    }

    function setActivePool(string calldata poolId, bool isActive) public onlyOwner {
        emit SetActivePool(poolId, isActive);
    }
}
