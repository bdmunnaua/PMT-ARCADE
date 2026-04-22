const express = require('express');
const { Web3 } = require('web3');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Fix for BigInt serialization
BigInt.prototype.toJSON = function() {
    return this.toString();
};

// CORS configuration
app.use(cors({
    origin: "*",
    methods: ['GET', 'POST'],
    credentials: true
}));

app.use(express.json());

// BSC Mainnet RPC endpoints
const RPC_ENDPOINTS = [
    'https://bsc-dataseed.binance.org/',
    'https://bsc-dataseed1.defibit.io/',
    'https://bsc-dataseed1.ninicoin.io/',
    'https://bsc-dataseed2.defibit.io/'
];

// Web3 setup with fallback
let web3;
let currentRpcIndex = 0;

const initializeWeb3 = async () => {
    for (let i = 0; i < RPC_ENDPOINTS.length; i++) {
        try {
            const rpcUrl = process.env.RPC_URL || RPC_ENDPOINTS[i];
            console.log(`🔗 Trying RPC: ${rpcUrl}`);
            
            web3 = new Web3(rpcUrl);
            
            // Test connection
            const blockNumber = await web3.eth.getBlockNumber();
            const chainId = await web3.eth.getChainId();
            
            console.log(`✅ Connected to BSC Mainnet! Current block: ${blockNumber}`);
            console.log(`📍 Chain ID: ${chainId}`);
            console.log(`📍 Using RPC: ${rpcUrl}`);
            
            currentRpcIndex = i;
            return true;
        } catch (error) {
            console.log(`❌ Failed to connect to RPC: ${error.message}`);
            continue;
        }
    }
    throw new Error('All RPC endpoints failed');
};

// Security validation
const privateKey = process.env.PRIVATE_KEY;
if (!privateKey || !privateKey.startsWith('0x') || privateKey.length !== 66) {
    console.error('❌ Invalid private key format in .env');
    process.exit(1);
}

let ownerWallet;
try {
    const tempWeb3 = new Web3('https://bsc-dataseed.binance.org/');
    ownerWallet = tempWeb3.eth.accounts.privateKeyToAccount(privateKey).address;
    console.log('✅ Owner wallet:', ownerWallet);
} catch (error) {
    console.error('❌ Invalid private key in .env');
    process.exit(1);
}

const tokenAddress = process.env.TOKEN_ADDRESS;

// Enhanced Token ABI with transfer function
const tokenABI = [
    {
        "inputs": [
            {"internalType": "address", "name": "to", "type": "address"},
            {"internalType": "uint256", "name": "amount", "type": "uint256"}
        ],
        "name": "mint",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {"internalType": "address", "name": "to", "type": "address"},
            {"internalType": "uint256", "name": "amount", "type": "uint256"}
        ],
        "name": "transfer",
        "outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "owner",
        "outputs": [{"internalType": "address", "name": "", "type": "address"}],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [{"internalType": "address", "name": "account", "type": "address"}],
        "name": "balanceOf",
        "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function"
    }
];

let tokenContract;

// Helper function to safely format response data
const formatResponse = (data) => {
    return JSON.parse(JSON.stringify(data, (key, value) => {
        if (typeof value === 'bigint') {
            return value.toString();
        }
        return value;
    }));
};

// ==================== API ROUTES ====================

// Test endpoint
app.get('/api/test', (req, res) => {
    res.json({ 
        status: 'online', 
        message: 'PuzzleMint Backend - MAINNET MODE',
        owner: ownerWallet,
        token: tokenAddress,
        network: 'BSC Mainnet',
        timestamp: new Date().toISOString()
    });
});

