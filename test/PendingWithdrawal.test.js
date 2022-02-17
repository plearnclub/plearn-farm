const { expectRevert, time } = require("@openzeppelin/test-helpers");
const { assert } = require("chai");
const { ethers } = require("hardhat");
const PlearnToken = artifacts.require("PlearnToken");
const { BigNumber, utils } = ethers;
const perBlock = "100";

describe("PendingWithdrawal contract", function () {
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

  beforeEach(async function () {
    let SimpleBEP20 = await ethers.getContractFactory("SimpleBEP20");
    let PlearnEarn = await ethers.getContractFactory("PlearnEarn");
    let MasterChef = await ethers.getContractFactory("MasterChef");
    let RewardTreasury = await ethers.getContractFactory("RewardTreasury");
    let PendingWithdrawal = await ethers.getContractFactory("PendingWithdrawal");
    let LockedPool = await ethers.getContractFactory("LockedPool");

    [minter, alice, bob, carol, dev, ref, safu] = await ethers.getSigners();
    startBlock = await ethers.provider.getBlockNumber();

    this.plearnToken = await PlearnToken.new({ from: minter.address });
    pln = this.plearnToken;
    earn = await PlearnEarn.deploy(pln.address);
    lp1 = await SimpleBEP20.deploy("LPToken", "LP1", "1000000");
    lp2 = await SimpleBEP20.deploy("LPToken", "LP1", "1000000");
    lp3 = await SimpleBEP20.deploy("LPToken", "LP1", "1000000");
    lockedToken = await SimpleBEP20.deploy("Locked Pool Token", "LPT", 1);
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

    lockedPoolStartBlock = startBlock + 20;
    lockedPool = await LockedPool.deploy(
      pln.address, // staked token
      pln.address, // reward token
      rewardTreasury.address,
      pendingWithdrawal.address,
      "20", // token per block
      lockedPoolStartBlock,
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

  describe("withdrawExpiredLocks", function () {
    it("should not withdraw because current time less than unlock time", async () => {
      await pln.mint(alice.address, "1000");
      await lockedPool.connect(alice).deposit("1000");
      await lockedPool.connect(alice).withdraw("1000");

      const [,, locked,] = await pendingWithdrawal.lockedBalances(alice.address);
      assert.equal(locked.toString(), "1000");
      await increaseTime(1014400);
      
      const [total, unlockable,,] = await pendingWithdrawal.lockedBalances(alice.address);
      assert.equal(unlockable.toString(), "0");
      assert.equal(total.toString(), "1000");
    });

    it("should get 1000 PLN when unlock time has passed", async () => {
      await pln.mint(alice.address, "1000");
      await lockedPool.connect(alice).deposit("1000");
      await lockedPool.connect(alice).withdraw("1000");

      const [,, locked,] = await pendingWithdrawal.lockedBalances(alice.address);
      assert.equal(locked.toString(), "1000");
      await increaseTime(1814400);
      const [, unlockable,,] = await pendingWithdrawal.lockedBalances(alice.address);
      assert.equal(unlockable.toString(), "1000");
      await pendingWithdrawal.connect(alice).withdrawExpiredLocks();
      const [total,,,] = await pendingWithdrawal.lockedBalances(alice.address);
      assert.equal(total.toString(), "0");
    });

    it("should get 2000 PLN from 2 withdraw when unlock time has passed", async () => {
      await pln.mint(alice.address, "2000");
      await lockedPool.connect(alice).deposit("2000");
      await lockedPool.connect(alice).withdraw("1000");

      await increaseTime(1014400);
      await lockedPool.connect(alice).withdraw("1000");

      const [,, locked,] = await pendingWithdrawal.lockedBalances(alice.address);
      assert.equal(locked.toString(), "2000");
      await increaseTime(1814400);
      
      const [, unlockable,,] = await pendingWithdrawal.lockedBalances(alice.address);
      assert.equal(unlockable.toString(), "2000");
      await pendingWithdrawal.connect(alice).withdrawExpiredLocks();
      const [total,,,] = await pendingWithdrawal.lockedBalances(alice.address);
      assert.equal(total.toString(), "0");
      
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

