const { expectRevert, time } = require("@openzeppelin/test-helpers");
const { assert } = require("chai");
const PLNToken = artifacts.require("PlearnToken");
const SMFFoundingInvestor = artifacts.require("SmartChefFoundingInvestor");
const Treasury = artifacts.require("SmartChefFoundingInvestorTreasury");
const MockBEP20 = artifacts.require("libraries/MockBEP20");
const { BigNumber, utils } = ethers;
const perBlock = "100";

contract(
  "SmartChefFoundingInvestor",
  async ([alice, bob, carol, dev, minter]) => {
    beforeEach(async () => {
      this.pln = await PLNToken.new({ from: minter });
      await this.pln.addMinter(minter, { from: minter });
      this.treasury = await Treasury.new(this.pln.address, { from: minter });

      var latestBlock = await ethers.provider.getBlockNumber();
      this.startBlock = latestBlock + 100;
      this.endBlock = this.startBlock + 100;
      console.log("startBlock: ", this.startBlock);
      console.log("endBlock: ", this.endBlock);

      this.chef = await SMFFoundingInvestor.new(
        this.pln.address,
        this.pln.address,
        this.treasury.address,
        perBlock,
        this.startBlock,
        this.endBlock,
        0,
        { from: minter }
      );

      await this.treasury.addAdmin(this.chef.address, { from: minter });

      await this.pln.mint(minter, "10000", { from: minter });

      // transfer reward
      await this.pln.mint(this.treasury.address, "10000", { from: minter });
      console.log(
        "balance treasury for reward token: ",
        (await this.pln.balanceOf(this.treasury.address)).toString()
      );
    });

    it("deposit to investor/withdraw", async () => {
      await this.pln.approve(this.chef.address, "2000", { from: minter });

      await this.chef.depositToInvestor("800", alice, { from: minter });
      await this.chef.depositToInvestor("200", bob, { from: minter });
      assert.equal(
        (await this.pln.balanceOf(this.chef.address)).toString(),
        "1000"
      );

      assert.equal((await this.chef.pendingReward(alice)).toString(), "0");
      assert.equal((await this.chef.pendingReward(bob)).toString(), "0");
      assert.equal(
        (await this.chef.pendingUnlockedToken(alice)).toString(),
        "0"
      );
      assert.equal((await this.chef.pendingUnlockedToken(bob)).toString(), "0");

      await time.advanceBlockTo(this.startBlock + 1);

      assert.equal((await this.chef.pendingReward(alice)).toString(), "80");
      assert.equal((await this.chef.pendingReward(bob)).toString(), "20");

      var expected = await this.chef.pendingUnlockedToken(alice);
      var num = BigNumber.from(expected.toString());

      assert.equal(
        (await this.chef.pendingUnlockedToken(alice)).toString(),
        "8"
      );
      assert.equal((await this.chef.pendingUnlockedToken(bob)).toString(), "2");

      await this.chef.withdraw(5, { from: alice });
      assert.equal((await this.pln.balanceOf(alice)).toString(), "165");
    });

    it("emergencyWithdraw", async () => {
      await this.pln.approve(this.chef.address, "2000", { from: minter });

      await this.chef.depositToInvestor("100", alice, { from: minter });
      await this.chef.depositToInvestor("200", bob, { from: minter });
      assert.equal(
        (await this.pln.balanceOf(this.chef.address)).toString(),
        "300"
      );

      await this.chef.emergencyWithdraw(bob, { from: minter });
      assert.equal(
        (await this.pln.balanceOf(this.chef.address)).toString(),
        "100"
      );
    });

    it("unlocked token", async () => {
      await this.pln.approve(this.chef.address, "2000", { from: minter });
      await this.pln.approve(this.chef.address, "2000", { from: alice });
      await this.pln.approve(this.chef.address, "2000", { from: bob });

      await this.chef.depositToInvestor("100", alice, { from: minter });
      await this.chef.depositToInvestor("200", bob, { from: minter });
      assert.equal(
        (await this.pln.balanceOf(this.chef.address)).toString(),
        "300"
      );

      await time.advanceBlockTo(this.startBlock + 1);

      assert.equal(
        (await this.chef.pendingUnlockedToken(alice)).toString(),
        "1"
      );
      await this.chef.withdraw("2", { from: alice });
      await this.chef.depositToInvestor("2", alice, { from: minter });
      assert.equal(
        (await this.chef.pendingUnlockedToken(alice)).toString(),
        "3"
      );
      console.log("Block number", await ethers.provider.getBlockNumber());
      assert.equal((await this.chef.pendingUnlockedToken(bob)).toString(), "6");

      await time.advanceBlockTo(this.endBlock);

      assert.equal(
        (await this.chef.pendingUnlockedToken(alice)).toString(),
        "100"
      );

      console.log(
        "pending Reward token: ",
        (await this.chef.pendingReward(alice)).toString()
      );
      await this.chef.withdraw("100", { from: alice });
      console.log(
        "balance pln for alice: ",
        (await this.pln.balanceOf(alice)).toString()
      );
    });
  }
);