// Health check with blockchain connection test
app.get('/health', async (req, res) => {
    try {
        const blockNumber = await web3.eth.getBlockNumber();
        const balance = await web3.eth.getBalance(ownerWallet);
        
        const responseData = {
            status: 'healthy',
            service: 'PuzzleMint Backend',
            blockchain: 'connected',
            blockNumber: blockNumber,
            balance: web3.utils.fromWei(balance.toString(), 'ether') + ' BNB',
            timestamp: new Date().toISOString()
        };
        
        res.json(formatResponse(responseData));
    } catch (error) {
        res.json({
            status: 'degraded',
            service: 'PuzzleMint Backend',
            blockchain: 'disconnected',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Server status with blockchain info
app.get('/api/status', async (req, res) => {
    try {
        const chainId = await web3.eth.getChainId();
        const balance = await web3.eth.getBalance(ownerWallet);
        const blockNumber = await web3.eth.getBlockNumber();
        
        // Check token balance if contract is initialized
        let tokenBalance = '0';
        if (tokenContract) {
            try {
                const balanceWei = await tokenContract.methods.balanceOf(ownerWallet).call();
                tokenBalance = web3.utils.fromWei(balanceWei, 'ether');
            } catch (error) {
                console.log('⚠️  Could not fetch token balance:', error.message);
            }
        }
        
        const responseData = {
            status: "✅ PuzzleMint - MAINNET MODE",
            ownerWallet: ownerWallet,
            tokenAddress: tokenAddress,
            network: `BSC Mainnet (Chain ID: ${chainId})`,
            currentBlock: blockNumber,
            balance: web3.utils.fromWei(balance.toString(), 'ether') + ' BNB',
            tokenBalance: tokenBalance + ' PMT',
            environment: 'REAL MAINNET TRANSACTIONS',
            warning: 'REAL MONEY - BE CAREFUL!'
        };
        
        res.json(formatResponse(responseData));
    } catch (error) {
        res.status(500).json({
            status: "⚠️ Mainnet Connection Issue",
            ownerWallet: ownerWallet,
            tokenAddress: tokenAddress,
            network: "BSC Mainnet - Connection Failed",
            error: error.message
        });
    }
});

// REAL Reward endpoint - MAINNET (Using TRANSFER instead of MINT)
app.post('/reward-player', async (req, res) => {
    try {
        const { playerAddress, score } = req.body;
        
        console.log('🎯 MAINNET TRANSACTION - Reward request:', { playerAddress, score });
        
        // Input validation
        if (!playerAddress || score === undefined) {
            return res.status(400).json({ 
                success: false,
                error: "Missing playerAddress or score" 
            });
        }

        if (!web3.utils.isAddress(playerAddress)) {
            return res.status(400).json({ 
                success: false,
                error: "Invalid wallet address format" 
            });
        }

        // ============ MINIMUM WITHDRAWAL VALIDATION ============
        const MIN_WITHDRAWAL_PMT = 1000; // Minimum 1000 PMT
        const requestedPMT = score / 1000; // Convert score to PMT
        
        if (requestedPMT < MIN_WITHDRAWAL_PMT) {
            return res.status(400).json({
                success: false,
                error: `Minimum withdrawal is ${MIN_WITHDRAWAL_PMT} PMT. You requested ${requestedPMT} PMT`
            });
        }
        // ============ END VALIDATION ============

        // Calculate tokens to transfer (not mint)
        const tokensToTransfer = web3.utils.toWei(requestedPMT.toString(), 'ether');
        const tokensDisplay = web3.utils.fromWei(tokensToTransfer, 'ether');
        
        console.log(`🎯 MAINNET: Transferring ${tokensDisplay} REAL PMT to ${playerAddress}`);
        console.log(`📋 Minimum withdrawal check: ${requestedPMT} PMT >= ${MIN_WITHDRAWAL_PMT} PMT ✅`);

        // Check if we have enough BNB for gas
        const balance = await web3.eth.getBalance(ownerWallet);
        const gasPrice = await web3.eth.getGasPrice();
        const estimatedGas = 200000;
        const gasCost = BigInt(gasPrice) * BigInt(estimatedGas);
        
        const balanceWei = BigInt(balance.toString());
        
        if (balanceWei < gasCost) {
            return res.status(400).json({
                success: false,
                error: `Insufficient BNB for gas. Need ${web3.utils.fromWei(gasCost.toString(), 'ether')} BNB but have ${web3.utils.fromWei(balance.toString(), 'ether')} BNB`
            });
        }

        // Initialize token contract
        if (!tokenContract) {
            tokenContract = new web3.eth.Contract(tokenABI, tokenAddress);
        }

        // Check if backend wallet has enough tokens
        const backendTokenBalance = await tokenContract.methods.balanceOf(ownerWallet).call();
        if (BigInt(backendTokenBalance) < BigInt(tokensToTransfer)) {
            return res.status(400).json({
                success: false,
                error: `Insufficient PMT tokens. Need ${tokensDisplay} PMT but have ${web3.utils.fromWei(backendTokenBalance, 'ether')} PMT`
            });
        }

        // Get nonce
        let nonce;
        try {
            nonce = await web3.eth.getTransactionCount(ownerWallet, 'pending');
            console.log('📝 Using nonce:', nonce);
        } catch (nonceError) {
            console.error('❌ Failed to get nonce:', nonceError);
            throw new Error(`Cannot get transaction count: ${nonceError.message}`);
        }

        // Build TRANSFER transaction (not mint)
        const txObject = {
            from: ownerWallet,
            to: tokenAddress,
            nonce: web3.utils.toHex(nonce),
            gasPrice: web3.utils.toHex(gasPrice),
            gasLimit: web3.utils.toHex(estimatedGas),
            data: tokenContract.methods.transfer(playerAddress, tokensToTransfer).encodeABI(),
            chainId: 56
        };

        console.log('📡 Transfer transaction object:', {
            from: txObject.from,
            to: txObject.to,
            tokens: tokensDisplay,
            gasPrice: `${web3.utils.fromWei(gasPrice, 'gwei')} Gwei`
        });

        // Sign transaction
        console.log('🔐 Signing transfer transaction...');
        const signedTx = await web3.eth.accounts.signTransaction(txObject, privateKey);
        
        if (!signedTx.rawTransaction) {
            throw new Error('Transaction signing failed - no raw transaction returned');
        }

        // Send transaction
        console.log('📡 Broadcasting transfer to network...');
        const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
        
        console.log('✅ MAINNET Transfer successful!');
        console.log('   Transaction Hash:', receipt.transactionHash);
        console.log('   Tokens Transferred:', tokensDisplay);

        const responseData = {
            success: true,
            transactionHash: receipt.transactionHash,
            tokensTransferred: tokensDisplay,
            wallet: playerAddress,
            message: `Successfully transferred ${tokensDisplay} REAL PMT tokens!`,
            explorerLink: `https://bscscan.com/tx/${receipt.transactionHash}`,
            realTransaction: true,
            network: 'BSC Mainnet',
            type: 'TRANSFER'
        };
        
        res.json(formatResponse(responseData));
        
    } catch (error) {
        console.error('❌ MAINNET Transfer failed:', error);
        
        let suggestion = 'Check your backend configuration and balances';
        
        if (error.message.includes('transfer')) {
            suggestion = 'Token contract may not allow transfers - check contract permissions';
        } else if (error.message.includes('insufficient')) {
            suggestion = 'Backend wallet does not have enough PMT tokens for transfer';
        }
        
        res.status(500).json({
            success: false,
            error: error.message,
            realTransaction: true,
            network: 'BSC Mainnet',
            suggestion: suggestion
        });
    }
});

// Wallet info endpoint
app.get('/api/wallet-info', async (req, res) => {
    try {
        const balance = await web3.eth.getBalance(ownerWallet);
        const gasPrice = await web3.eth.getGasPrice();
        const chainId = await web3.eth.getChainId();
        
        const responseData = {
            ownerWallet: ownerWallet,
            balance: web3.utils.fromWei(balance.toString(), 'ether') + ' BNB',
            gasPrice: web3.utils.fromWei(gasPrice.toString(), 'gwei') + ' Gwei',
            chainId: chainId,
            tokenAddress: tokenAddress,
            network: chainId === 56 ? 'BSC Mainnet' : chainId === 97 ? 'BSC Testnet' : 'Unknown'
        };
        
        res.json(formatResponse(responseData));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Test transaction endpoint (without actually sending)
app.post('/test-transaction', async (req, res) => {
    try {
        const { playerAddress } = req.body;
        
        if (!playerAddress) {
            return res.status(400).json({ error: "Player address required" });
        }

        // Just test the connection and gas estimation
        const balance = await web3.eth.getBalance(ownerWallet);
        const gasPrice = await web3.eth.getGasPrice();
        const nonce = await web3.eth.getTransactionCount(ownerWallet, 'pending');
        
        res.json({
            success: true,
            message: "Blockchain connection successful",
            ownerBalance: web3.utils.fromWei(balance.toString(), 'ether') + ' BNB',
            gasPrice: web3.utils.fromWei(gasPrice.toString(), 'gwei') + ' Gwei',
            nonce: nonce,
            canTransact: BigInt(balance.toString()) > BigInt(gasPrice.toString()) * BigInt(21000)
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('🚨 Unhandled error:', error);
    res.status(500).json({ 
        success: false, 
        error: 'Internal server error' 
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ 
        success: false, 
        error: 'Endpoint not found' 
    });
});

// Initialize and start server
const startServer = async () => {
    try {
        await initializeWeb3();
        
        // Initialize token contract
        tokenContract = new web3.eth.Contract(tokenABI, tokenAddress);
        console.log('✅ Token contract initialized');
        
        // Check balances
        const balance = await web3.eth.getBalance(ownerWallet);
        const bnbBalance = web3.utils.fromWei(balance.toString(), 'ether');
        
        // Check token balance
        const tokenBalance = await tokenContract.methods.balanceOf(ownerWallet).call();
        const pmtBalance = web3.utils.fromWei(tokenBalance, 'ether');
        
        console.log('💰 Backend Wallet Balance:', bnbBalance, 'BNB');
        console.log('🪙 Backend Token Balance:', pmtBalance, 'PMT');
        
        if (parseFloat(bnbBalance) < 0.01) {
            console.log('⚠️  WARNING: Low BNB balance for Mainnet gas fees!');
            console.log('💸 You need REAL BNB for Mainnet transactions');
        }
        
        console.log('🌐 NETWORK: BSC MAINNET - REAL MONEY');
        console.log('⚠️  WARNING: This will make REAL transactions with REAL cryptocurrency!');
        
        app.listen(3000, () => {
            console.log("\n🚀 PuzzleMint Backend Running on port 3000");
            console.log("📍 Network: BSC MAINNET");
            console.log("📍 Owner Wallet:", ownerWallet);
            console.log("📍 Token Address:", tokenAddress);
            console.log("💰 BNB Balance:", bnbBalance, 'BNB');
            console.log("🪙 PMT Balance:", pmtBalance, 'PMT');
            console.log("🔄 MODE: TRANSFER (Using existing tokens)");
            console.log("💰 MINIMUM WITHDRAWAL: 1000 PMT");
            console.log("⚠️  REAL MONEY MODE - BE CAREFUL!");
            console.log("📍 Status URL: http://localhost:3000/api/status\n");
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
};

startServer();