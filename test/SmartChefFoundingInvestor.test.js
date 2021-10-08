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
      var endBlock = this.startBlock + 100;
      console.log("startBlock: ", this.startBlock);
      console.log("endBlock: ", endBlock);

      this.chef = await SMFFoundingInvestor.new(
        this.pln.address,
        this.pln.address,
        this.treasury.address,
        perBlock,
        this.startBlock,
        endBlock,
        { from: minter }
      );

      await this.treasury.addAdmin(this.chef.address, { from: minter });

      await this.pln.mint(minter, "10000", { from: minter });

      // transfer reward
      await this.pln.transfer(this.treasury.address, "1000", { from: minter });
      console.log(
        "balance treasury for reward token: ",
        (await this.pln.balanceOf(this.treasury.address)).toString()
      );
    });

    it("deposit to investor/withdraw", async () => {
      await this.pln.approve(this.chef.address, "2000", { from: minter });
      await expectRevert(
        this.chef.depositToInvestor("100", alice, { from: minter }),
        "Investor: wut?"
      );

      await this.chef.addInvestor(alice, { from: minter });
      await this.chef.addInvestor(bob, { from: minter });

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

      await this.chef.addInvestor(alice, { from: minter });
      await this.chef.addInvestor(bob, { from: minter });
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
  }
);
