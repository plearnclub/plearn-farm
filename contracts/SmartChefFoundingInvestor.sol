// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import "./token/BEP20/IBEP20.sol";
import "./token/BEP20/SafeBEP20.sol";
import "./SmartChefFoundingInvestorTreasury.sol";

contract SmartChefFoundingInvestor is Ownable, ReentrancyGuard {
    using SafeMath for uint256;
    using SafeBEP20 for IBEP20;
    using EnumerableSet for EnumerableSet.AddressSet;

    EnumerableSet.AddressSet private _investors;

    // Accrued token per share
    uint256 public accTokenPerShare;

    // The block number when PLEARN mining ends.
    uint256 public bonusEndBlock;

    // The block number when PLEARN mining starts.
    uint256 public startBlock;

    // The block number of the last pool update
    uint256 public lastRewardBlock;

    // PLEARN tokens created per block.
    uint256 public rewardPerBlock;

    // The precision factor
    uint256 public PRECISION_FACTOR;

    // The reward token
    IBEP20 public rewardToken;

    // The staked token
    IBEP20 public stakedToken;

    SmartChefFoundingInvestorTreasury public treasury;

    // Info of each user that stakes tokens (stakedToken)
    mapping(address => UserInfo) public userInfo;

    struct UserInfo {
        uint256 initialAmount; // How many staked tokens the user has provided (just deposit)
        uint256 amount; // How many staked tokens the user has provided
        uint256 rewardDebt; // Reward debt
        uint256 releasePerBlock; // unlocked token per block
    }

    event AdminTokenRecovery(address tokenRecovered, uint256 amount);
    event Deposit(address indexed user, uint256 amount);
    event DepositToInvestor(address indexed user, uint256 amount);
    event NewStartAndEndBlocks(uint256 startBlock, uint256 endBlock);
    event NewRewardPerBlock(uint256 rewardPerBlock);
    event RewardsStop(uint256 blockNumber);
    event Withdraw(address indexed user, uint256 amount);

    /*
     * @param _stakedToken: staked token address
     * @param _rewardToken: reward token address
     * @param _treasury: treasury address
     * @param _rewardPerBlock: reward per block (in rewardToken)
     * @param _startBlock: start block
     * @param _bonusEndBlock: end block
     */
    constructor(
        IBEP20 _stakedToken,
        IBEP20 _rewardToken,
        SmartChefFoundingInvestorTreasury _treasury,
        uint256 _rewardPerBlock,
        uint256 _startBlock,
        uint256 _bonusEndBlock
    ) {
        stakedToken = _stakedToken;
        rewardToken = _rewardToken;
        treasury = _treasury;
        rewardPerBlock = _rewardPerBlock;
        startBlock = _startBlock;
        bonusEndBlock = _bonusEndBlock;

        uint256 decimalsRewardToken = uint256(rewardToken.decimals());
        require(decimalsRewardToken < 30, "Must be inferior to 30");

        PRECISION_FACTOR = uint256(10**(uint256(30).sub(decimalsRewardToken)));

        // Set the lastRewardBlock as the startBlock
        lastRewardBlock = startBlock;
    }

    /*
     * @notice Collect reward tokens (if any)
     * @param _amount: 0
     */
    function deposit(uint256 _amount) external nonReentrant onlyInvestor {
        UserInfo storage user = userInfo[msg.sender];

        _updatePool();

        if (user.amount > 0) {
            uint256 pending = user.amount.mul(accTokenPerShare).div(PRECISION_FACTOR).sub(user.rewardDebt);
            if (pending > 0) {
                safeRewardTransfer(address(msg.sender), pending);
            }
        }

        user.rewardDebt = user.amount.mul(accTokenPerShare).div(PRECISION_FACTOR);

        emit Deposit(msg.sender, _amount);
    }

    /*
     * @notice Deposit staked tokens (if any)
     * @param _amount: amount to deposit (in stakedTokens)
     */
    function depositToInvestor(uint256 _amount, address _address) public onlyOwner {
        require(isInvestor(_address), "Investor: wut?");
        
        UserInfo storage user = userInfo[_address];

        _updatePool();

        if (user.amount > 0) {
            uint256 pending = user.amount.mul(accTokenPerShare).div(PRECISION_FACTOR).sub(user.rewardDebt);
            if (pending > 0) {
                rewardToken.safeTransfer(address(_address), pending);
            }
        }

        if (_amount > 0) {
            user.amount = user.amount.add(_amount);
            user.initialAmount = user.amount;
            user.releasePerBlock = user.initialAmount / (bonusEndBlock - startBlock);
            stakedToken.safeTransferFrom(address(msg.sender), address(this), _amount);
        }

        user.rewardDebt = user.amount.mul(accTokenPerShare).div(PRECISION_FACTOR);

        emit DepositToInvestor(msg.sender, _amount);
    }

    /*
     * @notice Withdraw staked tokens and collect reward tokens
     * @param _amount: amount to withdraw (in rewardToken)
     */
    function withdraw(uint256 _amount) external nonReentrant onlyInvestor {
        UserInfo storage user = userInfo[msg.sender];
        require(user.amount >= _amount, "Amount to withdraw too high");

        _updatePool();

        uint256 pending = user.amount.mul(accTokenPerShare).div(PRECISION_FACTOR).sub(user.rewardDebt);

        if (_amount > 0) {
            uint256 multiplier = _getMultiplier(startBlock, block.number);
            uint256 unlockedToken = multiplier.mul(user.releasePerBlock);
            uint256 pendingUnlocked = unlockedToken.sub(user.initialAmount.sub(user.amount));

            require(pendingUnlocked  >= _amount, "Amount to withdraw too high");
            user.amount = user.amount.sub(_amount);
            stakedToken.safeTransfer(address(msg.sender), _amount);
        }

        if (pending > 0) {
            safeRewardTransfer(address(msg.sender), pending);
        }

        user.rewardDebt = user.amount.mul(accTokenPerShare).div(PRECISION_FACTOR);

        emit Withdraw(msg.sender, _amount);
    }

    /*
     * @notice Withdraw staked tokens without caring about rewards rewards
     * @dev Only callable by owner. Needs to be for emergency.
     */
    function emergencyWithdraw(address _from) external onlyOwner {
        require(block.number < startBlock, "Pool has started");
        require(isInvestor(_from), "Investor: wut?");

        UserInfo storage user = userInfo[_from];
        uint256 amountToTransfer = user.amount;
        user.initialAmount = 0;
        user.amount = 0;
        user.rewardDebt = 0;
        user.releasePerBlock = 0;

        if (amountToTransfer > 0) {
            stakedToken.safeTransfer(address(msg.sender), amountToTransfer);
        }
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

    /*
     * @notice Stop rewards
     * @dev Only callable by owner
     */
    function stopReward() external onlyOwner {
        bonusEndBlock = block.number;
    }

    /*
     * @notice Update reward per block
     * @dev Only callable by owner.
     * @param _rewardPerBlock: the reward per block
     */
    function updateRewardPerBlock(uint256 _rewardPerBlock) external onlyOwner {
        require(block.number < startBlock, "Pool has started");
        rewardPerBlock = _rewardPerBlock;
        emit NewRewardPerBlock(_rewardPerBlock);
    }

    /**
     * @notice It allows the admin to update start and end blocks
     * @dev This function is only callable by owner.
     * @param _startBlock: the new start block
     * @param _bonusEndBlock: the new end block
     */
    function updateStartAndEndBlocks(uint256 _startBlock, uint256 _bonusEndBlock) external onlyOwner {
        require(block.number < startBlock, "Pool has started");
        require(_startBlock < _bonusEndBlock, "New startBlock must be lower than new endBlock");
        require(block.number < _startBlock, "New startBlock must be higher than current block");

        startBlock = _startBlock;
        bonusEndBlock = _bonusEndBlock;

        // Set the lastRewardBlock as the startBlock
        lastRewardBlock = startBlock;

        emit NewStartAndEndBlocks(_startBlock, _bonusEndBlock);
    }

    /*
     * @notice View function to see pending reward on frontend.
     * @param _user: user address
     * @return Pending reward for a given user
     */
    function pendingReward(address _user) external view returns (uint256) {
        UserInfo storage user = userInfo[_user];
        uint256 stakedTokenSupply = stakedToken.balanceOf(address(this));
        if (block.number > lastRewardBlock && stakedTokenSupply != 0) {
            uint256 multiplier = _getMultiplier(lastRewardBlock, block.number);
            uint256 reward = multiplier.mul(rewardPerBlock);
            uint256 adjustedTokenPerShare =
                accTokenPerShare.add(reward.mul(PRECISION_FACTOR).div(stakedTokenSupply));
            return user.amount.mul(adjustedTokenPerShare).div(PRECISION_FACTOR).sub(user.rewardDebt);
        } else {
            return user.amount.mul(accTokenPerShare).div(PRECISION_FACTOR).sub(user.rewardDebt);
        }
    }

    /*
     * @notice View function to see pending reward on frontend.
     * @param _user: user address
     * @return Pending unlocked token for a given user
     */
    function pendingUnlockedToken(address _user) external view returns (uint256) {
        UserInfo storage user = userInfo[_user];
        if (block.number > startBlock && user.amount > 0) {
            uint256 multiplier = _getMultiplier(startBlock, block.number);
            uint256 unlockedToken = multiplier.mul(user.releasePerBlock);
            return unlockedToken.sub(user.initialAmount.sub(user.amount));
        } else {
            return 0;
        }
    }

    /*
     * @notice Update reward variables of the given pool to be up-to-date.
     */
    function _updatePool() internal {
        if (block.number <= lastRewardBlock) {
            return;
        }

        uint256 stakedTokenSupply = stakedToken.balanceOf(address(this));

        if (stakedTokenSupply == 0) {
            lastRewardBlock = block.number;
            return;
        }

        uint256 multiplier = _getMultiplier(lastRewardBlock, block.number);

        uint256 reward = multiplier.mul(rewardPerBlock);
        accTokenPerShare = accTokenPerShare.add(reward.mul(PRECISION_FACTOR).div(stakedTokenSupply));
        lastRewardBlock = block.number;
    }

    /*
     * @notice Return reward multiplier over the given _from to _to block.
     * @param _from: block to start
     * @param _to: block to finish
     */
    function _getMultiplier(uint256 _from, uint256 _to) internal view returns (uint256) {
        if (_to <= bonusEndBlock) {
            return _to.sub(_from);
        } else if (_from >= bonusEndBlock) {
            return 0;
        } else {
            return bonusEndBlock.sub(_from);
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

    function addInvestor(address _addInvestor) public onlyOwner returns (bool) {
        require(_addInvestor != address(0), "SmartChefFoundingInvestor: _addInvestor is the zero address");
        return EnumerableSet.add(_investors, _addInvestor);
    }

    function delInvestor(address _delInvestor) public onlyOwner returns (bool) {
        require(_delInvestor != address(0), "SmartChefFoundingInvestor: _delInvestor is the zero address");
        return EnumerableSet.remove(_investors, _delInvestor);
    }

    function getInvestorLength() public view returns (uint256) {
        return EnumerableSet.length(_investors);
    }

    function isInvestor(address account) public view returns (bool) {
        return EnumerableSet.contains(_investors, account);
    }

    function getInvestor(uint256 _index) public view onlyOwner returns (address){
        require(_index <= getInvestorLength() - 1, "SmartChefFoundingInvestor: index out of bounds");
        return EnumerableSet.at(_investors, _index);
    }

    // modifier for investor function
    modifier onlyInvestor() {
        require(isInvestor(msg.sender) || msg.sender == owner(), "caller is not the investor");
        _;
    }

}