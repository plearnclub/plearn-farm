// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.0;

import "../token/BEP20/BEP20.sol";

contract MockBEP20 is BEP20 {
    constructor(
        string memory tokenName,
        string memory tokenSymbol,
        uint256 supply
    ) BEP20(tokenName, tokenSymbol) {
        _mint(msg.sender, supply);
    }
}
