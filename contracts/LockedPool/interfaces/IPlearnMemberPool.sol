// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.0;

interface IPlearnMemberPool {
    struct Tier {
        uint32 lockDayPercent;
        uint32 unlockDayPercent;
        uint32 lockPeriod;
        uint128 maxAmount;
        uint128 minAmount;
        uint128 totalDeposited;
    }

    struct UserInfo {
        uint128 userDeposit;
        uint128 accrueInterest;
        uint256 depositTime;
    }

    struct InfoFront {
        Tier tier;
        UserInfo userInfo;
        uint32 endLockTime;
    }

    function deposit(uint256 _amount) external;

    function withdraw(uint256 _amount) external;

    function harvest() external;

    function poolLength() external view returns (uint256 length);

    function getUserInfo(
        uint256 _poolIndex,
        address _user
    ) external view returns (InfoFront memory info);

    function upgradeMembership(uint256 _poolIndex) external;

    // onlyOwner

    function addTier(Tier calldata _pool) external;

    function changeTier(uint256 _poolIndex, Tier calldata _pool) external;

    function setEarnTreasury(address _newEarnTreasury) external;

    function stopReward() external;
}
