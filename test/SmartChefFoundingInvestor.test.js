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

      this.chef = await SMFFoundingInvestor.new(
        this.pln.address,
        this.pln.address,
        this.treasury.address,
        perBlock,
        this.startBlock,
        this.endBlock,
        this.startBlock, // unlock start
        this.endBlock, // unlock end
        "43000",
        { from: minter }
      );

      await this.treasury.addAdmin(this.chef.address, { from: minter });

      await this.pln.mint(minter, "10000", { from: minter });

      // transfer reward
      await this.pln.mint(this.treasury.address, "10000", { from: minter });
    });

    it("depositToInvestor - should not allow non-owner to do operation", async () => {
      await this.pln.mint(alice, "10000", { from: minter });
      await this.pln.approve(this.chef.address, "2000", { from: alice });
      await expectRevert(
        this.chef.depositToInvestor("800", alice, { from: alice }),
        "Ownable: caller is not the owner"
      );
    });

    it("depositToInvestor - amount is equal to the deposit", async () => {
      await this.pln.approve(this.chef.address, "2000", { from: minter });

      await this.chef.depositToInvestor("800", alice, { from: minter });
      await this.chef.depositToInvestor("200", bob, { from: minter });
      assert.equal(
        (await this.pln.balanceOf(this.chef.address)).toString(),
        "1000"
      );

      var [initialAmountAlice, amountAlice] = await this.chef.userInfo(alice, {
        from: minter,
      });
      const [initialAmountBob, amountBob] = await this.chef.userInfo(bob, {
        from: minter,
      });

      assert.equal(amountAlice.toString(), "800");
      assert.equal(initialAmountAlice.toString(), "800");
      assert.equal(amountBob.toString(), "200");
      assert.equal(initialAmountBob.toString(), "200");

      await this.chef.depositToInvestor("200", alice, { from: minter });

      var [initialAmountAlice, amountAlice] = await this.chef.userInfo(alice, {
        from: minter,
      });
      assert.equal(amountAlice.toString(), "1000");
      assert.equal(initialAmountAlice.toString(), "1000");
    });

    it("depositToInvestor - Limit Amount", async () => {
      await this.pln.mint(minter, "100000", { from: minter });
      await this.pln.approve(this.chef.address, "100000", { from: minter });

      await expectRevert(
        this.chef.depositToInvestor("100000", alice, { from: minter }),
        "User amount above limit"
      );
    });

    it("deposit - collect reward tokens", async () => {
      await this.pln.approve(this.chef.address, "2000", { from: minter });
      await this.chef.depositToInvestor("800", alice, { from: minter });
      await this.chef.depositToInvestor("200", bob, { from: minter });

      await time.advanceBlockTo(this.startBlock);

      await this.chef.deposit("0", { from: alice });
      await this.chef.deposit("0", { from: bob });

      assert.equal((await this.pln.balanceOf(alice)).toString(), "80");

      assert.equal((await this.pln.balanceOf(bob)).toString(), "40");
    });

    it("withdraw - withdraw staked tokens and collect reward tokens", async () => {
      await this.pln.approve(this.chef.address, "2000", { from: minter });
      await this.chef.depositToInvestor("800", alice, { from: minter });
      await this.chef.depositToInvestor("200", bob, { from: minter });

      await time.advanceBlockTo(this.startBlock + 1);

      await time.advanceBlockTo(this.endBlock);

      await this.chef.withdraw("600", { from: alice });
      await this.chef.deposit("0", { from: bob });

      assert.equal((await this.pln.balanceOf(alice)).toString(), "8600");

      assert.equal((await this.pln.balanceOf(bob)).toString(), "2000");
    });

    it("withdraw - should not withdraw staked tokens more than unlocked token", async () => {
      await this.pln.approve(this.chef.address, "2000", { from: minter });
      await this.chef.depositToInvestor("800", alice, { from: minter });
      await this.chef.depositToInvestor("200", bob, { from: minter });

      await time.advanceBlockTo(this.startBlock + 1);

      var unlockedToken = await this.chef.pendingUnlockedToken(alice);

      await expectRevert(
        this.chef.withdraw(unlockedToken + 1, { from: alice }),
        "Amount to withdraw too high"
      );
    });

    it("recoverTokenWrongAddress - recover Token ", async () => {
      await this.pln.approve(this.chef.address, "2000", { from: minter });

      await this.chef.depositToInvestor("100", alice, { from: minter });
      await this.chef.depositToInvestor("200", bob, { from: minter });
      assert.equal(
        (await this.pln.balanceOf(this.chef.address)).toString(),
        "300"
      );

      await this.chef.recoverTokenWrongAddress(bob, { from: minter });
      assert.equal(
        (await this.pln.balanceOf(this.chef.address)).toString(),
        "100"
      );
    });

    it("pendingUnlockedToken", async () => {
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
      assert.equal((await this.chef.pendingUnlockedToken(bob)).toString(), "6");

      await time.advanceBlockTo(this.endBlock);

      assert.equal(
        (await this.chef.pendingUnlockedToken(alice)).toString(),
        "100"
      );
      await this.chef.withdraw("100", { from: alice });
    });
  }
);
