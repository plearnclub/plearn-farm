const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PlearnMemberPool contract", function () {
  let PlearnToken, plearnToken;
  let PhillCoin, phillCoin;
  let PlearnRewardTreasury, plearnRewardTreasury;
  let PlearnMemberPool, plearnMemberPool;
  let owner, user1, user2;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    PlearnToken = await ethers.getContractFactory("MockBEP20");
    // Mint tokens for testing
    plearnToken = await PlearnToken.deploy(
      "PLN",
      "PLN",
      ethers.utils.parseEther("5000000")
    );
    await plearnToken.deployed();

    PhillCoin = await ethers.getContractFactory("PhillCoin");
    phillCoin = await PhillCoin.deploy(owner.address, owner.address);
    await phillCoin.deployed();

    PlearnRewardTreasury = await ethers.getContractFactory(
      "PlearnRewardTreasury"
    );
    plearnRewardTreasury = await PlearnRewardTreasury.deploy(
      plearnToken.address
    );
    await plearnRewardTreasury.deployed();

    PlearnMemberPool = await ethers.getContractFactory("PlearnMemberPool");
    plearnMemberPool = await PlearnMemberPool.deploy(
      plearnToken.address,
      plearnToken.address,
      phillCoin.address, // _pccRewardToken
      plearnRewardTreasury.address, // _rewardTreasury
      21185, // _endDay
      21185, // _depositEndDay
      10000, // _unlockDayPercentBase
      10000 // _pccUnlockDayPercentBase
    );
    await plearnMemberPool.deployed();

    // add tier
    await plearnMemberPool.addTier({
      // Silver
      lockDayPercent: 10000, // 0.001% per day
      pccLockDayPercent: 10000,
      lockPeriod: 30,
      maxAmount: toBigNumber(9999),
      minAmount: toBigNumber(1000),
      totalDeposited: 0,
    });
    await plearnMemberPool.addTier({
      // Gold
      lockDayPercent: 100000, // 0.01% per day
      pccLockDayPercent: 100000,
      lockPeriod: 90,
      maxAmount: toBigNumber(49999),
      minAmount: toBigNumber(10000),
      totalDeposited: 0,
    });
    await plearnMemberPool.addTier({
      // Platinum
      lockDayPercent: 1000000, // 0.1% per day
      pccLockDayPercent: 1000000,
      lockPeriod: 180,
      maxAmount: toBigNumber(99999),
      minAmount: toBigNumber(50000),
      totalDeposited: 0,
    });
    await plearnMemberPool.addTier({
      // Diamond
      lockDayPercent: 10000000, // 01% per day
      pccLockDayPercent: 10000000,
      lockPeriod: 360,
      maxAmount: toBigNumber(700000000),
      minAmount: toBigNumber(100000),
      totalDeposited: 0,
    });

    // Set up additional initial state as needed
    await plearnToken.transfer(
      plearnRewardTreasury.address,
      toBigNumber(1500000)
    );

    await phillCoin.grantRole(
      "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6",
      plearnMemberPool.address
    );
    await plearnRewardTreasury.addAdmin(plearnMemberPool.address);

    // console.log("getCurrentDay", await plearnMemberPool.getCurrentDay());
  });

  describe("Deposit", function () {
    it("should get 1000 staked token when deposit 1000 PLN", async function () {
      const depositAmount = toBigNumber("1000");
      const tier = 0;
      await plearnToken.transfer(user1.address, depositAmount);
      await plearnToken
        .connect(user1)
        .approve(plearnMemberPool.address, depositAmount);

      await expect(plearnMemberPool.connect(user1).deposit(tier, depositAmount))
        .to.emit(plearnMemberPool, "Deposit")
        .withArgs(user1.address, tier, depositAmount);
      let userInfo = await plearnMemberPool.userInfo(user1.address);

      assert.equal(toFormatEther(userInfo.amount), 1000);
    });

    it("should allow deposit within tier limits", async function () {
      const depositAmount = toBigNumber("20000");
      const tierIndex = 1;

      await plearnToken.transfer(user1.address, depositAmount);
      await plearnToken
        .connect(user1)
        .approve(plearnMemberPool.address, depositAmount);

      await expect(
        plearnMemberPool.connect(user1).deposit(tierIndex, depositAmount)
      )
        .to.emit(plearnMemberPool, "Deposit")
        .withArgs(user1.address, tierIndex, depositAmount);

      const userInfo = await plearnMemberPool.userInfo(user1.address);
      expect(userInfo.amount).to.equal(depositAmount);
      expect(userInfo.tierIndex).to.equal(tierIndex);
    });

    it("should reject deposit when depositEndDay < current day", async function () {
      const newEndDay = 0;
      await plearnMemberPool.connect(owner).setDepositEndDay(newEndDay);
      const depositAmount = toBigNumber("10000");
      const tierIndex = 1;

      await plearnToken.transfer(user1.address, depositAmount);
      await plearnToken
        .connect(user1)
        .approve(plearnMemberPool.address, depositAmount);

      await expect(
        plearnMemberPool.connect(user1).deposit(tierIndex, depositAmount)
      ).to.be.revertedWith("Deposit is disabled");
    });

    it("should reject deposit below tier minimum", async function () {
      const depositAmount = toBigNumber("500");
      const tierIndex = 1;

      await plearnToken.transfer(user1.address, depositAmount);
      await plearnToken
        .connect(user1)
        .approve(plearnMemberPool.address, depositAmount);

      await expect(
        plearnMemberPool.connect(user1).deposit(tierIndex, depositAmount)
      ).to.be.revertedWith("Need more amount");
    });

    it("should reject deposit above tier maximum", async function () {
      const depositAmount = toBigNumber("60000");
      const tierIndex = 1;

      await plearnToken.transfer(user1.address, depositAmount);
      await plearnToken
        .connect(user1)
        .approve(plearnMemberPool.address, depositAmount);

      await expect(
        plearnMemberPool.connect(user1).deposit(tierIndex, depositAmount)
      ).to.be.revertedWith("Amount over tier limits");
    });
  });

  describe("Withdraw", function () {
    beforeEach(async function () {
      const depositAmount = toBigNumber("50000");
      const tierIndex = 2;
      await plearnToken.transfer(user1.address, depositAmount);
      await plearnToken
        .connect(user1)
        .approve(plearnMemberPool.address, depositAmount);
      await plearnMemberPool.connect(user1).deposit(tierIndex, depositAmount);
    });

    it("should allow user to withdraw after lock period", async function () {
      const withdrawAmount = toBigNumber("5000");
      const tierIndex = 2;
      const tier = await plearnMemberPool.tiers(tierIndex);

      await increaseTime(tier.lockPeriod * 86400); // 180 days

      await expect(plearnMemberPool.connect(user1).withdraw(withdrawAmount))
        .to.emit(plearnMemberPool, "Withdraw")
        .withArgs(user1.address, withdrawAmount);

      expect(await plearnToken.balanceOf(user1.address)).to.be.closeTo(
        toBigNumber("14000"),
        toBigNumber("0.01")
      );

      expect(await phillCoin.balanceOf(user1.address)).to.be.closeTo(
        toBigNumber("9000"),
        toBigNumber("0.01")
      );

      const userInfo = await plearnMemberPool.userInfo(user1.address);
      expect(userInfo.amount).to.equal(toBigNumber("45000"));
    });

    it("should reject withdraw if amount exceeds balance", async function () {
      const withdrawAmount = toBigNumber("150000");
      await expect(
        plearnMemberPool.connect(user1).withdraw(withdrawAmount)
      ).to.be.revertedWith("Amount to withdraw too high");
    });

    it("should reject withdraw if before lock period ends", async function () {
      const withdrawAmount = toBigNumber("5000");
      await expect(
        plearnMemberPool.connect(user1).withdraw(withdrawAmount)
      ).to.be.revertedWith("Cannot withdraw yet");
    });

    it("Tier Downgrade on Withdrawal Below Current Tier Minimum", async function () {
      const withdrawAmount = toBigNumber("40000");
      const tierIndex = 2;
      const tier = await plearnMemberPool.tiers(tierIndex);

      await increaseTime(tier.lockPeriod * 86400); // 180 days

      await expect(plearnMemberPool.connect(user1).withdraw(withdrawAmount))
        .to.emit(plearnMemberPool, "Withdraw")
        .withArgs(user1.address, withdrawAmount);

      const userInfo = await plearnMemberPool.userInfo(user1.address);
      expect(userInfo.amount).to.equal(toBigNumber("10000"));
      expect(userInfo.tierIndex).to.equal(1);
    });

    it("should allow user to withdraw the entire locked amount after end day update", async function () {
      const _currentDay = await plearnMemberPool.getCurrentDay();
      const newEndDay = _currentDay + 20;
      await plearnMemberPool.connect(owner).setEndDay(newEndDay);
      const daysToPass = 20; // 20 days
      await increaseTime(86400 * daysToPass);
      const WithdrawAmount = toBigNumber("50000");
      await expect(plearnMemberPool.connect(user1).withdraw(WithdrawAmount))
        .to.emit(plearnMemberPool, "Withdraw")
        .withArgs(user1.address, WithdrawAmount);

      const userInfo = await plearnMemberPool.userInfo(user1.address);
      expect(userInfo.amount).to.equal(toBigNumber("0"));

      const userBalance = await plearnToken.balanceOf(user1.address);
      expect(userBalance).to.equal(toBigNumber("51000"));

      expect(await phillCoin.balanceOf(user1.address)).to.be.closeTo(
        toBigNumber("1000"),
        toBigNumber("0.01")
      );
    });
  });

  describe("Harvest", function () {
    beforeEach(async function () {
      const depositAmount = toBigNumber("1000");
      const tierIndex = 0;
      await plearnToken.transfer(user1.address, depositAmount);
      await plearnToken
        .connect(user1)
        .approve(plearnMemberPool.address, depositAmount);
      await plearnMemberPool.connect(user1).deposit(tierIndex, depositAmount);
    });

    it("should allow user to harvest rewards", async function () {
      const daysToPass = 30;
      await increaseTime(86400 * daysToPass);

      const userBalanceBefore = await plearnToken.balanceOf(user1.address);

      await expect(plearnMemberPool.connect(user1).harvest())
        .to.emit(plearnMemberPool, "Harvest")
        .withArgs(user1.address, toBigNumber("0.3"), toBigNumber("0.3"));

      const userBalanceAfter = await plearnToken.balanceOf(user1.address);
      expect(userBalanceAfter).to.be.above(userBalanceBefore);
      expect(await phillCoin.balanceOf(user1.address)).to.be.above(0);
    });

    it("should allow user to harvest rewards after unlock period + 10 days", async function () {
      const tier = await plearnMemberPool.tiers(0);
      const unlockTime = tier.lockPeriod * 86400 + 10 * 86400;
      await increaseTime(unlockTime);

      const userBalanceBefore = await plearnToken.balanceOf(user1.address);

      await expect(plearnMemberPool.connect(user1).harvest())
        .to.emit(plearnMemberPool, "Harvest")
        .withArgs(user1.address, toBigNumber("0.4"), toBigNumber("0.4"));

      const userBalanceAfter = await plearnToken.balanceOf(user1.address);
      expect(userBalanceAfter).to.be.above(userBalanceBefore);
    });

    it("should allow user to harvest rewards before unlock period ends", async function () {
      const daysToPass = 15;
      await increaseTime(86400 * daysToPass);

      const userInfoBefore = await plearnMemberPool.userInfo(user1.address);
      const userBalanceBefore = await plearnToken.balanceOf(user1.address);

      await expect(plearnMemberPool.connect(user1).harvest())
        .to.emit(plearnMemberPool, "Harvest")
        .withArgs(user1.address, toBigNumber("0.15"), toBigNumber("0.15"));

      const userBalanceAfter = await plearnToken.balanceOf(user1.address);
      expect(userBalanceAfter).to.be.above(userBalanceBefore);
    });

    it("should allow user to harvest rewards after lock 1 day", async function () {
      const daysToPass = 1;
      await increaseTime(86400 * daysToPass);

      const userBalanceBefore = await plearnToken.balanceOf(user1.address);

      await expect(plearnMemberPool.connect(user1).harvest())
        .to.emit(plearnMemberPool, "Harvest")
        .withArgs(user1.address, toBigNumber("0.01"), toBigNumber("0.01"));

      const userBalanceAfter = await plearnToken.balanceOf(user1.address);
      expect(userBalanceAfter).to.be.above(userBalanceBefore);
    });
  });

  describe("Reward Calculation", function () {
    let initialEndDay;
    const tierIndex = 1;
    const depositAmount = toBigNumber("10000");
    const additionalDeposit = toBigNumber("40000");
    beforeEach(async function () {
      initialEndDay = await plearnMemberPool.endDay();

      await plearnToken.transfer(user1.address, depositAmount);
      await plearnToken.transfer(user1.address, additionalDeposit);
      await plearnToken
        .connect(user1)
        .approve(plearnMemberPool.address, depositAmount);
      await plearnMemberPool.connect(user1).deposit(tierIndex, depositAmount);
    });

    it("should correctly calculate rewards after the lock period ends", async function () {
      const tier = await plearnMemberPool.tiers(tierIndex);
      await increaseTime(tier.lockPeriod * 86400); // 90 days

      const [, , accruedInterest, pccAccruedInterest] =
        await plearnMemberPool.getUserInfo(user1.address);

      expect(accruedInterest).to.equal(toBigNumber("90"));
      expect(pccAccruedInterest).to.equal(toBigNumber("90"));
    });

    it("should correctly calculate interest after the lock period ends and unlock after 7 days", async function () {
      const tier = await plearnMemberPool.tiers(tierIndex);
      await increaseTime(tier.lockPeriod * 86400); // 90 days
      await plearnMemberPool.connect(user1).harvest();
      await increaseTime(7 * 86400); // 7 days

      const [userInfo, currentDay, accruedInterest, pccAccruedInterest] =
        await plearnMemberPool.getUserInfo(user1.address);
      expect(accruedInterest).to.be.closeTo(
        toBigNumber("0.7"),
        toBigNumber("0.01")
      );
      expect(pccAccruedInterest).to.be.closeTo(
        toBigNumber("0.7"),
        toBigNumber("0.01")
      );
    });

    it("should correctly calculate rewards after end day change", async function () {
      const _currentDay = await plearnMemberPool.getCurrentDay();
      const newEndDay = _currentDay + 20;
      await plearnMemberPool.connect(owner).setEndDay(newEndDay);

      const daysToPass = 30;
      await increaseTime(86400 * daysToPass);

      const [, , accruedInterest, pccAccruedInterest] =
        await plearnMemberPool.getUserInfo(user1.address);

      expect(accruedInterest).to.be.closeTo(
        toBigNumber("20"),
        toBigNumber("0.01")
      );
      expect(pccAccruedInterest).to.be.closeTo(
        toBigNumber("20"),
        toBigNumber("0.01")
      );
    });

    it("should calculate rewards correctly after user upgrade tier", async function () {
      const newTierIndex = 2;
      await plearnToken
        .connect(user1)
        .approve(plearnMemberPool.address, additionalDeposit);
      const daysToPass = 10;
      await increaseTime(86400 * daysToPass);
      await plearnMemberPool
        .connect(user1)
        .deposit(newTierIndex, additionalDeposit);

      expect(await plearnToken.balanceOf(user1.address)).to.be.closeTo(
        toBigNumber("10"),
        toBigNumber("0.01")
      );

      expect(await phillCoin.balanceOf(user1.address)).to.be.closeTo(
        toBigNumber("10"),
        toBigNumber("0.01")
      );

      await increaseTime(86400 * 20);

      const expectedReward = toBigNumber("1000");

      const [, , accruedInterest, pccAccruedInterest] =
        await plearnMemberPool.getUserInfo(user1.address);

      expect(accruedInterest).to.be.closeTo(
        expectedReward,
        toBigNumber("0.01")
      );
      expect(pccAccruedInterest).to.be.closeTo(
        expectedReward,
        toBigNumber("0.01")
      );
    });

    it("should correctly calculate rewards after Tier Downgrade on Withdrawal Below Current Tier Minimum", async function () {
      const withdrawAmount = toBigNumber("9000");
      const tier = await plearnMemberPool.tiers(tierIndex);

      await increaseTime(tier.lockPeriod * 86400); // 90 days

      await expect(plearnMemberPool.connect(user1).withdraw(withdrawAmount))
        .to.emit(plearnMemberPool, "Withdraw")
        .withArgs(user1.address, withdrawAmount);

      const userInfo = await plearnMemberPool.userInfo(user1.address);
      expect(userInfo.amount).to.equal(toBigNumber("1000"));
      expect(userInfo.tierIndex).to.equal(0);

      await increaseTime(10 * 86400); // 10 days

      const [, , accruedInterest, pccAccruedInterest] =
        await plearnMemberPool.getUserInfo(user1.address);

      expect(accruedInterest).to.be.closeTo(
        toBigNumber("0.1"),
        toBigNumber("0.01")
      );

      expect(pccAccruedInterest).to.be.closeTo(
        toBigNumber("0.1"),
        toBigNumber("0.01")
      );
    });

    it("should correctly calculate rewards after tier is set", async function () {
      const updatedTier = {
        lockDayPercent: 1000000,
        pccLockDayPercent: 0,
        lockPeriod: 30,
        maxAmount: toBigNumber(20000),
        minAmount: toBigNumber(5000),
        totalDeposited: 0,
      };
      await increaseTime(10 * 86400); // 10 days 10 PLN, 10 PCC
      await plearnMemberPool.setTier(tierIndex, updatedTier);
      const tier = await plearnMemberPool.tiers(tierIndex);
      await increaseTime(81 * 86400); // 20 days
      const [, , accruedInterest, pccAccruedInterest] =
        await plearnMemberPool.getUserInfo(user1.address);

      expect(accruedInterest).to.be.closeTo(
        toBigNumber("90.1"),
        toBigNumber("0")
      );

      expect(pccAccruedInterest).to.be.closeTo(
        toBigNumber("90.1"),
        toBigNumber("0")
      );
    });

    it("should correctly calculate rewards after tier set and additional deposit", async function () {
      const updatedTier = {
        lockDayPercent: 1000000,
        pccLockDayPercent: 1000000,
        lockPeriod: 60,
        maxAmount: toBigNumber(50000),
        minAmount: toBigNumber(5000),
        totalDeposited: 0,
      };

      await plearnMemberPool.setTier(tierIndex, updatedTier);

      await plearnToken
        .connect(user1)
        .approve(plearnMemberPool.address, additionalDeposit);
      await plearnMemberPool
        .connect(user1)
        .deposit(tierIndex, additionalDeposit);

      await increaseTime(30 * 86400); // 30 days

      const [, , accruedInterest, pccAccruedInterest] =
        await plearnMemberPool.getUserInfo(user1.address);

      expect(accruedInterest).to.equal(toBigNumber("1500"));
      expect(pccAccruedInterest).to.equal(toBigNumber("1500"));
    });

    it("should correctly calculate rewards after tier set and additional deposit", async function () {
      const updatedTier = {
        lockDayPercent: 1000000,
        pccLockDayPercent: 1000000,
        lockPeriod: 60,
        maxAmount: toBigNumber(50000),
        minAmount: toBigNumber(5000),
        totalDeposited: 0,
      };

      await plearnMemberPool.setTier(tierIndex, updatedTier);

      await plearnToken
        .connect(user1)
        .approve(plearnMemberPool.address, additionalDeposit);
      await plearnMemberPool
        .connect(user1)
        .deposit(tierIndex, additionalDeposit);

      await increaseTime(30 * 86400); // 30 days

      const [, , accruedInterest, pccAccruedInterest] =
        await plearnMemberPool.getUserInfo(user1.address);

      expect(accruedInterest).to.equal(toBigNumber("1500"));
      expect(pccAccruedInterest).to.equal(toBigNumber("1500"));
    });
  });

  describe("Tier Management", function () {
    it("should allow owner to add a new tier", async function () {
      const newTier = {
        lockDayPercent: 20000,
        pccLockDayPercent: 0,
        lockPeriod: 60,
        maxAmount: toBigNumber(50000),
        minAmount: toBigNumber(10000),
        totalDeposited: 0,
      };

      await expect(plearnMemberPool.connect(owner).addTier(newTier))
        .to.emit(plearnMemberPool, "TierAdded")
        .withArgs(newTier.lockPeriod, await plearnMemberPool.tierLength());

      const addedTier = await plearnMemberPool.tiers(
        (await plearnMemberPool.tierLength()) - 1
      );
      expect(addedTier.lockDayPercent).to.equal(newTier.lockDayPercent);
      expect(addedTier.pccLockDayPercent).to.equal(0);
      expect(addedTier.lockPeriod).to.equal(newTier.lockPeriod);
      expect(addedTier.maxAmount).to.equal(newTier.maxAmount);
      expect(addedTier.minAmount).to.equal(newTier.minAmount);
    });

    it("should allow owner to set an existing tier", async function () {
      const tierIndex = 0;
      const updatedTier = {
        lockDayPercent: 15000,
        pccLockDayPercent: 0,
        lockPeriod: 30,
        maxAmount: toBigNumber(20000),
        minAmount: toBigNumber(5000),
        totalDeposited: 0,
      };

      await expect(
        plearnMemberPool.connect(owner).setTier(tierIndex, updatedTier)
      )
        .to.emit(plearnMemberPool, "TierUpdated")
        .withArgs(tierIndex);

      const setTier = await plearnMemberPool.tiers(tierIndex);
      expect(setTier.lockDayPercent).to.equal(updatedTier.lockDayPercent);
      expect(setTier.pccLockDayPercent).to.equal(0);
      expect(setTier.lockPeriod).to.equal(updatedTier.lockPeriod);
      expect(setTier.maxAmount).to.equal(updatedTier.maxAmount);
      expect(setTier.minAmount).to.equal(updatedTier.minAmount);
    });

    it("should correctly update tier when tier is set", async function () {
      const tierIndex = 0;
      const depositAmount = toBigNumber("1000");
      await plearnToken.transfer(user1.address, depositAmount);
      await plearnToken
        .connect(user1)
        .approve(plearnMemberPool.address, depositAmount);
      await plearnMemberPool.connect(user1).deposit(tierIndex, depositAmount);
      const updatedTier = {
        lockDayPercent: 100000,
        pccLockDayPercent: 0,
        lockPeriod: 30,
        maxAmount: toBigNumber(20000),
        minAmount: toBigNumber(5000),
        totalDeposited: 0,
      };
      const currentTier = await plearnMemberPool.tiers(tierIndex);
      await plearnMemberPool.setTier(tierIndex, updatedTier);
      const userInfo = await plearnMemberPool.userInfo(user1.address);
      const userTier = await userInfo.tier;
      await plearnMemberPool.setTier(tierIndex, updatedTier);
      const tier = await plearnMemberPool.tiers(tierIndex);

      expect(tier.lockDayPercent).to.equal(updatedTier.lockDayPercent);
      expect(tier.pccLockDayPercent).to.equal(updatedTier.pccLockDayPercent);
      expect(tier.lockPeriod).to.equal(updatedTier.lockPeriod);
      expect(tier.maxAmount).to.equal(updatedTier.maxAmount);
      expect(tier.minAmount).to.equal(updatedTier.minAmount);

      // User tier
      expect(currentTier.lockDayPercent).to.equal(userTier.lockDayPercent);
      expect(currentTier.pccLockDayPercent).to.equal(
        userTier.pccLockDayPercent
      );
      expect(currentTier.lockPeriod).to.equal(userTier.lockPeriod);
      expect(currentTier.maxAmount).to.equal(userTier.maxAmount);
      expect(currentTier.minAmount).to.equal(userTier.minAmount);
    });
  });

  describe("Tier Upgrade", function () {
    const initialDeposit = toBigNumber("1000");
    const additionalDeposit = toBigNumber("9000");
    beforeEach(async function () {
      const initialTierIndex = 0;

      await plearnToken.transfer(user1.address, initialDeposit);
      await plearnToken
        .connect(user1)
        .approve(plearnMemberPool.address, initialDeposit + additionalDeposit);
      await plearnMemberPool
        .connect(user1)
        .deposit(initialTierIndex, initialDeposit);
    });

    it("Verify Lock Period Extension on Tier Upgrade", async function () {
      const newTierIndex = 1;
      await plearnToken.transfer(user1.address, additionalDeposit);

      const daysToPass = 10;
      await increaseTime(86400 * daysToPass); // 10 days
      await plearnMemberPool
        .connect(user1)
        .deposit(newTierIndex, additionalDeposit);

      await increaseTime(86400 * 79);
      const withdrawAmount = toBigNumber("500");
      await expect(
        plearnMemberPool.connect(user1).withdraw(withdrawAmount)
      ).to.be.revertedWith("Cannot withdraw yet");
    });

    it("should allow user to upgrade tier", async function () {
      const newTierIndex = 1;
      await plearnToken.transfer(user1.address, additionalDeposit);

      await plearnMemberPool
        .connect(user1)
        .deposit(newTierIndex, additionalDeposit);

      const [info, , ,] = await plearnMemberPool.getUserInfo(user1.address);

      expect(info.tierIndex).to.equal(newTierIndex);
      expect(info.amount).to.equal(initialDeposit.add(additionalDeposit));
    });
  });

  describe("Lock Extension", function () {
    let initialDeposit, tierIndex;

    beforeEach(async function () {
      initialDeposit = toBigNumber("10000");
      tierIndex = 1;

      await plearnToken.transfer(user1.address, initialDeposit);
      await plearnToken
        .connect(user1)
        .approve(plearnMemberPool.address, initialDeposit);
      await plearnMemberPool.connect(user1).deposit(tierIndex, initialDeposit);

      const tier = await plearnMemberPool.tiers(tierIndex);
      await increaseTime(tier.lockPeriod * 86400); // 90 days
    });

    it("should extend lock period with zero deposit", async function () {
      const newDeposit = toBigNumber("0");
      const tier = await plearnMemberPool.tiers(tierIndex);
      const userInfoBefore = await plearnMemberPool.userInfo(user1.address);
      const depositStartDayBefore = userInfoBefore.depositStartDay;
      await expect(
        plearnMemberPool.connect(user1).deposit(tierIndex, newDeposit)
      )
        .to.emit(plearnMemberPool, "Deposit")
        .withArgs(user1.address, tierIndex, newDeposit);

      const userInfo = await plearnMemberPool.userInfo(user1.address);
      expect(userInfo.depositStartDay).to.be.above(depositStartDayBefore);

      expect(userInfo.amount).to.equal(initialDeposit);
    });
  });

  describe("Contract Settings", function () {
    it("should allow owner to set the end day", async function () {
      const newEndDay = 21500;

      await expect(plearnMemberPool.connect(owner).setEndDay(newEndDay))
        .to.emit(plearnMemberPool, "endDayUpdated")
        .withArgs(newEndDay);

      expect(await plearnMemberPool.endDay()).to.equal(newEndDay);
    });

    it("should reject setting end day to a past date", async function () {
      const currentDay = await plearnMemberPool.getCurrentDay();

      await expect(
        plearnMemberPool.connect(owner).setEndDay(currentDay - 200)
      ).to.be.revertedWith("End day earlier than current day");
    });

    it("should allow owner to set the deposit end day", async function () {
      const newEndDay = 21500;
      await expect(plearnMemberPool.connect(owner).setDepositEndDay(newEndDay))
        .to.emit(plearnMemberPool, "depositEndDayUpdated")
        .withArgs(newEndDay);

      expect(await plearnMemberPool.depositEndDay()).to.equal(newEndDay);
    });

    it("should allow owner to set unlock day percent base", async function () {
      await plearnMemberPool.connect(owner).setDepositEndDay(0);
      const unlockDayPercentBase = 100000;
      const pccUnlockDayPercentBase = 100000;

      await expect(
        plearnMemberPool
          .connect(owner)
          .setUnlockDayPercentBase(
            unlockDayPercentBase,
            pccUnlockDayPercentBase
          )
      )
        .to.emit(plearnMemberPool, "UnlockDayPercentBaseUpdated")
        .withArgs(unlockDayPercentBase, pccUnlockDayPercentBase);

      expect(await plearnMemberPool.unlockDayPercentBase()).to.equal(
        unlockDayPercentBase
      );
      expect(await plearnMemberPool.pccUnlockDayPercentBase()).to.equal(
        pccUnlockDayPercentBase
      );
    });

    it("should reject owner to set unlock day percent base when tokens are already staked and Deposit is enabled", async function () {
      const currentDay = await plearnMemberPool.getCurrentDay();
      const unlockDayPercentBase = 100000;
      const pccUnlockDayPercentBase = 100000;

      await expect(
        plearnMemberPool
          .connect(owner)
          .setUnlockDayPercentBase(
            unlockDayPercentBase,
            pccUnlockDayPercentBase
          )
      ).to.be.revertedWith("Deposit is enabled");

      await plearnMemberPool.connect(owner).setDepositEndDay(currentDay + 200);

      const depositAmount = toBigNumber("10000");
      tierIndex = 1;

      await plearnToken.transfer(user1.address, depositAmount);
      await plearnToken
        .connect(user1)
        .approve(plearnMemberPool.address, depositAmount);
      await plearnMemberPool.connect(user1).deposit(tierIndex, depositAmount);

      await expect(
        plearnMemberPool
          .connect(owner)
          .setUnlockDayPercentBase(
            unlockDayPercentBase,
            pccUnlockDayPercentBase
          )
      ).to.be.revertedWith(
        "Cannot update base percent when tokens are already staked"
      );
    });

    it("should reject setting end day after Period has already ended", async function () {
      const currentDay = await plearnMemberPool.getCurrentDay();
      const endDay = await plearnMemberPool.endDay();
      await increaseTime(endDay * 86400);
      await expect(
        plearnMemberPool.connect(owner).setEndDay(currentDay - 200)
      ).to.be.revertedWith("Period has already ended, cannot be extended");
    });
  });

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
