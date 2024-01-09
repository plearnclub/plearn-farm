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
        uint256 amount;
        uint32 firstDayLocked;
        uint32 lastDayAction;
        uint256 tierIndex;
    }

    struct InfoFront {
        Tier tier;
        UserInfo userInfo;
        uint32 endLockTime;
    }

    function deposit(uint256 _tierIndex, uint256 _amount) external;

    function withdraw(uint256 _amount) external;

    function harvest() external;

    function extendLockPeriod() external;

    function poolLength() external view returns (uint256 length);

    function getUserInfo(
        address _user
    ) external view returns (InfoFront memory info);

    // onlyOwner

    function addTier(Tier calldata _tier) external;

    function setTier(uint256 _tierIndex, Tier calldata _tier) external;

    function setEarnTreasury(address _newEarnTreasury) external;

    function stopReward() external;
}
