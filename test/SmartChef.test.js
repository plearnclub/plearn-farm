const { expectRevert, time } = require('@openzeppelin/test-helpers');
const { assert } = require('chai');
const PLNToken = artifacts.require('PlearnToken')
const SmartChef = artifacts.require('SmartChef');
const MockBEP20 = artifacts.require('libraries/MockBEP20');

const perBlock = '100';

contract('SmartChef', ([alice, bob, carol, dev, minter]) => {
    beforeEach(async () => {
        this.pln  = await PLNToken.new({ from: minter });
        await this.pln.addMinter(minter, { from: minter });
        this.rewardToken = await MockBEP20.new('Reward Token', 'RW1', '1000000', { from: minter });

        var latestBlock = await ethers.provider.getBlockNumber();
        this.startBlock = latestBlock + 200;
        var endBlock = this.startBlock + 800;

        this.chef = await SmartChef.new(this.pln.address, this.rewardToken.address, perBlock, this.startBlock, endBlock, '43000', { from: minter });
        
        await this.pln.mint(alice, '1000', { from: minter });
        await this.pln.mint(bob, '1000', { from: minter });
        await this.rewardToken.transfer(this.chef.address, '1000', { from: minter });
        console.log('balance chef for reward token: ', (await this.rewardToken.balanceOf(this.chef.address)).toString());
    });
    it('real case', async () => {

        

        await this.pln.approve(this.chef.address, '1000', { from: alice });
        await this.pln.approve(this.chef.address, '1000', { from: bob });
        await this.chef.deposit('1', { from: alice });
        await this.chef.deposit('1', { from: bob });

        let alisePLNBalance = await this.pln.balanceOf(alice);
        console.log('alise pln balance: ', alisePLNBalance.toString());
        console.log('balance pln for chef: ', (await this.pln.balanceOf(this.chef.address)).toString());
        let bobPLNBalance = await this.pln.balanceOf(bob);
        console.log('bob pln balance: ', bobPLNBalance.toString());
        console.log('balance pln for chef: ', (await this.pln.balanceOf(this.chef.address)).toString());

        await time.advanceBlockTo(this.startBlock + 1);
       
        await this.chef.withdraw('1', { from: alice });
        await this.chef.withdraw('1', { from: bob });
        console.log('-----');
        alisePLNBalance = await this.pln.balanceOf(alice);
        bobPLNBalance = await this.pln.balanceOf(bob);
        console.log('alise pln balance: ', alisePLNBalance.toString());
        console.log('balance pln for chef: ', (await this.pln.balanceOf(this.chef.address)).toString());
        console.log('balance reward token for alice: ', (await this.rewardToken.balanceOf(alice)).toString());
        console.log('bob pln balance: ', bobPLNBalance.toString());
        console.log('balance pln for chef: ', (await this.pln.balanceOf(this.chef.address)).toString());
        console.log('balance reward token for bob: ', (await this.rewardToken.balanceOf(bob)).toString());

    })

    it('setLimitAmount', async () => {
        await this.pln.mint(alice, '100000', { from: minter });
        // set limit to 1e-12 BNB
        await expectRevert(
            this.chef.deposit('100000', { from: alice }),
          'User amount above limit'
        );
      });

});
