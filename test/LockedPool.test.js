const { expectRevert, time } = require("@openzeppelin/test-helpers");
const { assert } = require("chai");
const { ethers } = require("hardhat");
const PlearnToken = artifacts.require("PlearnToken");
const { BigNumber, utils } = ethers;
const perBlock = "100";

describe("PlearnLockedPool contract", function () {
  let pln;
  let earn;
  let lp1;
  let lp2;
  let lp3;
  let lockedToken;
  let masterChef;
  let lockedPool;
  let rewardTreasury;
  let pendingWithdrawal;
  let alice;
  let bob;
  let carol;
  let dev;
  let ref;
  let safu;
  let minter;
  let startBlock;
  let lockedPoolStartBlock;
  let lockedPoolEndBlock;

  beforeEach(async function () {
    let SimpleBEP20 = await ethers.getContractFactory("SimpleBEP20");
    let PlearnEarn = await ethers.getContractFactory("PlearnEarn");
    let MasterChef = await ethers.getContractFactory("MasterChef");
    let RewardTreasury = await ethers.getContractFactory("RewardTreasury");
    let PendingWithdrawal = await ethers.getContractFactory("PendingWithdrawal");
    let PlearnLockedPool = await ethers.getContractFactory("PlearnLockedPool");

    [minter, alice, bob, carol, dev, ref, safu] = await ethers.getSigners();
    startBlock = await ethers.provider.getBlockNumber();

    this.plearnToken = await PlearnToken.new({ from: minter.address });
    pln = this.plearnToken;
    earn = await PlearnEarn.deploy(pln.address);
    lp1 = await SimpleBEP20.deploy("LPToken", "LP1", minter.address, "1000000");
    lp2 = await SimpleBEP20.deploy("LPToken", "LP1", minter.address, "1000000");
    lp3 = await SimpleBEP20.deploy("LPToken", "LP1", minter.address, "1000000");
    lockedToken = await SimpleBEP20.deploy("Locked Pool Token", "LPT", minter.address, 1);
    masterChef = await upgrades.deployProxy(MasterChef, [
      pln.address,
      earn.address,
      dev.address,
      ref.address,
      safu.address,
      "100", // Plearn per block
      startBlock, // Start block
      "1000000", // Staking Percent
      "0", // Dev Percent
      "0", // Ref Percent
      "0", // Safu Percent
    ]);

    await masterChef.add("1000", lp1.address, true);
    await masterChef.add("1000", lp2.address, true);
    await masterChef.add("1000", lp3.address, true);
    await masterChef.add("1000", lockedToken.address, true);

    // Locked Pool
    rewardTreasury = await RewardTreasury.deploy(
      pln.address,
      masterChef.address,
      "4", // masterchef pool id
      lockedToken.address
    );
    pendingWithdrawal = await PendingWithdrawal.deploy(pln.address, 86400 * 21);

    lockedPoolStartBlock = startBlock + 30;
    lockedPoolEndBlock = lockedPoolStartBlock + 100;
    lockedPool = await PlearnLockedPool.deploy(
      pln.address, // staked token
      pln.address, // reward token
      rewardTreasury.address,
      pendingWithdrawal.address,
      "20", // token per block
      lockedPoolStartBlock,
      lockedPoolEndBlock,
      "4000" // limit
    );

    await rewardTreasury.connect(minter).addAdmin(lockedPool.address);

    await pln.addMinter(masterChef.address);
    await pln.addMinter(minter.address);
    await earn.transferOwnership(masterChef.address);

    await lockedToken.approve(rewardTreasury.address, "1");
    await rewardTreasury.depositToMasterChef("1");
    await pln.approve(lockedPool.address, "10000", { from: alice.address });
  });

  describe("deposit", function () {
    it("should not deposit more than limit amount", async () => {
      await pln.mint(alice.address, "10000");
      await expectRevert(
        lockedPool.connect(alice).deposit("100000"),
        "User amount above limit"
      );
    });

    it("should get 1000 staked token when deposit 1000 PLN", async function () {
      await pln.mint(alice.address, "10000");
      await lockedPool.connect(alice).deposit("1000");
      assert.equal(
        (await pln.balanceOf(lockedPool.address)).toString(),
        "1000"
      );
      let [amountAlice] = await lockedPool.userInfo(alice.address);
      assert.equal(amountAlice.toString(), "1000");
    });

    it("should get 2000 staked token when first deposit 1000 PLN and second deposit 1000 PLN", async function () {
      await pln.mint(alice.address, "10000");
      await lockedPool.connect(alice).deposit("1000");
      await lockedPool.connect(alice).deposit("1000");
      assert.equal(
        (await pln.balanceOf(lockedPool.address)).toString(),
        "2000"
      );
      let [amountAlice] = await lockedPool.userInfo(alice.address);
      assert.equal(amountAlice.toString(), "2000");
    });

    it("should get only reward if deposit with amount = 0", async () => {
      await pln.mint(alice.address, "1000");
      await lockedPool.connect(alice).deposit("1000");
      await mineNBlocksTo(lockedPoolStartBlock + 5);
      await lockedPool.connect(alice).deposit("0");

      assert.equal((await pln.balanceOf(alice.address)).toString(), "120");
    });

    it("should get 1000 staked token and 10000 reward when deposit 1000 PLN and current block = end block", async () => {
      await pln.mint(alice.address, "1000");
      await lockedPool.connect(alice).deposit("1000");
      await mineNBlocksTo(lockedPoolEndBlock + 200);
      await lockedPool.connect(alice).deposit("0");

      assert.equal((await pln.balanceOf(alice.address)).toString(), "2000");
    });
  });

  describe("Withdraw", function () {
    it("should get 120 PLN reward and 1000 PLN in pending withdrawal when withdraw 1000 in 5 block period for 1000 staked", async () => {
      await pln.mint(alice.address, "1000");
      await lockedPool.connect(alice).deposit("1000");
      await mineNBlocksTo(lockedPoolStartBlock + 5);
      await lockedPool.connect(alice).withdraw("1000");

      assert.equal((await pln.balanceOf(alice.address)).toString(), "120");
      const [,, locked,] = await pendingWithdrawal.lockedBalances(alice.address);
      assert.equal(locked.toString(), "1000");
    });
  });

  describe("updateRewardPerBlock", function () {
    it("should get 170 PLN reward when Harvest in 10 block period for 1000 staked and reward per block update in currentBlock = 5", async () => {
      await pln.mint(alice.address, "1000");
      await lockedPool.connect(alice).deposit("1000");
      await mineNBlocksTo(lockedPoolStartBlock + 5);
      await lockedPool.connect(minter).updateRewardPerBlock("10");
      const pendingReward = await lockedPool.connect(alice).pendingReward(alice.address);
      await mineNBlocksTo(lockedPoolStartBlock + 10);
      await lockedPool.connect(alice).deposit(0);

      assert.equal((await pln.balanceOf(alice.address)).toString(), "170");
    });
  });

  describe("EmergencyWithdraw", function () {
    it("should get 0 PLN reward and 1000 PLN in pending withdrawal when withdraw 1000 in 5 block period for 1000 staked", async () => {
      await pln.mint(alice.address, "1000");
      await lockedPool.connect(alice).deposit("1000");
      await mineNBlocksTo(lockedPoolStartBlock + 5);
      await lockedPool.connect(alice).emergencyWithdraw();

      assert.equal((await pln.balanceOf(alice.address)).toString(), "0");
      const [,, locked,] = await pendingWithdrawal.lockedBalances(alice.address);
      assert.equal(locked.toString(), "1000");
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

  async function increaseTime(second) {
    await ethers.provider.send("evm_increaseTime", [second]);
    await ethers.provider.send("evm_mine");
  }

  async function setNextBlockTimestamp(time) {
    await ethers.provider.send("evm_setNextBlockTimestamp", [time]);
    await ethers.provider.send("evm_mine");
  }
});
