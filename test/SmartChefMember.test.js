const { expectRevert, time } = require("@openzeppelin/test-helpers");
const { assert } = require("chai");
const { ethers, waffle } = require("hardhat");
const { BigNumber, utils } = ethers;
const perBlock = "100";

describe("SmartChefMember contract", function () {
  let pln;
  let chef;
  let treasury;
  let alice;
  let bob;
  let carol;
  let dev;
  let minter;

  beforeEach(async function () {
    let PlearnToken = await ethers.getContractFactory("MockBEP20");
    let SmartChefMember = await ethers.getContractFactory("SmartChefMember");
    let Treasury = await ethers.getContractFactory(
      "SmartChefFoundingInvestorTreasury"
    );
    [minter, alice, bob, carol, dev] = await ethers.getSigners();

    pln = await PlearnToken.deploy("Plearn Token", "PLN", 1000000);
    treasury = await Treasury.deploy(pln.address);
    chef = await SmartChefMember.deploy(
      pln.address,
      pln.address,
      treasury.address,
      "43000"
    );

    await chef.connect(minter).add("100");
    await chef.connect(minter).add("400");

    assert.equal((await chef.packageLength()).toString(), "2");

    await treasury.connect(minter).addAdmin(chef.address);
  });

  describe("depositToInvestor", function () {
    it("should not allow non-owner to do operation", async function () {
      await pln.connect(minter).transfer(alice.address, 10000);
      await pln.connect(alice).approve(chef.address, "2000");
      await expectRevert(
        chef.connect(alice).depositToInvestor("1000", "300", 0, alice.address),
        "Ownable: caller is not the owner"
      );
    });

    it("should not deposit more than limit amount", async () => {
      await pln.connect(minter).approve(chef.address, "100000");

      await expectRevert(
        chef.depositToInvestor("100000", "30000", 0, alice.address),
        "User amount above limit"
      );
    });
    
    it("should get 1000 staked token and 300 reward when deposit 1000 PLN and 300 PLN reward", async function () {
      await pln.connect(minter).approve(chef.address, "2000");
      await chef
        .connect(minter)
        .depositToInvestor("1000", "300", 0, alice.address);
      assert.equal((await pln.balanceOf(chef.address)).toString(), "1000");
      const [aliceStaked] = await getDepositInfo(alice.address, 0);

      assert.equal(aliceStaked.amount.toString(), "1000");
      assert.equal(aliceStaked.initialAmount.toString(), "1000");
      expect(await chef.isInvestor(alice.address)).to.be.true;
    });

    it("should get 2000 staked token and 600 reward when deposit 2000 PLN and 600 PLN reward, second deposit", async () => {
      await pln.connect(minter).approve(chef.address, "100000");

      await chef
        .connect(minter)
        .depositToInvestor("1000", "300", 0, alice.address); // 1
      await chef
        .connect(minter)
        .depositToInvestor("2000", "600", 0, alice.address); // 2

      const [staked2] = await getDepositInfo(alice.address, 1);

      assert.equal(staked2.amount.toString(), "2000");
      assert.equal(staked2.initialAmount.toString(), "2000");
    });
  });

  describe("pendingUnlockedToken", function () {
    it("should get 50 unlocked token for 1000 staked token in 5 block period", async () => {
      await pln.connect(minter).approve(chef.address, "5000");

      await chef
        .connect(minter)
        .depositToInvestor("1000", "300", 0, alice.address);

      const startUnlockBlock = await getStartUnlockBlocks(alice.address, 0);
      await mineNBlocksTo(startUnlockBlock + 5);

      assert.equal(
        (await chef.pendingStakedUnlockedToken(alice.address, 0)).toString(),
        "50"
      );
    });

    it("should get 1000 unlocked token for 1000 staked token when current block = end block", async () => {
      await pln.connect(minter).approve(chef.address, "5000");

      await chef
        .connect(minter)
        .depositToInvestor("1000", "300", 0, alice.address);

      const endUnlockBlock = await getEndUnlockBlocks(alice.address, 0);
      await mineNBlocksTo(endUnlockBlock);

      assert.equal(
        (await chef.pendingStakedUnlockedToken(alice.address, 0)).toString(),
        "1000"
      );
    });
  });

  describe("Withdraw", function () {
    it("should get 1000 PLN and 300 PLN reward when withdraw 1000 in current block = end block for 1000 staked", async () => {
      await pln.connect(minter).approve(chef.address, "5000");

      await chef
        .connect(minter)
        .depositToInvestor("1000", "300", 0, alice.address);

      const aliceEndUnlockBlock = await getEndUnlockBlocks(alice.address, 0);
      await mineNBlocksTo(aliceEndUnlockBlock);
      await chef.connect(alice).withdraw("1000", 0);

      assert.equal((await pln.balanceOf(alice.address)).toString(), "1300");
    });

    it("should get 1000 PLN and 300 PLN reward when withdraw 1000 in current block > end block for 1000 staked", async () => {
      await pln.connect(minter).approve(chef.address, "5000");

      await chef
        .connect(minter)
        .depositToInvestor("1000", "300", 0, alice.address);

      const aliceEndUnlockBlock = await getEndUnlockBlocks(alice.address, 0);
      await mineNBlocksTo(aliceEndUnlockBlock + 20);
      await chef.connect(alice).withdraw("1000", 0);

      assert.equal((await pln.balanceOf(alice.address)).toString(), "1300");
    });

    it("should get 1000 PLN and 330 PLN reward when withdraw 1000 in 10 block period for 10000 staked", async () => {
      await pln.connect(minter).approve(chef.address, "50000");
      await chef
        .connect(minter)
        .depositToInvestor("10000", "3000", 0, alice.address);

      const aliceStartUnlockBlock = await getStartUnlockBlocks(
        alice.address,
        0
      );
      await mineNBlocksTo(aliceStartUnlockBlock + 10);

      await chef.connect(alice).withdraw("1000", 0);
      assert.equal((await pln.balanceOf(alice.address)).toString(), "1330");
    });

    it("should not withdraw staked tokens more than unlocked token", async () => {
      await pln.connect(minter).approve(chef.address, "5000");
      await chef
        .connect(minter)
        .depositToInvestor("1000", "300", 0, alice.address);

      await mineNBlocks(1);

      var unlockedToken = await chef.pendingStakedUnlockedToken(
        alice.address,
        0
      );

      await expectRevert(
        chef.connect(alice).withdraw(unlockedToken + 1, 0),
        "Amount to withdraw too high"
      );
    });
  });

  describe("Harvest", function () {
    it("should get 50 reward for 1000 reward in 5 block period", async () => {
      await pln.connect(minter).approve(chef.address, "100000");

      var result = await chef
        .connect(minter)
        .depositToInvestor("10000", "1000", 0, alice.address);
      await mineNBlocks(5);
      var withdrawResult = await chef.connect(alice).withdraw(0, 0);
      var blockCount = withdrawResult.blockNumber - result.blockNumber;
      assert.equal(
        (await pln.balanceOf(alice.address)).toString(),
        blockCount * 10
      );
    });

    it("should get only reward if withdraw with amount = 0", async () => {
      await pln.connect(minter).approve(chef.address, "10000");

      await chef
        .connect(minter)
        .depositToInvestor("1000", "300", 0, alice.address);

      await mineNBlocks(5);
      await chef.connect(alice).withdraw(0, 0);

      const [staked, reward] = await getDepositInfo(alice.address, 0); // get first deposit
      assert.equal(staked.amount.toString(), "1000");
      assert.equal(reward.amount.toString(), "282");
      assert.equal((await pln.balanceOf(alice.address)).toString(), "18");
    });

    it("should get 36 reward for 600 reward in 5 block period from second deposit", async () => {
      await pln.connect(minter).approve(chef.address, "10000");

      await chef
        .connect(minter)
        .depositToInvestor("1000", "300", 0, alice.address);
      await chef
        .connect(minter)
        .depositToInvestor("2000", "600", 0, alice.address);
      const aliceStartUnlockBlock = await getStartUnlockBlocks(
        alice.address,
        1
      );
      await mineNBlocksTo(aliceStartUnlockBlock + 5);
      await chef.connect(alice).withdraw(0, 1);

      assert.equal((await pln.balanceOf(alice.address)).toString(), "36");
    });
  });

  describe("Recovery", function () {
    it("should get 1300 PLN for 1000 staked token and 300 reward", async () => {
      await pln.connect(minter).approve(chef.address, "10000");

      await chef
        .connect(minter)
        .depositToInvestor("1000", "300", 0, alice.address);
      await chef.connect(minter).adminWithdraw(alice.address, 0);
      assert.equal((await pln.balanceOf(minter.address)).toString(), "1000000");
      expect(await chef.isInvestor(alice.address)).to.be.false;
    });

    it("should get 267 PLN from reclaimable reward when withdraw 1000 PLN in 10 block period", async () => {
      await pln.connect(minter).approve(chef.address, "20000");

      await chef
        .connect(minter)
        .depositToInvestor("10000", "3000", 0, alice.address);
      const aliceStartUnlockBlock = await getStartUnlockBlocks(
        alice.address,
        0
      );
      await mineNBlocksTo(aliceStartUnlockBlock + 10);
      await chef.connect(alice).withdraw("1000", 0);
      assert.equal((await chef.reclaimableRewardAmount()).toString(), "267");
      await chef.connect(minter).withdrawReclaimableRewardAmount(bob.address);
      assert.equal((await pln.balanceOf(bob.address)).toString(), "267");
    });
  });

  async function mineNBlocks(n) {
    for (let index = 0; index < n; index++) {
      await ethers.provider.send("evm_mine");
    }
  }

  async function mineNBlocksTo(n) {
    var currentBlock = await ethers.provider.getBlockNumber();
    for (currentBlock; currentBlock < n; currentBlock++) {
      await ethers.provider.send("evm_mine");
    }
  }

  async function getStartUnlockBlocks(address, depositId) {
    const depositInfo = await chef.getDepositInfo(address, depositId);
    return Number(depositInfo.staked.startUnlockBlock);
  }

  async function getEndUnlockBlocks(address, depositId) {
    const depositInfo = await chef.getDepositInfo(address, depositId);
    return Number(depositInfo.staked.endUnlockBlock);
  }

  async function getDepositInfo(address, depositId) {
    const depositInfo = await chef.getDepositInfo(address, depositId);
    return [depositInfo.staked, depositInfo.reward, depositInfo.packageInfo];
  }
});
