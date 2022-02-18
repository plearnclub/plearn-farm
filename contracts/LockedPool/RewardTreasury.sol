// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import "../token/BEP20/IBEP20.sol";
import "../token/BEP20/SafeBEP20.sol";
import "../PlearnToken.sol";

interface IMasterChef {
    function deposit(uint256 _pid, uint256 _amount) external;
    function withdraw(uint256 _pid, uint256 _amount) external;
}

contract RewardTreasury is Ownable {
    using SafeBEP20 for IBEP20;
    using EnumerableSet for EnumerableSet.AddressSet;

    EnumerableSet.AddressSet private _admins;

    // The Plearn TOKEN!
    PlearnToken public plearn;

    IMasterChef public masterChef;

    address public lockedPoolToken;

    uint256 public masterChefPoolId;

    event DepositToMasterChef(address indexed user, uint256 indexed pid, uint256 amount);
    event WithdrawFromMasterChef(address indexed user, uint256 indexed pid, uint256 amount);
    event AdminTokenRecovery(address tokenRecovered, uint256 amount);

    constructor(PlearnToken _plearn, IMasterChef _masterChef, uint256 _masterChefPoolId, address _lockedPoolToken) {
        plearn = _plearn;
        masterChef = _masterChef;
        masterChefPoolId = _masterChefPoolId;
        lockedPoolToken = _lockedPoolToken;
    }

    // Safe reward transfer function, just in case if rounding error causes pool to not have enough reward.
    function safeRewardTransfer(address _to, uint256 _amount) public onlyAdmin { 
        uint256 plearnBalance = plearn.balanceOf(address(this));
        if (_amount > plearnBalance) {
            IMasterChef(masterChef).deposit(masterChefPoolId, 0);
        }
        plearn.transfer(_to, _amount);
    }

    function depositToMasterChef(uint256 _amount) external onlyOwner {
        IBEP20(lockedPoolToken).approve(address(masterChef), _amount);
        IBEP20(lockedPoolToken).safeTransferFrom(address(msg.sender), address(this), _amount);
        IMasterChef(masterChef).deposit(masterChefPoolId, _amount);

        emit DepositToMasterChef(msg.sender, masterChefPoolId, _amount);
    }

    function withdrawFromMasterChef(uint256 _amount) external onlyOwner {
         IMasterChef(masterChef).withdraw(masterChefPoolId, _amount);
         IBEP20(lockedPoolToken).safeTransfer(address(msg.sender), _amount);

         emit WithdrawFromMasterChef(msg.sender, masterChefPoolId, _amount);
    }

    function harvestFromMasterChef() external onlyOwner {
        IMasterChef(masterChef).deposit(masterChefPoolId, 0);
    }

    function recoverWrongTokens(address _tokenAddress, uint256 _tokenAmount) external onlyOwner {
        IBEP20(_tokenAddress).safeTransfer(address(msg.sender), _tokenAmount);

        emit AdminTokenRecovery(_tokenAddress, _tokenAmount);
    }

    function addAdmin(address _addAdmin) public onlyOwner returns (bool) {
        require(
            _addAdmin != address(0),
            "RewardTreasury: _addAdmin is the zero address"
        );
        return EnumerableSet.add(_admins, _addAdmin);
    }

    function delAdmin(address _delAdmin) public onlyOwner returns (bool) {
        require(
            _delAdmin != address(0),
            "RewardTreasury: _delAdmin is the zero address"
        );
        return EnumerableSet.remove(_admins, _delAdmin);
    }

    function getAdminLength() public view returns (uint256) {
        return EnumerableSet.length(_admins);
    }

    function isAdmin(address account) public view returns (bool) {
        return EnumerableSet.contains(_admins, account);
    }

    function getAdmin(uint256 _index) public view onlyOwner returns (address) {
        require(_index <= getAdminLength() - 1, "RewardTreasury: index out of bounds");
        return EnumerableSet.at(_admins, _index);
    }

    // modifier for reward transfer function
    modifier onlyAdmin() {
        require(isAdmin(msg.sender), "caller is not the admin");
        _;
    }
    
}