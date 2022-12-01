// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.0;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import "../token/BEP20/IBEP20.sol";
import "../token/BEP20/SafeBEP20.sol";

contract PendingWithdrawal is ReentrancyGuard, Ownable {

    using SafeMath for uint256;
    using SafeBEP20 for IBEP20;

    /* ========== STATE VARIABLES ========== */

    struct Balances {
        uint256 total;
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
        return (balances[user].total, unlockable, locked, lockData);
    }


    /* ========== MUTATIVE FUNCTIONS ========== */

    // Locked tokens cannot be withdrawn for lockDuration
    function lock(uint256 _amount, address _address) external nonReentrant {
        require(_amount > 0, "Cannot stake 0");
        Balances storage bal = balances[_address];
        bal.total = bal.total.add(_amount);
        uint256 unlockTime = block.timestamp.add(lockDuration);
        uint256 idx = userLocks[_address].length;
        if (idx == 0 || userLocks[_address][idx-1].unlockTime < unlockTime) {
            userLocks[_address].push(LockedBalance({amount: _amount, unlockTime: unlockTime}));
        } else {
            userLocks[_address][idx-1].amount = userLocks[_address][idx-1].amount.add(_amount);
        }
        lockedToken.safeTransferFrom(msg.sender, address(this), _amount);
        emit Locked(msg.sender, _amount);
    }

    // Withdraw all currently locked tokens where the unlock time has passed
    function withdrawExpiredLocks() external {
        LockedBalance[] storage locks = userLocks[msg.sender];
        Balances storage bal = balances[msg.sender];
        uint256 amount;
        uint256 length = locks.length;
        if (locks[length-1].unlockTime <= block.timestamp) {
            amount = bal.total;
            delete userLocks[msg.sender];
        } else {
            for (uint i = 0; i < length; i++) {
                if (locks[i].unlockTime > block.timestamp) break;
                amount = amount.add(locks[i].amount);
                delete locks[i];
            }
        }
        bal.total = bal.total.sub(amount);
        lockedToken.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    /* ========== RESTRICTED FUNCTIONS ========== */

    function recoverWrongTokens(address _tokenAddress, uint256 _tokenAmount) external onlyOwner {
        require(_tokenAddress != address(lockedToken), "Cannot withdraw staking token");
        IBEP20(_tokenAddress).safeTransfer(owner(), _tokenAmount);
        emit Recovered(_tokenAddress, _tokenAmount);
    }

    function updateLockDuration(uint256 _lockDuration) external onlyOwner {
        lockDuration = _lockDuration;
        emit NewLockDuration(_lockDuration);
    }


    /* ========== EVENTS ========== */

    event Locked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event Recovered(address token, uint256 amount);
    event NewLockDuration(uint256 lockDuration);
}
