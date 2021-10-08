const { advanceBlockTo } = require('@openzeppelin/test-helpers/src/time');
const { assert } = require('chai');
const PlearnToken = artifacts.require('PlearnToken');
const SyrupBar = artifacts.require('SyrupBar');

contract('SyrupBar', ([alice, bob, carol, dev, minter]) => {
  beforeEach(async () => {
    var latestBlock = await ethers.provider.getBlockNumber();
    this.startBlock = latestBlock + 200;

    this.plearn = await PlearnToken.new({ from: minter });
    await this.plearn.addMinter(minter, { from: minter });
    this.syrup = await SyrupBar.new(this.plearn.address, { from: minter });
  });

  it('mint', async () => {
    await this.syrup.mint(alice, 1000, { from: minter });
    assert.equal((await this.syrup.balanceOf(alice)).toString(), '1000');
  });

  it('burn', async () => {
    await advanceBlockTo( this.startBlock + 650);
    await this.syrup.mint(alice, 1000, { from: minter });
    await this.syrup.mint(bob, 1000, { from: minter });
    assert.equal((await this.syrup.totalSupply()).toString(), '2000');
    await this.syrup.burn(alice, 200, { from: minter });

    assert.equal((await this.syrup.balanceOf(alice)).toString(), '800');
    assert.equal((await this.syrup.totalSupply()).toString(), '1800');
  });

  it('safePlearnTransfer', async () => {
    assert.equal(
      (await this.plearn.balanceOf(this.syrup.address)).toString(),
      '0'
    );
    await this.plearn.mint(this.syrup.address, 1000, { from: minter });
    await this.syrup.safePlearnTransfer(bob, 200, { from: minter });
    assert.equal((await this.plearn.balanceOf(bob)).toString(), '200');
    assert.equal(
      (await this.plearn.balanceOf(this.syrup.address)).toString(),
      '800'
    );
    await this.syrup.safePlearnTransfer(bob, 2000, { from: minter });
    assert.equal((await this.plearn.balanceOf(bob)).toString(), '1000');
  });
});
