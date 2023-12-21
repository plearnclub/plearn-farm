// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "../token/BEP20/IBEP20.sol";
import "../token/BEP20/SafeBEP20.sol";
import "./PlearnRewardTreasury.sol";

import "../PlearnToken.sol";
import "../PlearnCoin.sol";

contract PlearnRankPool is Ownable, ReentrancyGuard {
    using SafeBEP20 for IBEP20;

    bool public hasUserLimit;
    uint256 public endBlock;
    uint256 public startBlock;
    uint256 public userLimitPerPool;
    uint256 public PRECISION_FACTOR;
    uint256 public BLOCKS_PER_YEAR;

    IBEP20 public stakedToken;
    IBEP20 public plnRewardToken;
    PlearnCoin public plncRewardToken;
    PlearnRewardTreasury public rewardTreasury;

    uint256 public lockDuration;
    uint256 public tierCount;
    uint256 public userCount;
    uint256 public maxAmountRewardCalculation;

    bool public isWithdrawUnlocked;

    struct Tier {
        uint256 id;
        uint256 minimumAmount;
        uint256 maximumAmount;
        uint256 plnRewardPerBlockPerPLN;
        uint256 plncRewardPerBlockPerPLN;
    }

    struct UserInfo {
        uint256 amount;
        uint256 lockEndTime;
        uint256 lastPLNRewardBlock;
        uint256 lastPLNCRewardBlock;
    }

    mapping(uint256 => Tier) public tiers;
    mapping(address => UserInfo) public userInfo;

    constructor(
        IBEP20 _tokenAddress,
        IBEP20 _plnRewardToken,
        PlearnCoin _plncRewardToken,
        PlearnRewardTreasury _rewardTreasury,
        uint256 _lockDuration,
        uint256 _startBlock,
        uint256 _endBlock,
        uint256 _userLimitPerPool
    ) {
        stakedToken = _tokenAddress;
        plnRewardToken = _plnRewardToken;
        plncRewardToken = _plncRewardToken;
        rewardTreasury = _rewardTreasury;
        startBlock = _startBlock;
        endBlock = _endBlock;
        lockDuration = _lockDuration;
        BLOCKS_PER_YEAR = 10512000; // (60 / BSC_BLOCK_TIME) * 60 * 24 * 365

        if (_userLimitPerPool > 0) {
            hasUserLimit = true;
            userLimitPerPool = _userLimitPerPool;
        }

        uint256 decimalsRewardToken = uint256(plnRewardToken.decimals());
        require(decimalsRewardToken < 30, "Must be inferior to 30");
        PRECISION_FACTOR = uint256(10 ** (30 - decimalsRewardToken));
        tierCount = 0;
    }

    function deposit(uint256 _amount) external nonReentrant {
        UserInfo storage user = userInfo[msg.sender];
        require(_amount > 0, "Deposit amount must be greater than 0");

        if (hasUserLimit) {
            require(userCount < userLimitPerPool, "User amount above limit");
        }

        if (user.amount == 0) {
            userCount++;
        }

        // Handle reward calculation and distribution
        updateRewards(msg.sender);

        user.amount += _amount;
        user.lastPLNRewardBlock = block.number;
        user.lastPLNCRewardBlock = block.number;
        user.lockEndTime = block.timestamp + lockDuration;

        stakedToken.safeTransferFrom(msg.sender, address(this), _amount);
        emit Deposit(msg.sender, _amount);
    }

    function withdraw(uint256 _amount) external nonReentrant {
        UserInfo storage user = userInfo[msg.sender];
        require(_amount > 0, "Withdraw amount must be greater than 0");
        require(user.amount >= _amount, "Amount to withdraw too high");
        require(
            user.lockEndTime <= block.timestamp || isWithdrawUnlocked,
            "Cannot withdraw yet"
        );

        // Handle reward calculation and distribution
        updateRewards(msg.sender);

        user.amount -= _amount;
        if (user.amount == 0) {
            userCount--;
        }

        stakedToken.safeTransfer(msg.sender, _amount);
        emit Withdraw(msg.sender, _amount);
    }

    function harvest() external nonReentrant {
        updateRewards(msg.sender);
        emit Harvest(msg.sender);
    }

    function updateRewards(address _user) internal {
        UserInfo storage user = userInfo[_user];
        if (user.amount > 0) {
            Tier memory userTier = getUserTier(user.amount);

            // Calculate rewards
            uint256 pendingPLN = calculatePLNReward(user, userTier);
            uint256 pendingPLNC = calculatePLNCReward(user, userTier);

            if (pendingPLN > 0) {
                safeRewardTransfer(_user, pendingPLN);
            }
            if (pendingPLNC > 0) {
                plncRewardToken.mint(_user, pendingPLNC);
            }
        }
    }

    function calculatePLNReward(
        UserInfo memory user,
        Tier memory tier
    ) internal view returns (uint256) {
        return
            calculateReward(
                user.lastPLNRewardBlock,
                block.number,
                user.amount,
                tier.plnRewardPerBlockPerPLN
            );
    }

    function calculatePLNCReward(
        UserInfo memory user,
        Tier memory tier
    ) internal view returns (uint256) {
        return
            calculateReward(
                user.lastPLNCRewardBlock,
                block.number,
                user.amount,
                tier.plncRewardPerBlockPerPLN
            );
    }

    function calculateReward(
        uint256 _lastRewardBlock,
        uint256 _currentBlock,
        uint256 _amount,
        uint256 _rewardPerBlockPerPLN
    ) internal view returns (uint256) {
        if (_lastRewardBlock < startBlock) {
            _lastRewardBlock = startBlock;
        }
        if (_currentBlock > endBlock) {
            _currentBlock = endBlock;
        }
        if (_lastRewardBlock > _currentBlock) {
            return 0;
        }
        uint256 totalReward = (_currentBlock - _lastRewardBlock) *
            _rewardPerBlockPerPLN *
            _amount;
        return totalReward;
    }

    function pendingPLNReward(address _user) external view returns (uint256) {
        UserInfo storage user = userInfo[_user];
        Tier memory userTier = getUserTier(user.amount);

        // Calculate rewards
        uint256 pendingPLN = calculatePLNReward(user, userTier);
        return pendingPLN;
    }

    function pendingPLNCReward(address _user) external view returns (uint256) {
        UserInfo storage user = userInfo[_user];
        Tier memory userTier = getUserTier(user.amount);

        // Calculate rewards
        uint256 pendingPLNC = calculatePLNCReward(user, userTier);
        return pendingPLNC;
    }

    // set withdraw lock
    function setWithdrawUnlocked(bool value) external nonReentrant onlyOwner {
        isWithdrawUnlocked = value;
    }

    // add a new tier
    function addTier(
        uint256 _minimumAmount,
        uint256 _maximumAmount,
        uint256 _plnRewardPerBlockPerPLN,
        uint256 _plncRewardPerBlockPerPLN
    ) public onlyOwner {
        maxAmountRewardCalculation = max(
            maxAmountRewardCalculation,
            _maximumAmount
        );

        tiers[tierCount] = Tier({
            id: tierCount,
            minimumAmount: _minimumAmount,
            maximumAmount: _maximumAmount,
            plnRewardPerBlockPerPLN: _plnRewardPerBlockPerPLN,
            plncRewardPerBlockPerPLN: _plncRewardPerBlockPerPLN
        });
        tierCount++;
    }

    // update an existing tier
    function updateTier(
        uint256 _id,
        uint256 _minimumAmount,
        uint256 _maximumAmount,
        uint256 _plnRewardPerBlockPerPLN,
        uint256 _plncRewardPerBlockPerPLN
    ) public onlyOwner {
        require(tiers[_id].id == _id, "Tier does not exist");
        maxAmountRewardCalculation = max(
            maxAmountRewardCalculation,
            _maximumAmount
        );

        tiers[_id] = Tier({
            id: _id,
            minimumAmount: _minimumAmount,
            maximumAmount: _maximumAmount,
            plnRewardPerBlockPerPLN: _plnRewardPerBlockPerPLN,
            plncRewardPerBlockPerPLN: _plncRewardPerBlockPerPLN
        });
    }

    function getUserTier(uint256 _amount) public view returns (Tier memory) {
        if (_amount >= maxAmountRewardCalculation) {
            for (uint256 i = 0; i < tierCount; i++) {
                if (maxAmountRewardCalculation == tiers[i].maximumAmount) {
                    return tiers[i];
                }
            }
        }

        for (uint256 i = 0; i < tierCount; i++) {
            if (
                _amount >= tiers[i].minimumAmount &&
                _amount < tiers[i].maximumAmount
            ) {
                return tiers[i];
            }
        }
        return
            Tier({
                id: 0,
                minimumAmount: 0,
                maximumAmount: 0,
                plnRewardPerBlockPerPLN: 0,
                plncRewardPerBlockPerPLN: 0
            });
    }

    /*
     * @notice Reward transfer function.
     * @param _to: user address
     * @param _amount: amount to withdraw (in rewardToken)
     */
    function safeRewardTransfer(address _to, uint256 _amount) internal {
        rewardTreasury.safeRewardTransfer(_to, _amount);
    }

    /**
     * @notice It allows the owner to recover wrong tokens sent to the contract
     * @param _tokenAddress: the address of the token to withdraw
     * @param _tokenAmount: the number of tokens to withdraw
     * @dev This function is only callable by owner.
     */
    function recoverWrongTokens(
        address _tokenAddress,
        uint256 _tokenAmount
    ) external onlyOwner {
        require(
            _tokenAddress != address(stakedToken),
            "Cannot be staked token"
        );
        require(
            _tokenAddress != address(plnRewardToken),
            "Cannot be reward token"
        );
        require(
            _tokenAddress != address(plncRewardToken),
            "Cannot be reward token"
        );

        IBEP20(_tokenAddress).safeTransfer(address(msg.sender), _tokenAmount);

        emit AdminTokenRecovery(_tokenAddress, _tokenAmount);
    }

    /*
     * @notice Stop rewards
     * @dev Only callable by owner
     */
    function stopReward() external onlyOwner {
        endBlock = block.number;
        emit RewardsStop(block.number);
    }

    /**
     * @notice It allows the owner to update start and end blocks
     * @dev This function is only callable by owner.
     * @param _startBlock: the new start block
     * @param _endBlock: the new end block
     */
    function updateStartAndEndBlocks(
        uint256 _startBlock,
        uint256 _endBlock
    ) external onlyOwner {
        require(block.number < startBlock, "Pool has started");
        require(
            _startBlock < _endBlock,
            "New startBlock must be lower than new endBlock"
        );
        require(
            block.number < _startBlock,
            "New startBlock must be higher than current block"
        );

        startBlock = _startBlock;
        endBlock = _endBlock;

        emit NewStartAndEndBlocks(_startBlock, _endBlock);
    }

    function updateEndBlocks(uint256 _endBlock) external onlyOwner {
        require(
            startBlock < _endBlock,
            "New endBlock must be higher than startBlock"
        );
        require(
            block.number < _endBlock,
            "New endBlock must be higher than current block"
        );

        endBlock = _endBlock;

        emit NewEndBlocks(_endBlock);
    }

    function max(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a : b;
    }

    /* ========== EVENTS ========== */
    event Deposit(address indexed user, uint256 amount);
    event Withdraw(address indexed user, uint256 amount);
    event Harvest(address indexed user);
    event AdminTokenRecovery(address tokenRecovered, uint256 amount);
    event RewardsStop(uint256 blockNumber);
    event NewStartAndEndBlocks(uint256 startBlock, uint256 endBlock);
    event NewEndBlocks(uint256 endBlock);
}
