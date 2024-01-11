// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "../token/BEP20/IBEP20.sol";
import "../token/BEP20/SafeBEP20.sol";
import "./PlearnRewardTreasury.sol";

interface IBEP20Mintable is IBEP20 {
    function mint(address to, uint256 amount) external returns (bool);
}

contract PlearnMemberPool is Ownable, ReentrancyGuard {
    using SafeBEP20 for IBEP20;

    uint32 public endDay;
    bool public depositEnabled;

    IBEP20 public stakedToken;
    IBEP20 public plnRewardToken;
    IBEP20Mintable public pccRewardToken;
    PlearnRewardTreasury public rewardTreasury;

    uint128 public constant PERCENT_BASE = 1000_000_000;

    struct Tier {
        uint32 lockDayPercent;
        uint32 unlockDayPercent;
        uint32 lockPeriod;
        uint256 maxAmount;
        uint256 minAmount;
        uint256 totalDeposited;
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

    Tier[] public tiers;

    mapping(address => UserInfo) public userInfo;

    constructor(
        IBEP20 _tokenAddress,
        IBEP20 _plnRewardToken,
        IBEP20Mintable _pccRewardToken,
        PlearnRewardTreasury _rewardTreasury,
        uint32 _endDay,
        bool _depositEnabled
    ) {
        stakedToken = _tokenAddress;
        plnRewardToken = _plnRewardToken;
        pccRewardToken = _pccRewardToken;
        rewardTreasury = _rewardTreasury;
        endDay = _endDay;
        depositEnabled = _depositEnabled;
    }

    modifier notContract() {
        require(msg.sender == tx.origin, "Proxy contract not allowed");
        require(msg.sender.code.length == 0, "Contract not allowed");
        _;
    }

    function addTier(Tier calldata _tier) external onlyOwner {
        tiers.push(_tier);
        emit TierAdded(_tier.lockPeriod, tiers.length - 1);
    }

    function setTier(
        uint256 _tierIndex,
        Tier calldata _tier
    ) external onlyOwner {
        require(_tierIndex < tiers.length, "Index out of bound");
        require(_tier.maxAmount >= _tier.minAmount, "Incorrect amount limit");
        uint256 _totalDeposited = tiers[_tierIndex].totalDeposited;
        tiers[_tierIndex] = _tier;
        tiers[_tierIndex].totalDeposited = _totalDeposited; // Save total deposited when upgrade tier
        emit TierUpdated(_tierIndex);
    }

    function tierLength() public view returns (uint256 length) {
        length = tiers.length;
    }

    function getTierIndex(
        uint256 _amount
    ) public view returns (uint256 tierIndex) {
        for (uint256 i = 0; i < tiers.length; i++) {
            if (
                _amount >= tiers[i].minAmount && _amount <= tiers[i].maxAmount
            ) {
                tierIndex = i;
            }
        }
    }

    function setRewardTreasury(
        PlearnRewardTreasury _newRewardTreasury
    ) external onlyOwner {
        rewardTreasury = _newRewardTreasury;
    }

    function safeRewardTransfer(address _to, uint256 _amount) internal {
        require(
            plnRewardToken.balanceOf(address(rewardTreasury)) >= _amount,
            "Insufficient reward balance in treasury"
        );
        rewardTreasury.safeRewardTransfer(_to, _amount);
    }

    function getCurrentDay() public view returns (uint32 currentDay) {
        currentDay = uint32((block.timestamp + 43200) / 86400); // Accrue everyday on 12:00 PM UTC
    }

    function getUserInfo(
        address _user
    )
        public
        view
        returns (
            InfoFront memory info,
            uint32 currentDay,
            uint256 accruedInterest
        )
    {
        info.userInfo = userInfo[_user];
        Tier memory _userTier = tiers[info.userInfo.tierIndex];
        info.tier = _userTier;
        currentDay = getCurrentDay();

        (uint32 lockDays, uint32 unlockDays) = getMultiplier(
            info.userInfo.lastDayAction,
            info.tier.lockPeriod
        );
        uint256 lockInterest = info.userInfo.amount < _userTier.minAmount
            ? 0
            : (info.userInfo.amount * _userTier.lockDayPercent * lockDays) /
                PERCENT_BASE;
        uint256 unlockInterest = info.userInfo.amount < _userTier.minAmount
            ? 0
            : (info.userInfo.amount * _userTier.unlockDayPercent * unlockDays) /
                PERCENT_BASE;
        accruedInterest = lockInterest + unlockInterest;

        uint32 lockEndDay = info.userInfo.firstDayLocked + info.tier.lockPeriod;
        info.endLockTime = info.userInfo.amount > 0
            ? lockEndDay < endDay
                ? lockEndDay * 86400 + 43200
                : endDay * 86400 + 43200
            : info.userInfo.lastDayAction * 86400 + 43200;
    }

    function deposit(
        uint256 _tierIndex,
        uint256 _amount
    ) public nonReentrant notContract {
        require(_tierIndex < tiers.length, "Index out of bound");

        Tier memory _tier = tiers[_tierIndex];
        UserInfo storage _userInfo = userInfo[msg.sender];
        uint32 currentDay = getCurrentDay();

        require(depositEnabled && currentDay < endDay, "Deposit is disabled");

        require(
            _tierIndex >= _userInfo.tierIndex,
            "Cannot deposit to a lower tier"
        );

        require(
            _userInfo.amount + _amount >= _tier.minAmount,
            "Need more amount"
        );

        require(
            _userInfo.amount + _amount <= _tier.maxAmount,
            "Amount over tier limits"
        );
        require(currentDay + _tier.lockPeriod < endDay, "Too late");

        if (currentDay - _userInfo.firstDayLocked > _tier.lockPeriod) {
            _userInfo.firstDayLocked = currentDay;
        }

        stakedToken.safeTransferFrom(msg.sender, address(this), _amount);

        if (_userInfo.amount != 0) {
            Tier memory _userTier = tiers[_userInfo.tierIndex];
            (uint32 lockDays, uint32 unlockDays) = getMultiplier(
                _userInfo.lastDayAction,
                _userTier.lockPeriod
            );
            uint256 lockInterest = _userInfo.amount < _userTier.minAmount
                ? 0
                : (_userInfo.amount * _userTier.lockDayPercent * lockDays) /
                    PERCENT_BASE;
            uint256 unlockInterest = _userInfo.amount < _userTier.minAmount
                ? 0
                : (_userInfo.amount * _userTier.unlockDayPercent * unlockDays) /
                    PERCENT_BASE;
            uint256 totalInterest = lockInterest + unlockInterest;

            if (totalInterest > 0) {
                safeRewardTransfer(msg.sender, totalInterest); // require totalInterest >= reward treasury balance
            }
        }

        if (_userInfo.tierIndex != _tierIndex) {
            tiers[_userInfo.tierIndex].totalDeposited -= _userInfo.amount;
            tiers[_tierIndex].totalDeposited += _userInfo.amount + _amount;
            _userInfo.tierIndex = _tierIndex;
        } else {
            tiers[_tierIndex].totalDeposited += _amount;
        }

        _userInfo.lastDayAction = currentDay;
        _userInfo.amount += _amount;

        emit Deposit(msg.sender, _tierIndex, _amount);
    }

    function withdraw(uint256 _amount) public nonReentrant notContract {
        UserInfo storage _userInfo = userInfo[msg.sender];
        uint256 _userTierIndex = _userInfo.tierIndex;
        Tier memory _tier = tiers[_userTierIndex];
        uint32 currentDay = getCurrentDay();

        require(_userInfo.amount > 0, "User has zero deposit");
        require(_amount > 0, "Withdraw amount must be greater than 0");
        require(_userInfo.amount >= _amount, "Amount to withdraw too high");
        require(
            currentDay - _userInfo.firstDayLocked > _tier.lockPeriod,
            "Cannot withdraw yet"
        );

        (uint32 lockDays, uint32 unlockDays) = getMultiplier(
            _userInfo.lastDayAction,
            _tier.lockPeriod
        );

        uint256 lockInterest = _userInfo.amount < _tier.minAmount
            ? 0
            : (_userInfo.amount * _tier.lockDayPercent * lockDays) /
                PERCENT_BASE;
        uint256 unlockInterest = _userInfo.amount < _tier.minAmount
            ? 0
            : (_userInfo.amount * _tier.unlockDayPercent * unlockDays) /
                PERCENT_BASE;
        uint256 totalInterest = lockInterest + unlockInterest;

        if (totalInterest > 0) {
            safeRewardTransfer(msg.sender, totalInterest); // require totalInterest >= reward treasury balance
        }

        uint256 currentTierIndex = getTierIndex(_userInfo.amount - _amount);

        if (_userTierIndex != currentTierIndex) {
            _userInfo.tierIndex = currentTierIndex;

            tiers[_userTierIndex].totalDeposited -= _userInfo.amount;
            tiers[currentTierIndex].totalDeposited +=
                _userInfo.amount -
                _amount;
        } else {
            tiers[_userTierIndex].totalDeposited -= _amount;
        }

        _userInfo.amount -= _amount;
        _userInfo.lastDayAction = currentDay;

        stakedToken.safeTransfer(msg.sender, _amount);
        emit Withdraw(msg.sender, _amount);
    }

    function harvest() public nonReentrant notContract {
        UserInfo storage _userInfo = userInfo[msg.sender];

        uint256 _userTierIndex = _userInfo.tierIndex;

        Tier memory _tier = tiers[_userTierIndex];

        uint32 currentDay = getCurrentDay();

        (uint32 lockDays, uint32 unlockDays) = getMultiplier(
            _userInfo.lastDayAction,
            _tier.lockPeriod
        );
        uint256 lockInterest = _userInfo.amount < _tier.minAmount
            ? 0
            : (_userInfo.amount * _tier.lockDayPercent * lockDays) /
                PERCENT_BASE;
        uint256 unlockInterest = _userInfo.amount < _tier.minAmount
            ? 0
            : (_userInfo.amount * _tier.unlockDayPercent * unlockDays) /
                PERCENT_BASE;
        uint256 totalInterest = lockInterest + unlockInterest;

        _userInfo.lastDayAction = currentDay;

        safeRewardTransfer(msg.sender, totalInterest); // require totalInterest >= reward treasury balance
        emit Harvest(msg.sender, totalInterest);
    }

    function getMultiplier(
        uint32 _lastDayAction,
        uint32 _tierLockPeriod
    ) internal view returns (uint32 lockDays, uint32 unlockDays) {
        uint32 currentDay = getCurrentDay();
        uint32 lockEndDay = _lastDayAction + _tierLockPeriod;

        if (_lastDayAction == 0) return (0, 0);

        if ((currentDay >= _lastDayAction) && (currentDay <= endDay)) {
            if (lockEndDay < currentDay) {
                lockDays = _tierLockPeriod;
                unlockDays = currentDay - lockEndDay;
            } else {
                lockDays = currentDay - _lastDayAction;
                unlockDays = 0;
            }
        } else if (
            (currentDay >= _lastDayAction) &&
            (currentDay > endDay) &&
            (endDay >= _lastDayAction)
        ) {
            if (lockEndDay < endDay) {
                lockDays = _tierLockPeriod;
                unlockDays = endDay - lockEndDay;
            } else {
                lockDays = endDay - _lastDayAction;
                unlockDays = 0;
            }
        } else {
            lockDays = 0;
            unlockDays = 0;
        }
    }

    function setDepositEnabled(bool _state) external onlyOwner {
        depositEnabled = _state;

        emit depositEnabledUpdated(_state);
    }

    function setEndDay(uint32 _endDay) external onlyOwner {
        require(_endDay >= getCurrentDay(), "End day earlier than current day");
        endDay = _endDay;
        emit endDayUpdated(_endDay);
    }

    function withdrawToken(
        IBEP20 _token,
        uint256 _amount,
        address _to
    ) external onlyOwner {
        require(
            address(_token) != address(0) && _to != address(0),
            "Cant be zero address"
        );
        _token.safeTransfer(_to, _amount);
        emit TokenWithdraw(address(_token), _amount, _to);
    }

    /* ========== EVENTS ========== */
    event Deposit(address indexed user, uint256 tierIndex, uint256 amount);
    event Withdraw(address indexed user, uint256 amount);
    event Harvest(address indexed user, uint256 amount);
    event endDayUpdated(uint32 endDay);
    event depositEnabledUpdated(bool state);
    event TierAdded(uint32 lockPeriod, uint256 tierIndex);
    event TierUpdated(uint256 tierIndex);
    event TokenWithdraw(
        address indexed token,
        uint256 amount,
        address indexed to
    );
}
