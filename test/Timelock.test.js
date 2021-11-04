const { expectRevert, time } = require('@openzeppelin/test-helpers');
const PlearnToken = artifacts.require('PlearnToken');
const MockBEP20 = artifacts.require('libs/MockBEP20');
const Timelock = artifacts.require('Timelock');
const PlearnEarn = artifacts.require('PlearnEarn');
const { ethers, upgrades } = require('hardhat');

function encodeParameters(types, values) {
    const abi = new ethers.utils.AbiCoder();
    return abi.encode(types, values);
}

contract('Timelock', ([alice, bob, carol, dev, ref, safu, minter]) => {
    beforeEach(async () => {
        this.plearn = await PlearnToken.new({ from: alice });
        await this.plearn.addMinter(alice, { from: alice });
        this.timelock = await Timelock.new(bob, '28800', { from: alice }); //8hours
    });

    it('should not allow non-owner to do operation', async () => {
        await this.plearn.transferOwnership(this.timelock.address, { from: alice });
        await expectRevert(
            this.plearn.transferOwnership(carol, { from: alice }),
            'Ownable: caller is not the owner',
        );
        await expectRevert(
            this.plearn.transferOwnership(carol, { from: bob }),
            'Ownable: caller is not the owner',
        );

        var eta = (await time.latest()).add(time.duration.hours(6));
        await expectRevert(
            this.timelock.queueTransaction(
                this.plearn.address, '0', 'transferOwnership(address)',
                encodeParameters(['address'], [carol]),
                [eta],
                { from: alice },
            ),
            'Timelock::queueTransaction: Call must come from admin.',
        );
    });

    it('should do the timelock thing', async () => {
        await this.plearn.transferOwnership(this.timelock.address, { from: alice });
        const eta = (await time.latest()).add(time.duration.hours(9));
        await this.timelock.queueTransaction(
            this.plearn.address, '0', 'transferOwnership(address)',
            encodeParameters(['address'], [carol]), [eta], { from: bob },
        );
        await time.increase(time.duration.hours(1));
        await expectRevert(
            this.timelock.executeTransaction(
                this.plearn.address, '0', 'transferOwnership(address)',
                encodeParameters(['address'], [carol]), [eta], { from: bob },
            ),
            "Timelock::executeTransaction: Transaction hasn't surpassed time lock.",
        );
        await time.increase(time.duration.hours(8));
        await this.timelock.executeTransaction(
            this.plearn.address, '0', 'transferOwnership(address)',
            encodeParameters(['address'], [carol]), [eta], { from: bob },
        );
        assert.equal((await this.plearn.owner()).valueOf(), carol);
    });

    it('should also work with MasterChef', async () => {
        const [aliceSigner, bobSigner, carolSigner, , , , minterSigner] = await ethers.getSigners();
        this.lp1 = await MockBEP20.new('LPToken', 'LP', '10000000000', { from: minter });
        this.lp2 = await MockBEP20.new('LPToken', 'LP', '10000000000', { from: minter });
        this.earn = await PlearnEarn.new(this.plearn.address, { from: minter });
        const MasterChef = await ethers.getContractFactory("MasterChef");
        this.chef = await upgrades.deployProxy(MasterChef, [this.plearn.address, this.earn.address, dev, ref, safu, '1000', '0', '857000', '90000', '43000', '10000'], { from: alice });

        await this.plearn.transferOwnership(this.chef.address, { from: alice });
        await this.earn.transferOwnership(this.chef.address, { from: minter });
        await this.chef.connect(aliceSigner).add('100', this.lp1.address, true);
        await this.chef.connect(aliceSigner).transferOwnership(this.timelock.address);
        await expectRevert(
            this.chef.add('100', this.lp1.address, true, { from: alice }),
            "Ownable: caller is not the owner",
        );

        const eta = (await time.latest()).add(time.duration.hours(9));
        await this.timelock.queueTransaction(
            this.chef.address, '0', 'transferOwnership(address)',
            encodeParameters(['address'], [minter]), [eta], { from: bob },
        );
        // await this.timelock.queueTransaction(
        //     this.chef.address, '0', 'add(uint256,address,bool)',
        //     encodeParameters(['uint256', 'address', 'bool'], ['100', this.lp2.address, false]), eta, { from: bob },
        // );
        await time.increase(time.duration.hours(9));
        await this.timelock.executeTransaction(
            this.chef.address, '0', 'transferOwnership(address)',
            encodeParameters(['address'], [minter]), [eta], { from: bob },
        );
        await expectRevert(
            this.chef.add('100', this.lp1.address, true, { from: alice }),
            "Ownable: caller is not the owner",
        );
        await this.chef.connect(minterSigner).add('100', this.lp1.address, true)
        // await this.timelock.executeTransaction(
        //     this.chef.address, '0', 'add(uint256,address,bool)',
        //     encodeParameters(['uint256', 'address', 'bool'], ['100', this.lp2.address, false]), eta, { from: bob },
        // );
        // assert.equal((await this.chef.poolInfo('0')).valueOf().allocPoint, '200');
        // assert.equal((await this.chef.totalAllocPoint()).valueOf(), '300');
        // assert.equal((await this.chef.poolLength()).valueOf(), '2');
    });
});
