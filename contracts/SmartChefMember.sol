// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import "./token/BEP20/IBEP20.sol";
import "./token/BEP20/SafeBEP20.sol";
import "./SmartChefFoundingInvestorTreasury.sol";

contract SmartChefMember is Ownable, ReentrancyGuard {
    using SafeMath for uint256;
    using SafeBEP20 for IBEP20;
    using EnumerableSet for EnumerableSet.AddressSet;

    EnumerableSet.AddressSet private _investors;

    // Whether a limit is set for users
    bool public hasUserLimit;

    // The pool limit (0 if none)
    uint256 public poolLimitPerUser;

    // The precision factor
    uint256 public PRECISION_FACTOR;

    // The reward token
    IBEP20 public rewardToken;

    // The staked token
    IBEP20 public stakedToken;

    SmartChefFoundingInvestorTreasury public treasury;

    // Whenever the user withdraws the staked tokens. User rewards will be lowered and reclaimableRewardAmount updated.
    uint256 public reclaimableRewardAmount;

    // Info of each user that stakes tokens.
    mapping(address => UserInfo) public userInfo;

    struct PackageInfo {
        uint256 blockPeriod; // The amount of block from start to end.
    }

    struct DepositInfo {
        uint256 initialAmount; // How many staked tokens the user has provided (just deposit)
        uint256 amount; // How many staked tokens the user has provided
        uint256 startUnlockBlock; // The block number when PLEARN unlocking starts.
        uint256 endUnlockBlock; // The block number when PLEARN unlocking ends.
    }

    struct BalanceInfo {
        DepositInfo staked;
        DepositInfo reward;
        PackageInfo packageInfo;
    }

     struct UserInfo {
        uint256 numDeposit;
        mapping (uint256 => BalanceInfo) balanceInfo;
    }

    // Info of each package.
    PackageInfo[] public packageInfo;

    event AdminTokenRecovery(address tokenRecovered, uint256 amount);
    event AdminTokenRecoveryWrongAddress(address indexed user, uint256 amount);
    event Harvest(address indexed user);
    event DepositToInvestor(address indexed user, uint256 amount);
    event NewPoolLimit(uint256 poolLimitPerUser);
    event RewardsStop(uint256 blockNumber);
    event Withdraw(address indexed user, uint256 amount);

    /*
     * @param _stakedToken: staked token address
     * @param _rewardToken: reward token address
     * @param _treasury: treasury address
     * @param _poolLimitPerUser: pool limit per user in stakedToken (if any, else 0)
     */
    constructor(
        IBEP20 _stakedToken,
        IBEP20 _rewardToken,
        SmartChefFoundingInvestorTreasury _treasury,
        uint256 _poolLimitPerUser
    ) {
        stakedToken = _stakedToken;
        rewardToken = _rewardToken;
        treasury = _treasury;

        if (_poolLimitPerUser > 0) {
            hasUserLimit = true;
            poolLimitPerUser = _poolLimitPerUser;
        }

        uint256 decimalsRewardToken = uint256(rewardToken.decimals());
        require(decimalsRewardToken < 30, "Must be inferior to 30");

        PRECISION_FACTOR = uint256(10**(uint256(30).sub(decimalsRewardToken)));
    }

    function packageLength() external view returns (uint256) {
        return packageInfo.length;
    }

    function getDepositInfo(address _address, uint256 _depositId) external view returns (BalanceInfo memory) {
        UserInfo storage user = userInfo[_address];
        return user.balanceInfo[_depositId];
    }

    // Add a new package to the pool. Can only be called by the owner.
    function add(
        uint256 _blockPeriod
    ) public onlyOwner {
        packageInfo.push(
            PackageInfo({
                blockPeriod: _blockPeriod
            })
        );
    }

    // /*
    //  * @notice Collect reward tokens (if any)
    //  * @param _depositId: deposit id
    //  */
    function harvest(uint256 _depositId) external nonReentrant {
        UserInfo storage user = userInfo[msg.sender];
        BalanceInfo storage balanceInfo = user.balanceInfo[_depositId];
        DepositInfo storage reward = balanceInfo.reward;

        if (reward.amount > 0) {
            uint256 pending = _pendingUnlockedToken(reward);
            if (pending > 0) {
                safeRewardTransfer(address(msg.sender), pending);
            }
        }

        emit Harvest(msg.sender);
    }

    /*
     * @notice Deposit staked tokens (if any)
     * @param _amount: amount to deposit (in stakedTokens)
     * @param _rewardAmount: reward amount to deposit (in reward)
     * @param _packageId: package to deposit
     * @param _address: user address
     */
    function depositToInvestor(uint256 _amount, uint256 _rewardAmount, uint256 _packageId, address _address) public onlyOwner {
        PackageInfo memory package = packageInfo[_packageId];
        UserInfo storage user = userInfo[_address];
        BalanceInfo storage balanceInfo = user.balanceInfo[user.numDeposit++];
        
        if (hasUserLimit) {
            require(_amount <= poolLimitPerUser, "User amount above limit");
        }

        if (_amount > 0 && _rewardAmount > 0) {
            balanceInfo.staked = DepositInfo({initialAmount: _amount, 
            amount: _amount,
            startUnlockBlock: block.number,
            endUnlockBlock: block.number.add(package.blockPeriod)});

            balanceInfo.reward = DepositInfo({initialAmount: _rewardAmount, 
            amount: _rewardAmount,
            startUnlockBlock: block.number,
            endUnlockBlock: block.number.add(package.blockPeriod)});

            balanceInfo.packageInfo = package;

            stakedToken.safeTransferFrom(address(msg.sender), address(this), _amount);
            stakedToken.safeTransferFrom(address(msg.sender), address(treasury), _rewardAmount);
            EnumerableSet.add(_investors, _address);
        }

        emit DepositToInvestor(_address, _amount);
    }

    /*
     * @notice Withdraw staked tokens and collect reward tokens
     * @param _amount: amount to withdraw (in rewardToken)
     * @param _depositId: deposit id
     */
    function withdraw(uint256 _amount, uint256 _depositId) external nonReentrant {
        UserInfo storage user = userInfo[msg.sender];
        BalanceInfo storage balanceInfo = user.balanceInfo[_depositId];
        DepositInfo storage staked = balanceInfo.staked;
        DepositInfo storage reward = balanceInfo.reward;
        uint256 witdrawPercent =  _amount.mul(PRECISION_FACTOR).div(staked.amount);

        require(staked.amount >= _amount, "Amount to withdraw too high");
        uint256 pending = _pendingUnlockedToken(reward);

        if (_amount > 0) {
            uint256 pendingUnlocked = _pendingUnlockedToken(staked);
            require(pendingUnlocked  >= _amount, "Amount to withdraw too high");
            staked.amount = staked.amount.sub(_amount);
            stakedToken.safeTransfer(address(msg.sender), _amount);
        }

        if (pending > 0) {
            reward.amount = reward.amount.sub(pending);
            safeRewardTransfer(address(msg.sender), pending);
        }
        
        reward.initialAmount = reward.initialAmount.sub(witdrawPercent.mul(reward.initialAmount).div(PRECISION_FACTOR));
        reclaimableRewardAmount = reclaimableRewardAmount.add(witdrawPercent.mul(reward.amount).div(PRECISION_FACTOR));
        reward.amount = reward.amount.sub(witdrawPercent.mul(reward.amount).div(PRECISION_FACTOR));
        
        emit Withdraw(msg.sender, _amount);
    }

    /*
     * @notice Withdraw staked tokens without caring about rewards rewards
     * @param _from: user address
     * @param _depositId: deposit id
     * @dev Only callable by owner. Needs to be for emergency.
     */
    function recoverTokenWrongAddress(address _from, uint256 _depositId) external onlyOwner nonReentrant {
        UserInfo storage user = userInfo[_from];
        BalanceInfo storage balanceInfo = user.balanceInfo[_depositId];
        DepositInfo storage staked = balanceInfo.staked;
        DepositInfo storage reward = balanceInfo.reward;
        PackageInfo storage package = balanceInfo.packageInfo;

        package.blockPeriod = 0;

        uint256 stakedAmountToTransfer = staked.amount;
        staked.initialAmount = 0;
        staked.amount = 0;
        staked.startUnlockBlock = 0;
        staked.endUnlockBlock = 0;

        if (stakedAmountToTransfer > 0) {
            stakedToken.safeTransfer(address(msg.sender), stakedAmountToTransfer);
            EnumerableSet.remove(_investors, _from);
        }

        uint256 rewardAmount = reward.amount;
        reclaimableRewardAmount = reclaimableRewardAmount.add(rewardAmount);
        reward.initialAmount = 0;
        reward.amount = 0;
        reward.startUnlockBlock = 0;
        reward.endUnlockBlock = 0;

        emit AdminTokenRecoveryWrongAddress(_from, stakedAmountToTransfer);
    }

    /**
     * @notice It allows the admin to recover wrong tokens sent to the contract
     * @param _tokenAddress: the address of the token to withdraw
     * @param _tokenAmount: the number of tokens to withdraw
     * @dev This function is only callable by admin.
     */
    function recoverWrongTokens(address _tokenAddress, uint256 _tokenAmount) external onlyOwner {
        require(_tokenAddress != address(stakedToken), "Cannot be staked token");
        require(_tokenAddress != address(rewardToken), "Cannot be reward token");

        IBEP20(_tokenAddress).safeTransfer(address(msg.sender), _tokenAmount);

        emit AdminTokenRecovery(_tokenAddress, _tokenAmount);
    }

    /**
     * @notice It allows the admin to recover reward.
     * @dev This function is only callable by admin.
     */
    function withdrawReclaimableRewardAmount() external onlyOwner {
        uint256 amount = reclaimableRewardAmount;
        if (reclaimableRewardAmount > 0) {
            reclaimableRewardAmount = reclaimableRewardAmount.sub(amount);
            safeRewardTransfer(address(msg.sender), amount);
        }
    }

    /*
     * @notice Deposit staked tokens (if any)
     * @param _amount: amount to deposit (in stakedTokens)
     * @param _rewardAmount: reward amount to deposit (in reward)
     * @param _packageId: package to deposit
     * @param _address: user address
     * @param _depositId: deposit id
     */
    function depositToInvestorAfterRecoverWrongToken(uint256 _amount, uint256 _rewardAmount, uint256 _packageId, address _address, uint256 _depositId) public onlyOwner {
        PackageInfo memory package = packageInfo[_packageId];
        UserInfo storage user = userInfo[_address];
        BalanceInfo storage balanceInfo = user.balanceInfo[_depositId];
        
        require(_depositId < user.numDeposit, "deposit PLEARN by depositToInvestor");
        require(balanceInfo.staked.amount == 0, "Cannot deposit");
        require(balanceInfo.reward.amount == 0, "Cannot deposit");

        if (hasUserLimit) {
            require(_amount <= poolLimitPerUser, "User amount above limit");
        }

        if (_amount > 0 && _rewardAmount > 0) {
            balanceInfo.staked = DepositInfo({initialAmount: _amount, 
            amount: _amount,
            startUnlockBlock: block.number,
            endUnlockBlock: block.number.add(package.blockPeriod)});

            balanceInfo.reward = DepositInfo({initialAmount: _rewardAmount, 
            amount: _rewardAmount,
            startUnlockBlock: block.number,
            endUnlockBlock: block.number.add(package.blockPeriod)});

            balanceInfo.packageInfo = package;

            stakedToken.safeTransferFrom(address(msg.sender), address(this), _amount);
            stakedToken.safeTransferFrom(address(msg.sender), address(treasury), _rewardAmount);
            EnumerableSet.add(_investors, _address);
        }

        emit DepositToInvestor(_address, _amount);
    }

    /*
     * @notice Update pool limit per user
     * @dev Only callable by owner.
     * @param _hasUserLimit: whether the limit remains forced
     * @param _poolLimitPerUser: new pool limit per user
     */
    function updatePoolLimitPerUser(bool _hasUserLimit, uint256 _poolLimitPerUser) external onlyOwner {
        require(hasUserLimit, "Must be set");
        if (_hasUserLimit) {
            require(_poolLimitPerUser > poolLimitPerUser, "New limit must be higher");
            poolLimitPerUser = _poolLimitPerUser;
        } else {
            hasUserLimit = _hasUserLimit;
            poolLimitPerUser = 0;
        }
        emit NewPoolLimit(poolLimitPerUser);
    }

    /*
     * @notice View function to see pending reward on frontend.
     * @param _user: user address
     * @param _depositId: deposit id
     * @return Pending reward for a given user
     */
    function pendingReward(address _user, uint256 _depositId) external view returns (uint256) {
        UserInfo storage user = userInfo[_user];
        BalanceInfo memory balanceInfo = user.balanceInfo[_depositId];

        return _pendingUnlockedToken(balanceInfo.reward);
    }

    /*
     * @notice View function to see pending reward on frontend.
     * @param _user: user address
     * @param _depositId: deposit id
     * @return Pending unlocked token for a given user
     */
    function pendingStakedUnlockedToken(address _user, uint256 _depositId) external view returns (uint256) {
        UserInfo storage user = userInfo[_user];
        BalanceInfo memory balanceInfo = user.balanceInfo[_depositId];

        return _pendingUnlockedToken(balanceInfo.staked);
    }

    // Return Pending unlocked token
    function _pendingUnlockedToken(DepositInfo memory depositInfo) private view returns (uint256) {
        if (block.number > depositInfo.startUnlockBlock && depositInfo.amount > 0) {
            uint256 multiplier = _getUnlockedTokenMultiplier(depositInfo.startUnlockBlock, block.number, depositInfo.endUnlockBlock);
            uint256 unlockedPerBlock = depositInfo.initialAmount.div(depositInfo.endUnlockBlock.sub(depositInfo.startUnlockBlock));
            uint256 unlockedToken = multiplier.mul(unlockedPerBlock);
            return unlockedToken.sub(depositInfo.initialAmount.sub(depositInfo.amount));
        } else {
            return 0;
        }
    }

    /*
     * @notice Return unlocked token multiplier over the given _from to _to block.
     * @param _from: block to unlock start
     * @param _to: block to unlock finish
     */
    function _getUnlockedTokenMultiplier(uint256 _from, uint256 _to, uint256 endUnlockBlock) private pure returns (uint256) {
        if (_to <= endUnlockBlock) {
            return _to.sub(_from);
        } else if (_from >= endUnlockBlock) {
            return 0;
        } else {
            return endUnlockBlock.sub(_from);
        }
    }

    /*
     * @notice Reward transfer function.
     * @param _to: user address
     * @param _amount: amount to withdraw (in rewardToken)
     */
    function safeRewardTransfer(address _to, uint256 _amount) internal {
        treasury.safeRewardTransfer(_to, _amount);
    }

    function getInvestorLength() public view returns (uint256) {
        return EnumerableSet.length(_investors);
    }

    function isInvestor(address account) public view returns (bool) {
        return EnumerableSet.contains(_investors, account);
    }

    function getInvestor(uint256 _index) public view onlyOwner returns (address){
        require(_index <= getInvestorLength() - 1, "SmartChefMember: index out of bounds");
        return EnumerableSet.at(_investors, _index);
    }
}