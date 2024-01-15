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
      13699, // _unlockDayPercentBase
      136987, // _pccUnlockDayPercentBase
      true // _depositEnabled
    );
    await plearnMemberPool.deployed();

    // add tier
    await plearnMemberPool.addTier({
      // Silver
      lockDayPercent: 13699,
      pccLockDayPercent: 136987,
      lockPeriod: 30,
      maxAmount: toBigNumber(9999),
      minAmount: toBigNumber(1000),
      totalDeposited: 0,
    });
    await plearnMemberPool.addTier({
      // Gold
      lockDayPercent: 68494,
      pccLockDayPercent: 205480,
      lockPeriod: 90,
      maxAmount: toBigNumber(49999),
      minAmount: toBigNumber(10000),
      totalDeposited: 0,
    });
    await plearnMemberPool.addTier({
      // Platinum
      lockDayPercent: 95891,
      pccLockDayPercent: 369864,
      lockPeriod: 180,
      maxAmount: toBigNumber(99999),
      minAmount: toBigNumber(50000),
      totalDeposited: 0,
    });
    await plearnMemberPool.addTier({
      // Diamond
      lockDayPercent: 150685,
      pccLockDayPercent: 616439,
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

      expect(await plearnToken.balanceOf(user1.address)).to.equal(
        depositAmount
      );

      await expect(plearnMemberPool.connect(user1).deposit(tier, depositAmount))
        .to.emit(plearnMemberPool, "Deposit")
        .withArgs(user1.address, tier, depositAmount);
      let userInfo = await plearnMemberPool.userInfo(user1.address);

      assert.equal(toFormatEther(userInfo.amount), 1000);
    });
    it("should allow deposit and correctly calculate rewards", async function () {
      const depositAmount = toBigNumber("1000");
      const tierIndex = 0;
      const tier = await plearnMemberPool.tiers(tierIndex);
      const approveDepositAmount = toBigNumber("1000");
      await plearnToken.transfer(user1.address, approveDepositAmount);
      await plearnToken
        .connect(user1)
        .approve(plearnMemberPool.address, approveDepositAmount);

      await plearnMemberPool.connect(user1).deposit(tierIndex, depositAmount);
      await increaseTime(tier.lockPeriod * 86400);

      const [info, currentDay, accruedInterest, pccAccruedInterest] =
        await plearnMemberPool.getUserInfo(user1.address);
      let userInfo = info.userInfo;

      expect(userInfo.amount).to.equal(depositAmount);
      expect(await plearnToken.balanceOf(user1.address)).to.equal(
        toBigNumber("0")
      );
      expect(accruedInterest).to.equal(toBigNumber("0.41097"));
      expect(pccAccruedInterest).to.equal(toBigNumber("4.10961"));
    });

    it("should correctly calculate interest after the lock period ends", async function () {
      const depositAmount = toBigNumber("10000");
      const tierIndex = 1;

      await plearnToken.transfer(user1.address, depositAmount);
      await plearnToken
        .connect(user1)
        .approve(plearnMemberPool.address, depositAmount);
      await plearnMemberPool.connect(user1).deposit(tierIndex, depositAmount);

      const tier = await plearnMemberPool.tiers(tierIndex);
      const lockPeriodSeconds = tier.lockPeriod * 86400;
      const postLockPeriod = 7;
      const unlockDayPercentBase = 13699;

      await increaseTime(lockPeriodSeconds);
      await plearnMemberPool.connect(user1).harvest();
      await increaseTime(postLockPeriod * 86400);

      const expectedInterest = calculateExpectedInterest(
        depositAmount,
        unlockDayPercentBase,
        postLockPeriod
      );

      const [userInfo, currentDay, accruedInterest, pccAccruedInterest] =
        await plearnMemberPool.getUserInfo(user1.address);
      expect(accruedInterest).to.be.closeTo(
        expectedInterest,
        toBigNumber("0.01")
      );
      expect(pccAccruedInterest).to.be.closeTo(
        toBigNumber("9.5890"),
        toBigNumber("0.01")
      );
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

      await increaseTime(tier.lockPeriod * 86400);

      await expect(plearnMemberPool.connect(user1).withdraw(withdrawAmount))
        .to.emit(plearnMemberPool, "Withdraw")
        .withArgs(user1.address, withdrawAmount);

      expect(await plearnToken.balanceOf(user1.address)).to.be.closeTo(
        toBigNumber("5863.019"),
        toBigNumber("0.001")
      );

      expect(await phillCoin.balanceOf(user1.address)).to.be.closeTo(
        toBigNumber("3328.776"),
        toBigNumber("0.001")
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

    it("Tier Downgrade on Withdrawal Below Current Tier Minimum and correctly calculate rewards", async function () {
      const withdrawAmount = toBigNumber("40000");
      const tierIndex = 2;
      const tier = await plearnMemberPool.tiers(tierIndex);

      await increaseTime(tier.lockPeriod * 86400);

      await expect(plearnMemberPool.connect(user1).withdraw(withdrawAmount))
        .to.emit(plearnMemberPool, "Withdraw")
        .withArgs(user1.address, withdrawAmount);

      expect(await plearnToken.balanceOf(user1.address)).to.be.closeTo(
        toBigNumber("40863.019"),
        toBigNumber("0.001")
      );

      const userInfo = await plearnMemberPool.userInfo(user1.address);
      expect(userInfo.amount).to.equal(toBigNumber("10000"));
      expect(userInfo.tierIndex).to.equal(1);

      await increaseTime(10 * 86400);

      const [, , accruedInterest, pccAccruedInterest] =
        await plearnMemberPool.getUserInfo(user1.address);

      expect(accruedInterest).to.be.closeTo(
        toBigNumber("1.3699"),
        toBigNumber("0.001")
      );

      expect(pccAccruedInterest).to.be.closeTo(
        toBigNumber("13.6986"),
        toBigNumber("0.001")
      );
    });

    it("should allow user to withdraw the entire locked amount after end day update", async function () {
      const _currentDay = await plearnMemberPool.getCurrentDay();
      const newEndDay = _currentDay + 20;
      await plearnMemberPool.connect(owner).setEndDay(newEndDay);
      const daysToPass = 20;
      await increaseTime(86400 * daysToPass);
      const WithdrawAmount = toBigNumber("50000");
      await expect(plearnMemberPool.connect(user1).withdraw(WithdrawAmount))
        .to.emit(plearnMemberPool, "Withdraw")
        .withArgs(user1.address, WithdrawAmount);

      const userInfo = await plearnMemberPool.userInfo(user1.address);
      expect(userInfo.amount).to.equal(toBigNumber("0"));

      const userBalance = await plearnToken.balanceOf(user1.address);
      expect(userBalance).to.equal(toBigNumber("50095.891"));

      expect(await phillCoin.balanceOf(user1.address)).to.be.closeTo(
        toBigNumber("369.864"),
        toBigNumber("0.001")
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
        .withArgs(
          user1.address,
          toBigNumber("0.41097"),
          toBigNumber("4.10961")
        );

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
        .withArgs(
          user1.address,
          toBigNumber("0.54796"),
          toBigNumber("5.47948")
        );

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
        .withArgs(
          user1.address,
          toBigNumber("0.205485"),
          toBigNumber("2.054805")
        );

      const userBalanceAfter = await plearnToken.balanceOf(user1.address);
      expect(userBalanceAfter).to.be.above(userBalanceBefore);
    });

    it("should allow user to harvest rewards after lock 1 day", async function () {
      const daysToPass = 1;
      await increaseTime(86400 * daysToPass);

      const userBalanceBefore = await plearnToken.balanceOf(user1.address);

      await expect(plearnMemberPool.connect(user1).harvest())
        .to.emit(plearnMemberPool, "Harvest")
        .withArgs(
          user1.address,
          toBigNumber("0.013699"),
          toBigNumber("0.136987")
        );

      const userBalanceAfter = await plearnToken.balanceOf(user1.address);
      expect(userBalanceAfter).to.be.above(userBalanceBefore);
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

    it("should not allow owner to set an existing tier if totalDeposited is greater than 0", async function () {
      const initialDeposit = toBigNumber("1000");
      const tierIndex = 0;
      await plearnToken.transfer(user1.address, initialDeposit);
      await plearnToken
        .connect(user1)
        .approve(plearnMemberPool.address, initialDeposit);
      await plearnMemberPool.connect(user1).deposit(tierIndex, initialDeposit);
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
      ).to.be.revertedWith("Tier total deposited is not zero");
    });
  });

  describe("Contract Settings", function () {
    it("should allow owner to set the end day", async function () {
      const newEndDay = 20500;

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

    it("should allow owner to enable or disable deposits", async function () {
      await expect(plearnMemberPool.connect(owner).setDepositEnabled(true))
        .to.emit(plearnMemberPool, "depositEnabledUpdated")
        .withArgs(true);

      expect(await plearnMemberPool.depositEnabled()).to.equal(true);

      await expect(plearnMemberPool.connect(owner).setDepositEnabled(false))
        .to.emit(plearnMemberPool, "depositEnabledUpdated")
        .withArgs(false);

      expect(await plearnMemberPool.depositEnabled()).to.equal(false);
    });
  });

  describe("Reward Calculation with End Day Change", function () {
    let initialEndDay;
    beforeEach(async function () {
      initialEndDay = await plearnMemberPool.endDay();
      const depositAmount = toBigNumber("10000");
      const tierIndex = 1;

      await plearnToken.transfer(user1.address, depositAmount);
      await plearnToken
        .connect(user1)
        .approve(plearnMemberPool.address, depositAmount);
      await plearnMemberPool.connect(user1).deposit(tierIndex, depositAmount);
    });

    it("should correctly calculate rewards after end day change", async function () {
      const _currentDay = await plearnMemberPool.getCurrentDay();
      const newEndDay = _currentDay + 20;
      await plearnMemberPool.connect(owner).setEndDay(newEndDay);

      const daysToPass = 30;
      await increaseTime(86400 * daysToPass);

      const expectedReward = toBigNumber("13.69864");

      const [userInfo, currentDay, accruedInterest, pccAccruedInterest] =
        await plearnMemberPool.getUserInfo(user1.address);

      expect(accruedInterest).to.be.closeTo(
        expectedReward,
        toBigNumber("0.01")
      );
      expect(pccAccruedInterest).to.be.closeTo(
        toBigNumber("41.0959"),
        toBigNumber("0.01")
      );
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
      await increaseTime(86400 * daysToPass);
      await plearnMemberPool
        .connect(user1)
        .deposit(newTierIndex, additionalDeposit);

      await increaseTime(86400 * 79);
      const withdrawAmount = toBigNumber("500");
      await expect(
        plearnMemberPool.connect(user1).withdraw(withdrawAmount)
      ).to.be.revertedWith("Cannot withdraw yet");
    });

    it("should allow user to upgrade tier and calculate rewards correctly", async function () {
      const newTierIndex = 1;
      await plearnToken.transfer(user1.address, additionalDeposit);

      const daysToPass = 10;
      await increaseTime(86400 * daysToPass);
      await plearnMemberPool
        .connect(user1)
        .deposit(newTierIndex, additionalDeposit);

      expect(await plearnToken.balanceOf(user1.address)).to.be.closeTo(
        toBigNumber("0.13698"),
        toBigNumber("0.001")
      );

      expect(await phillCoin.balanceOf(user1.address)).to.be.closeTo(
        toBigNumber("1.3698"),
        toBigNumber("0.001")
      );

      await increaseTime(86400 * 20);

      const expectedReward = toBigNumber("13.6988");

      const [info, currentDay, accruedInterest, pccAccruedInterest] =
        await plearnMemberPool.getUserInfo(user1.address);

      expect(info.tierIndex).to.equal(newTierIndex);
      expect(info.userInfo.amount).to.equal(
        initialDeposit.add(additionalDeposit)
      );
      expect(accruedInterest).to.be.closeTo(
        expectedReward,
        toBigNumber("0.01")
      );
      expect(pccAccruedInterest).to.be.closeTo(
        toBigNumber("41.0959"),
        toBigNumber("0.01")
      );
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

  function calculateExpectedInterest(amount, dailyPercent, days) {
    const dailyInterestRate = dailyPercent / 1000_000_000;
    const value =
      (Number(amount) * dailyInterestRate * days) / 1000_000_000_000_000_000;
    return toBigNumber(value);
  }
});
