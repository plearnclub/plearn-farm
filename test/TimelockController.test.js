const { expectRevert, time } = require('@openzeppelin/test-helpers');
const PlearnToken = artifacts.require('PlearnToken');
const MockBEP20 = artifacts.require('libs/MockBEP20');
const TimelockController = artifacts.require('TimelockController');
const PlearnEarn = artifacts.require('PlearnEarn');
const { ethers, upgrades } = require('hardhat');

const DELAY = '28800' //8hours

contract('TimelockController', ([alice, bob, carol, dev, ref, safu, minter, admin, executor]) => {
    beforeEach(async () => {
        this.plearn = await PlearnToken.new({ from: alice });
        await this.plearn.addMinter(alice, { from: alice });
        this.timelockController = await TimelockController.new (DELAY, [dev], [executor], { from: admin }) //Div is Proposer, 
    });

    it('should not allow non-proposer to do operation', async () => {
        await this.plearn.transferOwnership(this.timelockController.address, { from: alice });
        await expectRevert(
            this.plearn.transferOwnership(carol, { from: alice }),
            'Ownable: caller is not the owner',
        );
        await expectRevert(
            this.plearn.transferOwnership(carol, { from: bob }),
            'Ownable: caller is not the owner',
        );

        const interface = new ethers.utils.Interface(
            ["function transferOwnership(address)"]
        );
        const data = interface.encodeFunctionData("transferOwnership", [carol])
       
        await expectRevert(
            this.timelockController.schedule(this.plearn.address, '0', data, '0', '0', DELAY, { from: alice }),
            'TimelockController: sender requires permission'
        );
    });

    it('should do the timelock thing', async () => {
        await this.plearn.transferOwnership(this.timelockController.address, { from: alice });

        const interface = new ethers.utils.Interface(
            ["function transferOwnership(address)"]
        );
        const data = interface.encodeFunctionData("transferOwnership", [carol])
        //const operationId = await this.timelockController.hashOperation(this.plearn.address, '0', data, '0', '0',  { from: alice })

        await this.timelockController.schedule(this.plearn.address, '0', data, '0', '0', DELAY, { from: dev })

        await time.increase(time.duration.hours(1));
        await expectRevert(
            this.timelockController.execute(this.plearn.address, '0', data, '0', '0', { from: executor }),
            'TimelockController: operation is not ready'
        );
        
        await time.increase(time.duration.hours(8));
        await this.timelockController.execute(this.plearn.address, '0', data, '0', '0', { from: executor })

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
        await this.chef.connect(aliceSigner).transferOwnership(this.timelockController.address);
   
        await expectRevert(
            this.chef.add('100', this.lp1.address, true, { from: alice }),
            'Ownable: caller is not the owner',
        );

        const interface = new ethers.utils.Interface([
            "function transferOwnership(address)",
            "function add(uint256,address,bool)"
        ]);

        const addData = interface.encodeFunctionData("add", ['100', this.lp2.address, true])
        await this.timelockController.schedule(this.chef.address, '0',addData, '0', '0', DELAY, { from: dev } );
        
        await time.increase(time.duration.hours(9));
        await this.timelockController.execute(this.chef.address, '0', addData, '0', '0', { from: executor })

        const transferOwnershipData = interface.encodeFunctionData("transferOwnership", [ await bobSigner.getAddress()])
        await this.timelockController.schedule(this.chef.address, '0', transferOwnershipData, '0', '0', DELAY, { from: dev })

        await time.increase(time.duration.hours(9));
        await this.timelockController.execute(this.chef.address, '0', transferOwnershipData, '0', '0', { from: executor })
        
        await expectRevert(
            this.chef.add('100', this.lp1.address, true, { from: alice }),
            'Ownable: caller is not the owner'
        );

        await this.chef.connect(bobSigner).add('100', this.lp1.address, true)
        
        assert.equal((await this.chef.poolInfo('0')).valueOf().allocPoint, '1000');
        assert.equal((await this.chef.totalAllocPoint()).valueOf(), '1300');
        assert.equal((await this.chef.poolLength()).valueOf(), '4');
     });
});
