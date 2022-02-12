// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.0;

import "../token/BEP20/BEP20.sol";

contract SimpleBEP20 is BEP20 {

    constructor (
        string memory name,
        string memory symbol,
        uint256 initialBalance
    ) BEP20(name, symbol)
    {
        require(initialBalance > 0, "SimpleBEP20: supply cannot be zero");
        _mint(_msgSender(), initialBalance);
    }
}