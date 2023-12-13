// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "../token/BEP20/IBEP20.sol";

contract PlearnLockedPool is Ownable, ReentrancyGuard {

    IBEP20 public tokenAddress; // Address of the token being locked
    uint256[] public tiers;
    uint256[] public tierUserLimits;
    bool public isWithdrawUnlocked;

    mapping(address => UserInfo) public userInfo;

    struct UserInfo {
        uint256 amount; // How many staked tokens the user has provided
        uint256 rewardDebt; // Reward debt
    }

    constructor(IBEP20 _tokenAddress) {
        tokenAddress = _tokenAddress;
    }

    // deposit
    function deposit(uint256 _amount) external nonReentrant {
        require(_amount > 0, "Deposit amount must be greater than 0");
        require(!isWithdrawUnlocked, "Withdraw is already unlocked, cannot deposit");

        // Update user information
        userInfo[msg.sender].amount += _amount;

        // Transfer tokens to the contract
        tokenAddress.transferFrom(msg.sender, address(this), _amount);
    }

    // withdraw
    function withdraw(uint256 _amount) external nonReentrant {
        require(_amount > 0, "Withdraw amount must be greater than 0");
        require(isWithdrawUnlocked, "Withdraw is not yet unlocked");

        // Update user information
        userInfo[msg.sender].amount -= _amount;

        // Transfer tokens back to the user
        tokenAddress.transfer(msg.sender, _amount);
    }

    // set withdraw lock
    function setWithdrawUnlocked(bool value) external nonReentrant onlyOwner {
        isWithdrawUnlocked = value;
    }

    // owner functions
    function setTiers(uint256[] calldata _tiers, uint256[] calldata _tierUserLimits) external onlyOwner {
        require(_tiers.length == _tierUserLimits.length, "Length of tiers and user limits must be equal");
        // Check if tiers are in order from min to max
        for (uint256 i = 1; i < _tiers.length; i++) {
            require(_tiers[i] > _tiers[i - 1], "Tiers must be in ascending order");
        }

        tiers = _tiers;
        tierUserLimits = _tierUserLimits;
    }
}
