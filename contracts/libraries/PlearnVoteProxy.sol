// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.0;

import "../token/BEP20/IBEP20.sol";

contract PlearnVoteProxy {
    // EARN
    address public constant votes = 0x009cF7bC57584b7998236eff51b98A168DceA9B0;

    function decimals() external pure returns (uint8) {
        return uint8(18);
    }

    function name() external pure returns (string memory) {
        return "EARNVOTE";
    }

    function symbol() external pure returns (string memory) {
        return "EARN";
    }

    function totalSupply() external view returns (uint256) {
        return IBEP20(votes).totalSupply();
    }

    function balanceOf(address _voter) external view returns (uint256) {
        return IBEP20(votes).balanceOf(_voter);
    }

    constructor() {}
}
