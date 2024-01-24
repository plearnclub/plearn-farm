// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../token/BEP20/IBEP20.sol";
import "../token/BEP20/SafeBEP20.sol";
import "./PlearnRewardTreasury.sol";

interface IBEP20Mintable is IERC20 {
    function mint(address to, uint256 amount) external;
}

contract PlearnMemberPool is Ownable, ReentrancyGuard {
    using SafeBEP20 for IBEP20;

    uint32 public endDay;
    uint32 public depositEndDay;

    IBEP20 public stakedToken;
    IBEP20 public plnRewardToken;
    IBEP20Mintable public pccRewardToken;
    PlearnRewardTreasury public rewardTreasury;

    uint32 public unlockDayPercentBase;
    uint32 public pccUnlockDayPercentBase;
    uint128 public constant PERCENT_BASE = 1000_000_000;

    struct Tier {
        uint32 lockDayPercent; // E.g., 0.005% is stored as (0.005 / 100) * 1e9 = 50,000
        uint32 pccLockDayPercent;
        uint32 lockPeriod;
        uint256 maxAmount;
        uint256 minAmount;
        uint256 totalDeposited;
    }

    struct UserInfo {
        uint256 amount;
        uint32 depositStartDay;
        uint32 aprStartDay;
        uint256 tierIndex;
        Tier tier;
    }

    Tier[] public tiers;

    mapping(address => UserInfo) public userInfo;

    constructor(
        IBEP20 _tokenAddress,
        IBEP20 _plnRewardToken,
        IBEP20Mintable _pccRewardToken,
        PlearnRewardTreasury _rewardTreasury,
        uint32 _endDay,
        uint32 _depositEndDay,
        uint32 _unlockDayPercentBase,
        uint32 _pccUnlockDayPercentBase
    ) {
        require(_endDay >= getCurrentDay(), "End day earlier than current day");
        stakedToken = _tokenAddress;
        plnRewardToken = _plnRewardToken;
        pccRewardToken = _pccRewardToken;
        rewardTreasury = _rewardTreasury;
        endDay = _endDay;
        unlockDayPercentBase = _unlockDayPercentBase;
        pccUnlockDayPercentBase = _pccUnlockDayPercentBase;
        depositEndDay = _depositEndDay;
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

    function transferInterest(UserInfo storage _userInfo) internal {
        (
            uint256 totalInterest,
            uint256 pccTotalInterest
        ) = calculateTotalInterest(_userInfo);

        if (totalInterest > 0) {
            safeRewardTransfer(msg.sender, totalInterest); // require totalInterest >= reward treasury balance
        }

        if (pccTotalInterest > 0) {
            pccRewardToken.mint(msg.sender, pccTotalInterest);
        }
        emit Harvest(msg.sender, totalInterest, pccTotalInterest);
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
            UserInfo memory info,
            uint32 currentDay,
            uint256 accruedInterest,
            uint256 pccAccruedInterest,
            uint32 endLockTime
        )
    {
        UserInfo memory _userInfo = userInfo[_user];
        Tier memory _userTier = _userInfo.tier;
        uint32 _currentDay = getCurrentDay();

        info = _userInfo;
        currentDay = _currentDay;

        (
            uint256 totalInterest,
            uint256 pccTotalInterest
        ) = calculateTotalInterest(_userInfo);
        accruedInterest = totalInterest;
        pccAccruedInterest = pccTotalInterest;

        uint32 lockEndDay = _userInfo.depositStartDay + _userTier.lockPeriod;
        endLockTime =
            (
                _userInfo.amount > 0
                    ? lockEndDay < endDay ? lockEndDay : endDay
                    : _userInfo.aprStartDay
            ) *
            86400 +
            43200;
    }

    function deposit(
        uint256 _tierIndex,
        uint256 _amount
    ) public nonReentrant notContract {
        require(_tierIndex < tiers.length, "Index out of bound");

        Tier memory _tier = tiers[_tierIndex];
        UserInfo storage _userInfo = userInfo[msg.sender];
        uint32 currentDay = getCurrentDay();

        require(currentDay < depositEndDay, "Deposit is disabled");

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

        if (_userInfo.amount != 0) {
            transferInterest(_userInfo);
        }

        stakedToken.safeTransferFrom(msg.sender, address(this), _amount);

        if (
            _userInfo.depositStartDay + _userInfo.tier.lockPeriod <= currentDay
        ) {
            _userInfo.depositStartDay = currentDay;
        }

        tiers[_tierIndex].totalDeposited += _amount;
        if (_userInfo.tierIndex != _tierIndex) {
            tiers[_userInfo.tierIndex].totalDeposited -= _userInfo.amount;
            tiers[_tierIndex].totalDeposited += _userInfo.amount;
            _userInfo.tierIndex = _tierIndex;
        }

        _userInfo.aprStartDay = currentDay;
        _userInfo.amount += _amount;
        _userInfo.tier = _tier;

        emit Deposit(msg.sender, _tierIndex, _amount);
    }

    function withdraw(uint256 _amount) public nonReentrant notContract {
        require(_amount > 0, "Withdraw amount must be greater than 0");
        UserInfo storage _userInfo = userInfo[msg.sender];
        uint256 _userTierIndex = _userInfo.tierIndex;
        Tier memory _userTier = _userInfo.tier;
        uint32 currentDay = getCurrentDay();

        require(_userInfo.amount >= _amount, "Amount to withdraw too high");

        if (currentDay < endDay) {
            require(
                currentDay - _userInfo.depositStartDay > _userTier.lockPeriod,
                "Cannot withdraw yet"
            );
        }

        transferInterest(_userInfo);

        uint256 currentTierIndex = getTierIndex(_userInfo.amount - _amount);

        if (_userTierIndex != currentTierIndex) {
            _userInfo.tierIndex = currentTierIndex;
            _userInfo.tier = tiers[currentTierIndex];
            tiers[_userTierIndex].totalDeposited -= _userInfo.amount;
            tiers[currentTierIndex].totalDeposited +=
                _userInfo.amount -
                _amount;
        } else {
            tiers[_userTierIndex].totalDeposited -= _amount;
        }

        _userInfo.amount -= _amount;
        _userInfo.aprStartDay = currentDay;

        stakedToken.safeTransfer(msg.sender, _amount);
        emit Withdraw(msg.sender, _amount);
    }

    function harvest() public nonReentrant notContract {
        UserInfo storage _userInfo = userInfo[msg.sender];
        uint32 currentDay = getCurrentDay();
        transferInterest(_userInfo);
        _userInfo.aprStartDay = currentDay;
    }

    function getMultiplier(
        uint32 _depositStartDay,
        uint32 _aprStartDay,
        uint32 _tierLockPeriod,
        uint32 _currentDay
    ) internal view returns (uint32 lockDays, uint32 unlockDays) {
        uint32 lockEndDay = _depositStartDay + _tierLockPeriod;

        if (_aprStartDay == 0) return (0, 0);

        uint32 finalDay = _currentDay <= endDay ? _currentDay : endDay;
        (lockDays, unlockDays) = calculateDays(
            _aprStartDay,
            lockEndDay,
            finalDay
        );
    }

    function calculateDays(
        uint32 _aprStartDay,
        uint32 _lockEndDay,
        uint32 _finalDay
    ) internal pure returns (uint32 lockDays, uint32 unlockDays) {
        uint32 lockAprEndDay = _lockEndDay < _finalDay
            ? _lockEndDay
            : _finalDay;

        uint32 unlockStartDay = (_aprStartDay < _lockEndDay)
            ? lockAprEndDay
            : _aprStartDay;

        lockDays = (lockAprEndDay >= _aprStartDay)
            ? lockAprEndDay - _aprStartDay
            : 0;

        unlockDays = _finalDay - unlockStartDay;
    }

    function calculateAccruedInterest(
        uint256 _amount,
        uint32 _dayPercent,
        uint32 _days
    ) public pure returns (uint256 accruedInterest) {
        accruedInterest = (_amount * _dayPercent * _days) / PERCENT_BASE;
    }

    function calculateTotalInterest(
        UserInfo memory _userInfo
    ) internal view returns (uint256 totalInterest, uint256 pccTotalInterest) {
        Tier memory _userTier = _userInfo.tier;

        uint32 currentDay = getCurrentDay();

        (uint32 lockDays, uint32 unlockDays) = getMultiplier(
            _userInfo.depositStartDay,
            _userInfo.aprStartDay,
            _userTier.lockPeriod,
            currentDay
        );

        uint256 plnLockInterest = calculateAccruedInterest(
            _userInfo.amount,
            _userTier.lockDayPercent,
            lockDays
        );

        uint256 plnUnlockInterest = calculateAccruedInterest(
            _userInfo.amount,
            unlockDayPercentBase,
            unlockDays
        );

        totalInterest = plnLockInterest + plnUnlockInterest;

        uint256 pccLockInterest = calculateAccruedInterest(
            _userInfo.amount,
            _userTier.pccLockDayPercent,
            lockDays
        );

        uint256 pccUnlockInterest = calculateAccruedInterest(
            _userInfo.amount,
            pccUnlockDayPercentBase,
            unlockDays
        );

        pccTotalInterest = pccLockInterest + pccUnlockInterest;

        return (totalInterest, pccTotalInterest);
    }

    function setDepositEndDay(uint32 _endDay) external onlyOwner {
        depositEndDay = _endDay;

        emit depositEndDayUpdated(_endDay);
    }

    function setEndDay(uint32 _endDay) external onlyOwner {
        require(
            getCurrentDay() < endDay,
            "Period has already ended, cannot be extended"
        );
        require(_endDay >= getCurrentDay(), "End day earlier than current day");
        endDay = _endDay;
        emit endDayUpdated(_endDay);
    }

    function setUnlockDayPercentBase(
        uint32 _unlockDayPercentBase,
        uint32 _pccUnlockDayPercentBase
    ) external onlyOwner {
        require(
            stakedToken.balanceOf(address(this)) == 0,
            "Cannot update base percent when tokens are already staked"
        );

        require(depositEndDay == 0, "Deposit is enabled");
        unlockDayPercentBase = _unlockDayPercentBase;
        pccUnlockDayPercentBase = _pccUnlockDayPercentBase;
        emit UnlockDayPercentBaseUpdated(
            _unlockDayPercentBase,
            _pccUnlockDayPercentBase
        );
    }

    function withdrawToken(
        IBEP20 _token,
        uint256 _amount,
        address _to
    ) external onlyOwner {
        require(_token != stakedToken, "Cannot be staked token");
        _token.safeTransfer(_to, _amount);
        emit TokenWithdraw(address(_token), _amount, _to);
    }

    function emergencyWithdraw(address _user) external onlyOwner {
        UserInfo storage _userInfo = userInfo[_user];
        uint256 amountToTransfer = _userInfo.amount;
        _userInfo.aprStartDay = 0;
        _userInfo.amount = 0;
        _userInfo.tierIndex = 0;
        _userInfo.depositStartDay = 0;
        _userInfo.tier = tiers[0];

        if (amountToTransfer > 0) {
            stakedToken.safeTransfer(_user, amountToTransfer);
        }
        emit EmergencyWithdraw(_user, amountToTransfer);
    }

    /* ========== EVENTS ========== */
    event Deposit(address indexed user, uint256 tierIndex, uint256 amount);
    event Withdraw(address indexed user, uint256 amount);
    event Harvest(address indexed user, uint256 amount, uint256 pccAmount);
    event endDayUpdated(uint32 endDay);
    event depositEndDayUpdated(uint32 endDay);
    event TierAdded(uint32 lockPeriod, uint256 tierIndex);
    event TierUpdated(uint256 tierIndex);
    event UnlockDayPercentBaseUpdated(
        uint32 unlockDayPercentBase,
        uint32 pccUnlockDayPercentBase
    );
    event TokenWithdraw(
        address indexed token,
        uint256 amount,
        address indexed to
    );
    event EmergencyWithdraw(address indexed user, uint256 amount);
}
