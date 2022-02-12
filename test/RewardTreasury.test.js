const { expectRevert, time } = require("@openzeppelin/test-helpers");
const { assert } = require("chai");
const { ethers } = require("hardhat");
const PlearnToken = artifacts.require("PlearnToken");
const { BigNumber, utils } = ethers;
const perBlock = "100";

describe("RewardTreasury contract", function () {
  let pln;
  let earn;
  let lp1;
  let lp2;
  let lp3;
  let lockedToken;
  let masterChef;
  let rewardTreasury;
  let alice;
  let bob;
  let carol;
  let dev;
  let ref;
  let safu;
  let minter;
  let startBlock;

  beforeEach(async function () {
    let SimpleBEP20 = await ethers.getContractFactory("SimpleBEP20");
    let PlearnEarn = await ethers.getContractFactory("PlearnEarn");
    let MasterChef = await ethers.getContractFactory("MasterChef");
    let RewardTreasury = await ethers.getContractFactory("RewardTreasury");

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

    rewardTreasury = await RewardTreasury.deploy(
      pln.address,
      masterChef.address,
      "4", // masterchef pool id
      lockedToken.address
    );

    await pln.addMinter(masterChef.address);
    await pln.addMinter(minter.address);
    await earn.transferOwnership(masterChef.address);

  });

  describe("depositToMasterChef", function () {
    it("should get 1 staked token when rewardTreasury contract deposit 1 LPT", async function () {
        await lockedToken.approve(rewardTreasury.address, "1");
        await rewardTreasury.depositToMasterChef("1");
        assert.equal((await lockedToken.balanceOf(masterChef.address)).toString(), "1");
        const [amount] = await masterChef.connect(minter).userInfo(4, rewardTreasury.address);
        assert.equal(amount.toString(), "1");
    });
  });

  describe("withdrawFromMasterChef", function () {
    it("should owner get 1 LPT and rewardTreasury get 100 PLN reward when withdraw 1 LPT in 5 block period", async function () {
        await lockedToken.approve(rewardTreasury.address, "1");
        let currentBlock = await ethers.provider.getBlockNumber();
        await rewardTreasury.depositToMasterChef("1");
        await mineNBlocksTo(currentBlock + 5);
        await rewardTreasury.withdrawFromMasterChef("1");
        assert.equal((await lockedToken.balanceOf(masterChef.address)).toString(), "0");
        assert.equal((await pln.balanceOf(rewardTreasury.address)).toString(), "100");
        assert.equal((await lockedToken.balanceOf(minter.address)).toString(), "1");
    });
  });

  describe("Recovery", function () {
    it("should get 100 PLN when recover 100 PLN", async () => {
    await pln.mint(rewardTreasury.address, "100");
    await rewardTreasury.recoverWrongTokens(pln.address, "100");
      assert.equal((await pln.balanceOf(minter.address)).toString(), "100");
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

});
