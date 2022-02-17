// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.0;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import "../token/BEP20/IBEP20.sol";
import "../token/BEP20/SafeBEP20.sol";

// Based on SNX MultiRewards by iamdefinitelyahuman - https://github.com/iamdefinitelyahuman/multi-rewards
contract PendingWithdrawal is ReentrancyGuard, Ownable {

    using SafeMath for uint256;
    using SafeBEP20 for IBEP20;

    /* ========== STATE VARIABLES ========== */

    struct Balances {
        uint256 total;
        uint256 unlocked;
        uint256 locked;
    }
    struct LockedBalance {
        uint256 amount;
        uint256 unlockTime;
    }

    IBEP20 public lockedToken;

    // Duration of lock period
    uint256 public lockDuration;

    // Private mappings for balance data
    mapping(address => Balances) private balances;
    mapping(address => LockedBalance[]) private userLocks;

    /* ========== CONSTRUCTOR ========== */

    constructor(
        IBEP20 _lockedToken,
        uint256 _lockDuration
    ) Ownable() {
        lockedToken = _lockedToken;
        lockDuration = _lockDuration;
    }


    /* ========== VIEWS ========== */

    // Total balance of an account, including unlocked, locked
    function totalBalance(address user) view external returns (uint256 amount) {
        return balances[user].total;
    }

    // Information on a user's locked balances
    function lockedBalances(
        address user
    ) view external returns (
        uint256 total,
        uint256 unlockable,
        uint256 locked,
        LockedBalance[] memory lockData
    ) {
        LockedBalance[] storage locks = userLocks[user];
        uint256 idx;
        for (uint i = 0; i < locks.length; i++) {
            if (locks[i].unlockTime > block.timestamp) {
                if (idx == 0) {
                    lockData = new LockedBalance[](locks.length - i);
                }
                lockData[idx] = locks[i];
                idx++;
                locked = locked.add(locks[i].amount);
            } else {
                unlockable = unlockable.add(locks[i].amount);
            }
        }
        return (balances[user].locked, unlockable, locked, lockData);
    }


    /* ========== MUTATIVE FUNCTIONS ========== */

    // Locked tokens cannot be withdrawn for lockDuration
    function lock(uint256 _amount, address _address) external nonReentrant {
        require(_amount > 0, "Cannot stake 0");
        Balances storage bal = balances[_address];
        bal.total = bal.total.add(_amount);
        bal.locked = bal.locked.add(_amount);
        uint256 unlockTime = block.timestamp.add(lockDuration);
        uint256 idx = userLocks[_address].length;
        if (idx == 0 || userLocks[_address][idx-1].unlockTime < unlockTime) {
            userLocks[_address].push(LockedBalance({amount: _amount, unlockTime: unlockTime}));
        } else {
            userLocks[_address][idx-1].amount = userLocks[_address][idx-1].amount.add(_amount);
        }
        lockedToken.safeTransferFrom(msg.sender, address(this), _amount);
        emit Staked(msg.sender, _amount);
    }

    // Withdraw all currently locked tokens where the unlock time has passed
    function withdrawExpiredLocks() external {
        LockedBalance[] storage locks = userLocks[msg.sender];
        Balances storage bal = balances[msg.sender];
        uint256 amount;
        uint256 length = locks.length;
        if (locks[length-1].unlockTime <= block.timestamp) {
            amount = bal.locked;
            delete userLocks[msg.sender];
        } else {
            for (uint i = 0; i < length; i++) {
                if (locks[i].unlockTime > block.timestamp) break;
                amount = amount.add(locks[i].amount);
                delete locks[i];
            }
        }
        bal.locked = bal.locked.sub(amount);
        bal.total = bal.total.sub(amount);
        lockedToken.safeTransfer(msg.sender, amount);
    }

    /* ========== RESTRICTED FUNCTIONS ========== */

    // Added to support recovering LP Rewards from other systems such as BAL to be distributed to holders
    function recoverERC20(address tokenAddress, uint256 tokenAmount) external onlyOwner {
        require(tokenAddress != address(lockedToken), "Cannot withdraw staking token");
        IBEP20(tokenAddress).safeTransfer(owner(), tokenAmount);
        emit Recovered(tokenAddress, tokenAmount);
    }


    /* ========== EVENTS ========== */

    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, address indexed rewardsToken, uint256 reward);
    event RewardsDurationUpdated(address token, uint256 newDuration);
    event Recovered(address token, uint256 amount);
}
