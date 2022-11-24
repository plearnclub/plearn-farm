require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-etherscan");
require("@nomiclabs/hardhat-truffle4");
require("@openzeppelin/hardhat-upgrades");

const {
  mnemonic,
  bscScanApiKey,
  etherScanApiKey,
  polygonscanApiKey
} = require('./secrets.json');

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task("accounts", "Prints the list of accounts", async (taskArgs, hre) => {
  const accounts = await hre.ethers.getSigners();

  for (const account of accounts) {
    console.log(account.address);
  }
});

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  defaultNetwork: "hardhat",
  networks: {
    localhost: {
      url: "http://127.0.0.1:8545",
    },
    hardhat: {
      blockGasLimit: 99999999
    },
    mainnet: {
      url: "https://mainnet.infura.io/v3/",
      chainId: 1,
      accounts: {
        mnemonic: mnemonic
      }
    },
    rinkeby: {
      url: "https://rinkeby.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161",
      chainId: 4,
      accounts: {
        mnemonic: mnemonic
      },
      blockGasLimit: 99999999
    },
    goerli: {
      url: "https://goerli.infura.io/v3/",
      chainId: 5,
      accounts: {
        mnemonic: mnemonic
      },
      blockGasLimit: 99999999
    },
    sepolia: {
      url: "https://sepolia.infura.io/v3/",
      chainId: 11155111,
      accounts: {
        mnemonic: mnemonic
      },
      blockGasLimit: 99999999
    },
    bsc: {
      url: "https://bsc-dataseed.binance.org/",
      chainId: 56,
      accounts: {
        mnemonic: mnemonic
      },
    },
    bscTestnet: {
      url: "https://data-seed-prebsc-1-s1.binance.org:8545/",
      chainId: 97,
      accounts: {
        mnemonic: mnemonic
      },
      blockGasLimit: 99999999
    },
    polygon: {
      url: "https://polygon-rpc.com/",
      chainId: 137,
      accounts: {
        mnemonic: mnemonic
      }
    },
    polygonMumbai: {
      url: "https://matic-mumbai.chainstacklabs.com",
      chainId: 80001,
      accounts: {
        mnemonic: mnemonic
      },
      blockGasLimit: 99999999
    }
  },
  etherscan: {
    apiKey: {
      mainnet: etherScanApiKey,
      rinkeby: etherScanApiKey,
      goerli: etherScanApiKey,
      sepolia: etherScanApiKey,
      bsc: bscScanApiKey,
      bscTestnet: bscScanApiKey,
      polygon: polygonscanApiKey,
      polygonMumbai: polygonscanApiKey
    }
  },
  solidity: {
    compilers: [{
      version: "0.8.4",
      settings: {
        optimizer: {
          enabled: true,
          runs: 1000,
        },
      },
    }, ],
  },
};