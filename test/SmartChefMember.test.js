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

    it("amount is equal to the deposit", async function () {
      await pln.connect(minter).approve(chef.address, "5000");
      await chef
        .connect(minter)
        .depositToInvestor("1000", "300", 0, alice.address);
      await chef
        .connect(minter)
        .depositToInvestor("2000", "600", 0, bob.address);
      assert.equal((await pln.balanceOf(chef.address)).toString(), "3000");
      const [aliceStaked] = await getDepositInfo(alice.address, 0);
      const [bobStaked] = await getDepositInfo(bob.address, 0);

      assert.equal(aliceStaked.amount.toString(), "1000");
      assert.equal(aliceStaked.initialAmount.toString(), "1000");
      assert.equal(bobStaked.amount.toString(), "2000");
      assert.equal(bobStaked.initialAmount.toString(), "2000");
    });

    it("Limit Amount", async () => {
      await pln.connect(minter).approve(chef.address, "100000");

      await expectRevert(
        chef.depositToInvestor("100000", "30000", 0, alice.address),
        "User amount above limit"
      );
    });

    it("deposit more than 1, same pacakage", async () => {
      await pln.connect(minter).approve(chef.address, "100000");

      await chef
        .connect(minter)
        .depositToInvestor("1000", "300", 0, alice.address); // 1
      await chef
        .connect(minter)
        .depositToInvestor("2000", "600", 0, alice.address); // 2

      const [staked] = await getDepositInfo(alice.address, 0);

      assert.equal(staked.amount.toString(), "1000");
      assert.equal(staked.initialAmount.toString(), "1000");

      const [staked2] = await getDepositInfo(alice.address, 1);

      assert.equal(staked2.amount.toString(), "2000");
      assert.equal(staked2.initialAmount.toString(), "2000");
    });

    it("deposit more than 1, difference pacakage", async () => {
      await pln.connect(minter).approve(chef.address, "100000");

      await chef
        .connect(minter)
        .depositToInvestor("1000", "300", 0, alice.address); // first deposit package 1

      await chef
        .connect(minter)
        .depositToInvestor("2000", "600", 1, alice.address); // second deposit package 2

      const [staked, reward, packageInfo] = await getDepositInfo(alice.address, 0);

      assert.equal(staked.amount.toString(), "1000");
      assert.equal(staked.initialAmount.toString(), "1000");
      assert.equal(packageInfo.blockPeriod.toString(), "100");

      const [staked2, reward2, packageInfo2] = await getDepositInfo(alice.address, 1);

      assert.equal(staked2.amount.toString(), "2000");
      assert.equal(staked2.initialAmount.toString(), "2000");
      assert.equal(packageInfo2.blockPeriod.toString(), "400");
    });
  });

  describe("pendingUnlockedToken", function () {
    it("Staked Token", async () => {
      await pln.connect(minter).approve(chef.address, "5000");

      await chef
        .connect(minter)
        .depositToInvestor("1000", "300", 0, alice.address);
      await chef
        .connect(minter)
        .depositToInvestor("2000", "600", 0, bob.address);

      assert.equal((await pln.balanceOf(chef.address)).toString(), "3000");

      const startUnlockBlock = await getStartUnlockBlocks(alice.address, 0);
      const endUnlockBlock = await getEndUnlockBlocks(alice.address, 0);
      await mineNBlocksTo(startUnlockBlock + 1);

      assert.equal(
        (await chef.pendingStakedUnlockedToken(alice.address, 0)).toString(),
        "10"
      );

      await chef.connect(alice).withdraw("2", 0);

      const startUnlockBlockBob = await getStartUnlockBlocks(bob.address, 0);
      const endUnlockBlockBob = await getEndUnlockBlocks(bob.address, 0);
      await mineNBlocksTo(startUnlockBlockBob + 8);

      assert.equal(
        (await chef.pendingStakedUnlockedToken(bob.address, 0)).toString(),
        "160"
      );
      await mineNBlocksTo(endUnlockBlockBob);

      assert.equal(
        (await chef.pendingStakedUnlockedToken(bob.address, 0)).toString(),
        "2000"
      );
      await chef.connect(bob).withdraw("2000", 0);
    });
  });

  describe("Withdraw", function () {
    it("withdraw staked tokens and collect reward tokens, CurrentBlock == EndBlock", async () => {
      await pln.connect(minter).approve(chef.address, "5000");

      await chef
        .connect(minter)
        .depositToInvestor("1000", "300", 0, alice.address);
      await chef
        .connect(minter)
        .depositToInvestor("2000", "600", 0, bob.address);

      const aliceEndUnlockBlock = await getEndUnlockBlocks(alice.address, 0);
      await mineNBlocksTo(aliceEndUnlockBlock);
      await chef.connect(alice).withdraw("600", 0);

      assert.equal((await pln.balanceOf(alice.address)).toString(), "900");

      // assert.equal((await pln.balanceOf(bob.address)).toString(), "2000");
    });

    it("withdraw staked tokens and collect reward tokens from second deposit, CurrentBlock == EndBlock", async () => {
      await pln.connect(minter).approve(chef.address, "5000");

      await chef
        .connect(minter)
        .depositToInvestor("1000", "300", 0, alice.address);
      await chef
        .connect(minter)
        .depositToInvestor("2000", "600", 0, alice.address);

      const aliceEndUnlockBlock = await getEndUnlockBlocks(alice.address, 0);
      await mineNBlocksTo(aliceEndUnlockBlock);
      await chef.connect(alice).withdraw("200", 1);

      assert.equal((await pln.balanceOf(alice.address)).toString(), "800");
    });

    it("withdraw staked tokens and collect reward tokens, StartBlock < CurrentBlock < EndBlock", async () => {
      await pln.connect(minter).approve(chef.address, "50000");
      await chef
        .connect(minter)
        .depositToInvestor("10000", "3000", 0, alice.address);
      await chef
        .connect(minter)
        .depositToInvestor("20000", "6000", 0, bob.address);

      const aliceStartUnlockBlock = await getStartUnlockBlocks(
        alice.address,
        0
      );
      await mineNBlocksTo(aliceStartUnlockBlock + 10);

      await chef.connect(alice).withdraw("1000", 0);
      assert.equal((await chef.reclaimableRewardAmount()).toString(), "267");
      assert.equal((await pln.balanceOf(alice.address)).toString(), "1330");
    });

    it("should not withdraw staked tokens more than unlocked token", async () => {
      await pln.connect(minter).approve(chef.address, "5000");
      await chef
        .connect(minter)
        .depositToInvestor("1000", "300", 0, alice.address);
      await chef
        .connect(minter)
        .depositToInvestor("2000", "600", 0, bob.address);

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
    it("Harvest - collect reward tokens", async () => {
      await pln.connect(minter).approve(chef.address, "10000");

      await chef
        .connect(minter)
        .depositToInvestor("1000", "300", 0, alice.address);
      await chef
        .connect(minter)
        .depositToInvestor("2000", "600", 0, alice.address);
      await chef
        .connect(minter)
        .depositToInvestor("2000", "600", 0, bob.address);
      const aliceStartUnlockBlock = await getStartUnlockBlocks(
        alice.address,
        0
      );
      await mineNBlocksTo(aliceStartUnlockBlock + 5);
      await chef.connect(alice).harvest(0);
      await chef.connect(alice).harvest(1);
      await chef.connect(bob).harvest(0);

      assert.equal((await pln.balanceOf(alice.address)).toString(), "54");
      assert.equal((await pln.balanceOf(bob.address)).toString(), "36");
    });
  });

  describe("Recovery", function () {
    it("recover Token and deposit again", async () => {
      await pln.connect(minter).approve(chef.address, "10000");

      await chef
        .connect(minter)
        .depositToInvestor("1000", "300", 0, alice.address);
      await chef
        .connect(minter)
        .depositToInvestor("2000", "600", 0, alice.address);
      const aliceStartUnlockBlock = await getStartUnlockBlocks(
        alice.address,
        0
      );

      assert.equal((await pln.balanceOf(chef.address)).toString(), "3000");

      const [staked, reward, packageInfo] = await getDepositInfo(alice.address, 0); // get first deposit
      assert.equal(staked.amount.toString(), "1000");
      assert.equal(reward.amount.toString(), "300");
      assert.equal(packageInfo.blockPeriod.toString(), "100");
      assert.equal((await pln.balanceOf(minter.address)).toString(), "996100");

      await chef.connect(minter).recoverTokenWrongAddress(alice.address, 0); // recover token from first deposit
      assert.equal((await pln.balanceOf(minter.address)).toString(), "997100");
      expect(await chef.isInvestor(alice.address)).to.be.true;

      const [staked1, reward1, packageInfo1] = await getDepositInfo(alice.address, 0); // get first deposit
      assert.equal(staked1.amount.toString(), "0");
      assert.equal(reward1.amount.toString(), "0");
      assert.equal(packageInfo1.blockPeriod.toString(), "0");
      
      assert.equal((await pln.balanceOf(chef.address)).toString(), "2000");
      assert.equal((await chef.reclaimableRewardAmount()).toString(), "300");

      await expectRevert(
        chef.connect(alice).withdrawReclaimableRewardAmount(),
        "Ownable: caller is not the owner"
      );
      await chef.connect(minter).withdrawReclaimableRewardAmount();

      assert.equal((await chef.reclaimableRewardAmount()).toString(), "0");
      assert.equal((await pln.balanceOf(minter.address)).toString(), "997400");

      await expectRevert(
        chef
        .connect(minter)
        .depositToInvestorAfterRecoverWrongToken("1000", "300", 1, alice.address, 1),
        "Cannot deposit"
      );

      await chef
        .connect(minter)
        .depositToInvestorAfterRecoverWrongToken("1000", "300", 1, alice.address, 0);
        assert.equal((await pln.balanceOf(chef.address)).toString(), "3000");

        const [staked2, reward2, packageInfo2] = await getDepositInfo(alice.address, 0); // get first deposit
      assert.equal(staked2.amount.toString(), "1000");
      assert.equal(reward2.amount.toString(), "300");
      assert.equal(packageInfo2.blockPeriod.toString(), "400");
      assert.equal((await pln.balanceOf(minter.address)).toString(), "996100");

      await chef.connect(minter).recoverTokenWrongAddress(alice.address, 0); // recover token from first deposit
      await chef.connect(minter).recoverTokenWrongAddress(alice.address, 1); // recover token from second deposit
      expect(await chef.isInvestor(alice.address)).to.be.false;
      assert.equal((await pln.balanceOf(minter.address)).toString(), "999100");
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
