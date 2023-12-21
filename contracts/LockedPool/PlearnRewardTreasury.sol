// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import "../PlearnToken.sol";
import "../token/BEP20/IBEP20.sol";
import "../token/BEP20/SafeBEP20.sol";

contract PlearnRewardTreasury is Ownable {
    using SafeBEP20 for IBEP20;
    using EnumerableSet for EnumerableSet.AddressSet;

    EnumerableSet.AddressSet private _admins;

    // The Plearn TOKEN!
    PlearnToken public plearn;

    event AdminTokenRecovery(address tokenRecovered, uint256 amount);

    constructor(PlearnToken _plearn) {
        plearn = _plearn;
    }

    // Safe reward transfer function, just in case if rounding error causes pool to not have enough reward.
    function safeRewardTransfer(address _to, uint256 _amount) public onlyAdmin {
        uint256 plearnBalance = plearn.balanceOf(address(this));
        if (_amount > plearnBalance) {
            plearn.transfer(_to, plearnBalance);
        } else {
            plearn.transfer(_to, _amount);
        }
    }

    function recoverWrongTokens(
        address _tokenAddress,
        uint256 _tokenAmount
    ) external onlyOwner {
        IBEP20(_tokenAddress).safeTransfer(address(msg.sender), _tokenAmount);

        emit AdminTokenRecovery(_tokenAddress, _tokenAmount);
    }

    function addAdmin(address _addAdmin) public onlyOwner returns (bool) {
        require(
            _addAdmin != address(0),
            "SmartChefFoundingInvestorTreasury: _addAdmin is the zero address"
        );
        return EnumerableSet.add(_admins, _addAdmin);
    }

    function delAdmin(address _delAdmin) public onlyOwner returns (bool) {
        require(
            _delAdmin != address(0),
            "SmartChefFoundingInvestorTreasury: _delAdmin is the zero address"
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
        require(
            _index <= getAdminLength() - 1,
            "SmartChefFoundingInvestorTreasury: index out of bounds"
        );
        return EnumerableSet.at(_admins, _index);
    }

    // modifier for reward transfer function
    modifier onlyAdmin() {
        require(isAdmin(msg.sender), "caller is not the admin");
        _;
    }
}
