const { advanceBlockTo } = require('@openzeppelin/test-helpers/src/time');
const { assert } = require('chai');
const PlearnToken = artifacts.require('PlearnToken');
const PlearnEarn = artifacts.require('PlearnEarn');

contract('PlearnEarn', ([alice, bob, carol, dev, minter]) => {
  beforeEach(async () => {
    var latestBlock = await ethers.provider.getBlockNumber();
    this.startBlock = latestBlock + 200;

    this.plearn = await PlearnToken.new({ from: minter });
    await this.plearn.addMinter(minter, { from: minter });
    this.earn = await PlearnEarn.new(this.plearn.address, { from: minter });
  });

  it('mint', async () => {
    await this.earn.mint(alice, 1000, { from: minter });
    assert.equal((await this.earn.balanceOf(alice)).toString(), '1000');
  });

  it('burn', async () => {
    await advanceBlockTo( this.startBlock + 650);
    await this.earn.mint(alice, 1000, { from: minter });
    await this.earn.mint(bob, 1000, { from: minter });
    assert.equal((await this.earn.totalSupply()).toString(), '2000');
    await this.earn.burn(alice, 200, { from: minter });

    assert.equal((await this.earn.balanceOf(alice)).toString(), '800');
    assert.equal((await this.earn.totalSupply()).toString(), '1800');
  });

  it('safePlearnTransfer', async () => {
    assert.equal(
      (await this.plearn.balanceOf(this.earn.address)).toString(),
      '0'
    );
    await this.plearn.mint(this.earn.address, 1000, { from: minter });
    await this.earn.safePlearnTransfer(bob, 200, { from: minter });
    assert.equal((await this.plearn.balanceOf(bob)).toString(), '200');
    assert.equal(
      (await this.plearn.balanceOf(this.earn.address)).toString(),
      '800'
    );
    await this.earn.safePlearnTransfer(bob, 2000, { from: minter });
    assert.equal((await this.plearn.balanceOf(bob)).toString(), '1000');
  });
});
