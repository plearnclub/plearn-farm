const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PlearnRankPool contract", function () {
  let PlearnToken, plearnToken;
  let PlearnCoin, plearnCoin;
  let PlearnRewardTreasury, plearnRewardTreasury;
  let PlearnRankPool, plearnRankPool;
  let owner, user1, user2;

  let startBlock;
  let lockedPoolStartBlock;
  let lockedPoolEndBlock;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    startBlock = await ethers.provider.getBlockNumber();
    lockedPoolStartBlock = startBlock + 30;
    lockedPoolEndBlock = lockedPoolStartBlock + 100;

    PlearnToken = await ethers.getContractFactory("MockBEP20");
    // Mint tokens for testing
    plearnToken = await PlearnToken.deploy(
      "PLN",
      "PLN",
      ethers.utils.parseEther("5000000")
    );
    await plearnToken.deployed();

    PlearnCoin = await ethers.getContractFactory("PlearnCoin");
    plearnCoin = await PlearnCoin.deploy();
    await plearnCoin.deployed();

    PlearnRewardTreasury = await ethers.getContractFactory(
      "PlearnRewardTreasury"
    );
    plearnRewardTreasury = await PlearnRewardTreasury.deploy(
      plearnToken.address
    );
    await plearnRewardTreasury.deployed();

    PlearnRankPool = await ethers.getContractFactory("PlearnRankPool");
    plearnRankPool = await PlearnRankPool.deploy(
      plearnToken.address,
      plearnToken.address,
      plearnCoin.address,
      plearnRewardTreasury.address,
      86400 * 30,
      lockedPoolStartBlock,
      lockedPoolEndBlock,
      1
    );
    await plearnRankPool.deployed();

    const minimumAmounts = [
      toBigNumber(1000),
      toBigNumber(50000),
      toBigNumber(200000),
      toBigNumber(500000),
      toBigNumber(1500000),
    ];
    const maximumAmounts = [
      toBigNumber(50000),
      toBigNumber(200000),
      toBigNumber(500000),
      toBigNumber(1500000),
      toBigNumber(2000000),
    ];

    const plnRewardPerBlockPerPLNs = [
      2853881279, 4756468798, 7610350076, 9512937595, 14269406393,
    ];
    const plncRewardPerBlockPerPLNs = [
      2853881279, 4756468798, 7610350076, 9512937595, 14269406393,
    ];

    await plearnRankPool.addMultipleTiers(
      minimumAmounts,
      maximumAmounts,
      plnRewardPerBlockPerPLNs,
      plncRewardPerBlockPerPLNs
    );

    // Set up additional initial state as needed
    await plearnToken.transfer(
      plearnRewardTreasury.address,
      toBigNumber(1500000)
    );
    await plearnCoin.addMinter(plearnRankPool.address);
    await plearnRewardTreasury.addAdmin(plearnRankPool.address);
  });

  describe("Deposit", function () {
    it("should get 1000 staked token when deposit 1000 PLN", async function () {
      const depositAmount = toBigNumber("1000");
      await plearnToken.transfer(user1.address, depositAmount);
      await plearnToken
        .connect(user1)
        .approve(plearnRankPool.address, depositAmount);

      expect(await plearnToken.balanceOf(user1.address)).to.equal(
        depositAmount
      );

      await expect(plearnRankPool.connect(user1).deposit(depositAmount))
        .to.emit(plearnRankPool, "Deposit")
        .withArgs(user1.address, depositAmount);
      let userInfo = await plearnRankPool.userInfo(user1.address);

      assert.equal(toFormatEther(userInfo.amount), 1000);
    });

    it("should allow deposit and correctly calculate rewards", async function () {
      const depositAmount = toBigNumber("1000");
      const secondDepositAmount = toBigNumber("2000000");
      const thirdDepositAmount = toBigNumber("500");
      const approveDepositAmount = toBigNumber("2001500");
      await plearnToken.transfer(user1.address, approveDepositAmount);
      await plearnToken
        .connect(user1)
        .approve(plearnRankPool.address, approveDepositAmount);

      await plearnRankPool.connect(user1).deposit(depositAmount);

      await mineNBlocksTo(lockedPoolStartBlock + 1);

      expect(await plearnToken.balanceOf(user1.address)).to.equal(
        toBigNumber("2000500")
      );

      await plearnRankPool.connect(user1).deposit(secondDepositAmount);

      const plnBalanceAfterDeposit = (
        await plearnToken.balanceOf(user1.address)
      ).toString();
      assert.equal(toFormatEther(plnBalanceAfterDeposit), 500.000005707762558);

      await plearnRankPool.connect(user1).deposit(thirdDepositAmount);

      const AfterDeposit = (
        await plearnToken.balanceOf(user1.address)
      ).toString();

      assert.equal(toFormatEther(AfterDeposit), 0.028544520548558);
    });
  });

  describe("Harvest", function () {
    it("should get reward 0.000005707762558 PLN and 0.000005707762558 PLNC when staked 1000 PLN and harvest", async function () {
      const depositAmount = toBigNumber("1000");

      await plearnToken.transfer(user1.address, depositAmount);

      await plearnToken
        .connect(user1)
        .approve(plearnRankPool.address, depositAmount);

      await plearnRankPool.connect(user1).deposit(depositAmount);

      await mineNBlocksTo(lockedPoolStartBlock + 1);
      //   await plearnRankPool.updateTier(0, 1000, 50000, 0, 0);
      await expect(plearnRankPool.connect(user1).harvest())
        .to.emit(plearnRankPool, "Harvest")
        .withArgs(user1.address);

      const plnBalanceAfterWithdraw = (
        await plearnToken.balanceOf(user1.address)
      ).toString();

      const plncBalanceAfterWithdraw = (
        await plearnCoin.balanceOf(user1.address)
      ).toString();
      assert.equal(toFormatEther(plnBalanceAfterWithdraw), 0.000005707762558);
      assert.equal(toFormatEther(plncBalanceAfterWithdraw), 0.000005707762558);
    });
  });

  describe("Withdraw", function () {
    it("should allow users to withdraw PlearnToken", async function () {
      const depositAmount = toBigNumber("1000");
      const withdrawAmount = toBigNumber("1000");
      const lockDuration = 86400 * 30; // 30 days

      await plearnToken.transfer(user1.address, depositAmount);

      await plearnToken
        .connect(user1)
        .approve(plearnRankPool.address, depositAmount);

      await plearnRankPool.connect(user1).deposit(depositAmount);

      await increaseTime(lockDuration);
      await mineNBlocksTo(lockedPoolStartBlock);

      await expect(plearnRankPool.connect(user1).withdraw(withdrawAmount))
        .to.emit(plearnRankPool, "Withdraw")
        .withArgs(user1.address, withdrawAmount);

      const plnBalanceAfterWithdraw = (
        await plearnToken.balanceOf(user1.address)
      ).toString();

      const plncBalanceAfterWithdraw = (
        await plearnCoin.balanceOf(user1.address)
      ).toString();

      assert.equal(
        toFormatEther(plnBalanceAfterWithdraw),
        1000.000002853881279
      );
      assert.equal(toFormatEther(plncBalanceAfterWithdraw), 0.000002853881279);
    });

    it("should calculate rewards based on the maximum tier amount, even for deposits exceeding that amount", async function () {
      const depositAmount = toBigNumber("3000000");
      const withdrawAmount = toBigNumber("1000");
      const lockDuration = 86400 * 30; // 30 days

      await plearnToken.transfer(user1.address, depositAmount);

      await plearnToken
        .connect(user1)
        .approve(plearnRankPool.address, depositAmount);

      await plearnRankPool.connect(user1).deposit(depositAmount);

      await increaseTime(lockDuration);
      await mineNBlocksTo(lockedPoolStartBlock);

      await expect(plearnRankPool.connect(user1).withdraw(withdrawAmount))
        .to.emit(plearnRankPool, "Withdraw")
        .withArgs(user1.address, withdrawAmount);

      const plnBalanceAfterWithdraw = (
        await plearnToken.balanceOf(user1.address)
      ).toString();

      const plncBalanceAfterWithdraw = (
        await plearnCoin.balanceOf(user1.address)
      ).toString();

      assert.equal(toFormatEther(plnBalanceAfterWithdraw), 1000.028538812786);
      assert.equal(toFormatEther(plncBalanceAfterWithdraw), 0.028538812786);
    });

    it("should not allow users to withdraw PlearnToken during lock period", async function () {
      const depositAmount = 1000;
      const withdrawAmount = 500;

      await plearnToken.transfer(user1.address, depositAmount);

      await plearnToken
        .connect(user1)
        .approve(plearnRankPool.address, depositAmount);

      await plearnRankPool.connect(user1).deposit(depositAmount);

      await expect(
        plearnRankPool.connect(user1).withdraw(withdrawAmount)
      ).to.be.revertedWith("Cannot withdraw yet");

      const balanceAfterAttemptedWithdraw = Number(
        await plearnToken.balanceOf(user1.address)
      );
      expect(balanceAfterAttemptedWithdraw).to.equal(0);
    });
  });

  describe("Add Tier", function () {
    it("should allow owner to add a new tier", async function () {
      const newTierMinimumAmount = toBigNumber("2500000");
      const newTierMaximumAmount = toBigNumber("3000000");
      const newPlnRewardPerBlockPerPLN = 15384615384;
      const newPlncRewardPerBlockPerPLN = 15384615384;

      await expect(
        plearnRankPool
          .connect(owner)
          .addTier(
            newTierMinimumAmount,
            newTierMaximumAmount,
            newPlnRewardPerBlockPerPLN,
            newPlncRewardPerBlockPerPLN
          )
      ).to.not.be.reverted;
    });
  });

  describe("Update Tier", function () {
    it("should allow owner to update a tier", async function () {
      const tierId = 0; // Assuming tierId 0 exists
      const updatedTierMinimumAmount = toBigNumber("2500");
      const updatedTierMaximumAmount = toBigNumber("5000");
      const updatedPlnRewardPerBlockPerPLN = 10000000000;
      const updatedPlncRewardPerBlockPerPLN = 10000000000;

      await expect(
        plearnRankPool
          .connect(owner)
          .updateTier(
            tierId,
            updatedTierMinimumAmount,
            updatedTierMaximumAmount,
            updatedPlnRewardPerBlockPerPLN,
            updatedPlncRewardPerBlockPerPLN
          )
      ).to.not.be.reverted;
    });
  });

  describe("Calculate Rewards", function () {
    it("should calculate correct rewards based on tier and staked amount", async function () {
      const depositAmount = toBigNumber("150000");
      await plearnToken.transfer(user1.address, depositAmount);
      await plearnToken
        .connect(user1)
        .approve(plearnRankPool.address, depositAmount);
      await plearnRankPool.connect(user1).deposit(depositAmount);

      // Simulate some block mining
      await mineNBlocksTo(lockedPoolStartBlock + 9);

      // Fetch pending rewards
      const pendingPlnReward = await plearnRankPool.pendingPLNReward(
        user1.address
      );
      const pendingPlncReward = await plearnRankPool.pendingPLNCReward(
        user1.address
      );

      // Assert correct reward calculation
      expect(pendingPlnReward).to.be.gt(0);
      expect(pendingPlncReward).to.be.gt(0);
    });
  });

  describe("Stop Reward", function () {
    it("should allow owner to stop rewards", async function () {
      await expect(plearnRankPool.connect(owner).stopReward()).to.not.be
        .reverted;
      const currentBlock = await ethers.provider.getBlockNumber();
      expect(await plearnRankPool.endBlock()).to.equal(currentBlock);
    });
  });

  describe("Update User Limit Per Pool", function () {
    it("should allow owner to update user limit per pool", async function () {
      const newUserLimit = 600; // assuming initial limit was 500
      await expect(
        plearnRankPool.connect(owner).updateUserLimitPerPool(newUserLimit)
      )
        .to.emit(plearnRankPool, "NewUserLimit")
        .withArgs(newUserLimit);

      expect(await plearnRankPool.userLimitPerPool()).to.equal(newUserLimit);
    });

    it("should not allow non-owner to update user limit per pool", async function () {
      const newUserLimit = 600;
      await expect(
        plearnRankPool.connect(user1).updateUserLimitPerPool(newUserLimit)
      ).to.be.reverted;
    });

    it("should not allow deposit if user count exceeds user limit per pool", async function () {
      const depositAmount = toBigNumber("1000");

      let userInfo = await plearnRankPool.userInfo(user1.address);
      expect(userInfo.amount).to.equal(0);

      await plearnToken.transfer(user1.address, depositAmount);
      await plearnToken.transfer(user2.address, depositAmount);
      await plearnToken
        .connect(user1)
        .approve(plearnRankPool.address, depositAmount);
      await plearnToken
        .connect(user2)
        .approve(plearnRankPool.address, depositAmount);

      await plearnRankPool.connect(user1).deposit(depositAmount);

      await expect(
        plearnRankPool.connect(user2).deposit(depositAmount)
      ).to.be.revertedWith("User amount above limit");

      expect(await plearnToken.balanceOf(user2.address)).to.equal(
        depositAmount
      );
    });
  });

  describe("Update End Blocks", function () {
    it("should allow owner to update end blocks", async function () {
      const newEndBlock = lockedPoolEndBlock + 100; // assuming we are increasing end block
      await expect(plearnRankPool.connect(owner).updateEndBlocks(newEndBlock))
        .to.emit(plearnRankPool, "NewEndBlocks")
        .withArgs(newEndBlock);

      expect(await plearnRankPool.endBlock()).to.equal(newEndBlock);
    });

    it("should not allow non-owner to update end blocks", async function () {
      const newEndBlock = lockedPoolEndBlock + 100;
      await expect(plearnRankPool.connect(user1).updateEndBlocks(newEndBlock))
        .to.be.reverted;
    });

    it("should not allow updating end blocks to a past block", async function () {
      const pastEndBlock = startBlock - 10; // assuming this is a past block
      await expect(
        plearnRankPool.connect(owner).updateEndBlocks(pastEndBlock)
      ).to.be.revertedWith("New endBlock must be higher than startBlock");
    });
  });

  // Helper functions for time and block manipulation
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

  function toBigNumber(value, decimals = 18) {
    return ethers.utils.parseUnits(value.toString(), decimals);
  }

  function toFormatEther(value, decimals = 18) {
    return ethers.utils.formatEther(value.toString());
  }
});
