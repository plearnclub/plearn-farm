const { assert } = require("chai");

const PlearnToken = artifacts.require('PlearnToken');

contract('PlearnToken', ([alice, bob, carol, dev, minter]) => {
    beforeEach(async () => {
        this.plearn = await PlearnToken.new({ from: minter });
        await this.plearn.addMinter(minter, { from: minter });
    });


    it('mint', async () => {
        await this.plearn.mint(alice, 1000, { from: minter });
        assert.equal((await this.plearn.balanceOf(alice)).toString(), '1000');
    })
});
