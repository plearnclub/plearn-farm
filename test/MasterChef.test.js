const { expectRevert, time } = require('@openzeppelin/test-helpers');
const PlearnToken = artifacts.require('PlearnToken');
const SyrupBar = artifacts.require('SyrupBar');
const MockBEP20 = artifacts.require('libs/MockBEP20');
const { ethers, upgrades } = require('hardhat');
const { BigNumber, utils } = ethers;

contract('MasterChef', ([minter, bob, carol, dev, ref, safu, alice]) => {
    beforeEach(async () => {
      const [minterSigner, bobSigner, carolSigner, , , , aliceSigner] = await ethers.getSigners();
        this.plearn = await PlearnToken.new({ from: minter });
        this.syrup = await SyrupBar.new(this.plearn.address, { from: minter });
        this.lp1 = await MockBEP20.new('LPToken', 'LP1', '1000000', { from: minter });
        this.lp2 = await MockBEP20.new('LPToken', 'LP2', '1000000', { from: minter });
        this.lp3 = await MockBEP20.new('LPToken', 'LP3', '1000000', { from: minter });
        const MasterChef = await ethers.getContractFactory("MasterChef");
      
        var latestBlock = await ethers.provider.getBlockNumber();
        this.startBlock = latestBlock + 100;

        this.chef = await upgrades.deployProxy(MasterChef, [this.plearn.address, this.syrup.address, dev, ref, safu, '1000', this.startBlock, '857000', '90000', '43000', '10000'], { from: minter });
        await this.plearn.addMinter(this.chef.address , { from: minter });
        // await this.plearn.transferOwnership(this.chef.address, { from: minter });
        await this.syrup.transferOwnership(this.chef.address, { from: minter });
        await this.lp1.transfer(bob, '2000', { from: minter });
        await this.lp2.transfer(bob, '2000', { from: minter });
        await this.lp3.transfer(bob, '2000', { from: minter });

        await this.lp1.transfer(alice, '2000', { from: minter });
        await this.lp2.transfer(alice, '2000', { from: minter });
        await this.lp3.transfer(alice, '2000', { from: minter });
    });

    it('real case', async () => {
      const [minterSigner, bobSigner, carolSigner, , , , aliceSigner] = await ethers.getSigners();
      var chef = this.chef.connect(minterSigner);

      this.lp4 = await MockBEP20.new('LPToken', 'LP1', '1000000', { from: minter });
      this.lp5 = await MockBEP20.new('LPToken', 'LP2', '1000000', { from: minter });
      this.lp6 = await MockBEP20.new('LPToken', 'LP3', '1000000', { from: minter });
      this.lp7 = await MockBEP20.new('LPToken', 'LP1', '1000000', { from: minter });
      this.lp8 = await MockBEP20.new('LPToken', 'LP2', '1000000', { from: minter });
      this.lp9 = await MockBEP20.new('LPToken', 'LP3', '1000000', { from: minter });
      await chef.add('2000', this.lp1.address, true, { from: minter });
      await chef.add('1000', this.lp2.address, true, { from: minter });
      await chef.add('500', this.lp3.address, true, { from: minter });
      await chef.add('500', this.lp3.address, true, { from: minter });
      await chef.add('500', this.lp3.address, true, { from: minter });
      await chef.add('500', this.lp3.address, true, { from: minter });
      await chef.add('500', this.lp3.address, true, { from: minter });
      await chef.add('100', this.lp3.address, true, { from: minter });
      await chef.add('100', this.lp3.address, true, { from: minter }); 
      assert.equal((await this.chef.poolLength()).toString(), "10");

      await getLastRewardBlock(1, this.chef);

      await time.advanceBlockTo(this.startBlock + 170);
      await this.lp1.approve(this.chef.address, '1000', { from: alice });
      assert.equal((await this.plearn.balanceOf(alice)).toString(), '0');
      
      chef = this.chef.connect(aliceSigner);

      await chef.deposit(1, '20', { from: alice });
      await chef.withdraw(1, '20', { from: alice });
      
      var info = await this.chef.poolInfo([1]);
      await getLastRewardBlock(1, this.chef);
      assert.equal((await this.plearn.balanceOf(alice)).toString(), '255');

      await this.plearn.approve(this.chef.address, '1000', { from: alice });
      await chef.enterStaking('20', { from: alice });
      await chef.enterStaking('0', { from: alice });
      await chef.enterStaking('0', { from: alice });
      await chef.enterStaking('0', { from: alice });
      assert.equal((await this.plearn.balanceOf(alice)).toString(), '616');
    })

    async function getLastRewardBlock(index, chef) {
      var info = await chef.poolInfo([index]);
      var lastRewardBlock = info ? BigNumber.from(info.lastRewardBlock) : 0;

      console.log('pools lastRewardBlock', (lastRewardBlock).toString());
    }


    it('deposit/withdraw', async () => {
      const [minterSigner, bobSigner, carolSigner, , , , aliceSigner] = await ethers.getSigners();
      var chef = this.chef.connect(minterSigner);

      await chef.add('1000', this.lp1.address, true, { from: minter });
      await chef.add('1000', this.lp2.address, true, { from: minter });
      await chef.add('1000', this.lp3.address, true, { from: minter });

      chef = this.chef.connect(aliceSigner);
      await time.advanceBlockTo(this.startBlock + 200);
      await this.lp1.approve(chef.address, '100', { from: alice });
      await chef.deposit(1, '20', { from: alice });
      await chef.deposit(1, '0', { from: alice });
      await chef.deposit(1, '40', { from: alice });
      await chef.deposit(1, '0', { from: alice });

      assert.equal((await this.lp1.balanceOf(alice)).toString(), '1940');
      await chef.withdraw(1, '10', { from: alice });
      assert.equal((await this.lp1.balanceOf(alice)).toString(), '1950');
      assert.equal((await this.plearn.balanceOf(alice)).toString(), '855');
      // assert.equal((await this.plearn.balanceOf(dev)).toString(), '100');

      chef = this.chef.connect(bobSigner);
      await this.lp1.approve(chef.address, '100', { from: bob });
      assert.equal((await this.lp1.balanceOf(bob)).toString(), '2000');
      await chef.deposit(1, '50', { from: bob });
      assert.equal((await this.lp1.balanceOf(bob)).toString(), '1950');
      await chef.deposit(1, '0', { from: bob });
      assert.equal((await this.plearn.balanceOf(bob)).toString(), '107');
      await chef.emergencyWithdraw(1, { from: bob });
      assert.equal((await this.lp1.balanceOf(bob)).toString(), '2000');
    })

    it('staking/unstaking', async () => {
      const [minterSigner, bobSigner, carolSigner, , , , aliceSigner] = await ethers.getSigners();
      var chef = this.chef.connect(minterSigner);
      await chef.add('1000', this.lp1.address, true, { from: minter });
      await chef.add('1000', this.lp2.address, true, { from: minter });
      await chef.add('1000', this.lp3.address, true, { from: minter });

      await time.advanceBlockTo(this.startBlock + 250);
      chef = this.chef.connect(aliceSigner);
      await this.lp1.approve(this.chef.address, '10', { from: alice });
      await chef.deposit(1, '2', { from: alice }); //0
      await chef.withdraw(1, '2', { from: alice }); //1

      await this.plearn.approve(this.chef.address, '214', { from: alice });
      await chef.enterStaking('200', { from: alice }); //3
      assert.equal((await this.syrup.balanceOf(alice)).toString(), '200');
      assert.equal((await this.plearn.balanceOf(alice)).toString(), '14');
      await chef.enterStaking('14', { from: alice }); //4
      assert.equal((await this.syrup.balanceOf(alice)).toString(), '214');
      assert.equal((await this.plearn.balanceOf(alice)).toString(), '214');
      await chef.leaveStaking(214);
      assert.equal((await this.syrup.balanceOf(alice)).toString(), '0');
      assert.equal((await this.plearn.balanceOf(alice)).toString(), '642');

    });


    // it('updaate multiplier', async () => {
    //   await this.chef.add('1000', this.lp1.address, true, { from: minter });
    //   await this.chef.add('1000', this.lp2.address, true, { from: minter });
    //   await this.chef.add('1000', this.lp3.address, true, { from: minter });

    //   await this.lp1.approve(this.chef.address, '100', { from: alice });
    //   await this.lp1.approve(this.chef.address, '100', { from: bob });
    //   await this.chef.deposit(1, '100', { from: alice });
    //   await this.chef.deposit(1, '100', { from: bob });
    //   await this.chef.deposit(1, '0', { from: alice });
    //   await this.chef.deposit(1, '0', { from: bob });

    //   await this.plearn.approve(this.chef.address, '100', { from: alice });
    //   await this.plearn.approve(this.chef.address, '100', { from: bob });
    //   await this.chef.enterStaking('50', { from: alice });
    //   await this.chef.enterStaking('100', { from: bob });

    //   await this.chef.updateMultiplier('0', { from: minter });

    //   await this.chef.enterStaking('0', { from: alice });
    //   await this.chef.enterStaking('0', { from: bob });
    //   await this.chef.deposit(1, '0', { from: alice });
    //   await this.chef.deposit(1, '0', { from: bob });

    //   assert.equal((await this.plearn.balanceOf(alice)).toString(), '700');
    //   assert.equal((await this.plearn.balanceOf(bob)).toString(), '150');

    //   await time.advanceBlockTo(this.startBlock + 265);

    //   await this.chef.enterStaking('0', { from: alice });
    //   await this.chef.enterStaking('0', { from: bob });
    //   await this.chef.deposit(1, '0', { from: alice });
    //   await this.chef.deposit(1, '0', { from: bob });

    //   assert.equal((await this.plearn.balanceOf(alice)).toString(), '700');
    //   assert.equal((await this.plearn.balanceOf(bob)).toString(), '150');

    //   await this.chef.leaveStaking('50', { from: alice });
    //   await this.chef.leaveStaking('100', { from: bob });
    //   await this.chef.withdraw(1, '100', { from: alice });
    //   await this.chef.withdraw(1, '100', { from: bob });

    // });

});
