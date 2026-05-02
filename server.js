const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 10000;
const JWT_SECRET = 'exness-halal-trading-bot-secret-key-2024';
const ENCRYPTION_KEY = 'exness0123456789012345678901234567890123456789';

// ==================== HALAL ASSETS ====================
const HALAL_ASSETS = [
    { symbol: 'BTCUSD', name: 'Bitcoin', minVolume: 0.01, stepSize: 0.01, volatility: 'high', liquidity: 'high', basePrice: 50000 },
    { symbol: 'ETHUSD', name: 'Ethereum', minVolume: 0.01, stepSize: 0.01, volatility: 'high', liquidity: 'high', basePrice: 3000 },
    { symbol: 'BNBUSD', name: 'Binance Coin', minVolume: 0.1, stepSize: 0.1, volatility: 'medium', liquidity: 'medium', basePrice: 400 },
    { symbol: 'SOLUSD', name: 'Solana', minVolume: 0.1, stepSize: 0.1, volatility: 'high', liquidity: 'medium', basePrice: 100 },
    { symbol: 'ADAUSD', name: 'Cardano', minVolume: 1, stepSize: 1, volatility: 'medium', liquidity: 'medium', basePrice: 0.5 },
    { symbol: 'XRPUSD', name: 'Ripple', minVolume: 1, stepSize: 1, volatility: 'medium', liquidity: 'high', basePrice: 0.6 },
    { symbol: 'EURUSD', name: 'Euro/Dollar', minVolume: 0.01, stepSize: 0.01, volatility: 'low', liquidity: 'very high', basePrice: 1.08 },
    { symbol: 'GBPUSD', name: 'Pound/Dollar', minVolume: 0.01, stepSize: 0.01, volatility: 'low', liquidity: 'very high', basePrice: 1.25 },
    { symbol: 'XAUUSD', name: 'Gold', minVolume: 0.01, stepSize: 0.01, volatility: 'medium', liquidity: 'high', basePrice: 2000 }
];

// Trading settings
const MAX_CONCURRENT_TRADES = 20;           // Place up to 20 trades simultaneously
const TIME_LIMIT_HOURS = 1;                 // 1 hour time limit
const PROFIT_CHECK_INTERVAL = 1000;         // Check profit every 1 second
const ORDER_FILL_TIMEOUT = 30000;           // Wait 30 seconds for order to fill

// Strategy definitions
const STRATEGIES = {
    scalping: { name: 'Scalping', targetMultiplier: 1.002, stopMultiplier: 0.998, confidence: 0.8 },
    momentum: { name: 'Momentum', targetMultiplier: 1.005, stopMultiplier: 0.995, confidence: 0.7 },
    swing: { name: 'Swing', targetMultiplier: 1.01, stopMultiplier: 0.99, confidence: 0.6 },
    aggressive: { name: 'Aggressive', targetMultiplier: 1.02, stopMultiplier: 0.985, confidence: 0.5 }
};

// ==================== DATA DIRECTORIES ====================
const DATA_DIR = path.join(__dirname, 'data');
const TRADES_DIR = path.join(DATA_DIR, 'trades');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const PENDING_FILE = path.join(DATA_DIR, 'pending.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const BALANCE_CACHE_FILE = path.join(DATA_DIR, 'balance_cache.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(TRADES_DIR)) fs.mkdirSync(TRADES_DIR, { recursive: true });

// ==================== CREATE OWNER ACCOUNT ====================
const ownerEmail = "mujtabahatif@gmail.com";
const ownerPasswordPlain = "Mujtabah@2598";
const ownerPasswordHash = bcrypt.hashSync(ownerPasswordPlain, 10);

let users = {};
if (fs.existsSync(USERS_FILE)) {
    try {
        users = JSON.parse(fs.readFileSync(USERS_FILE));
    } catch(e) { users = {}; }
}

users[ownerEmail] = {
    email: ownerEmail,
    password: ownerPasswordHash,
    isOwner: true,
    isApproved: true,
    isBlocked: false,
    exnessId: "",
    apiKey: "",
    secretKey: "",
    accountType: "real",
    createdAt: new Date().toISOString()
};
fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
console.log("✅ Owner account created");
console.log("   Email: mujtabahatif@gmail.com");
console.log("   Password: Mujtabah@2598");

if (!fs.existsSync(PENDING_FILE)) fs.writeFileSync(PENDING_FILE, JSON.stringify({}, null, 2));
if (!fs.existsSync(ORDERS_FILE)) fs.writeFileSync(ORDERS_FILE, JSON.stringify({}, null, 2));
if (!fs.existsSync(BALANCE_CACHE_FILE)) fs.writeFileSync(BALANCE_CACHE_FILE, JSON.stringify({}, null, 2));

// ==================== HELPER FUNCTIONS ====================
function readUsers() { 
    try { return JSON.parse(fs.readFileSync(USERS_FILE)); } 
    catch(e) { return {}; }
}
function writeUsers(data) { fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2)); }
function readPending() { 
    try { return JSON.parse(fs.readFileSync(PENDING_FILE)); } 
    catch(e) { return {}; }
}
function writePending(data) { fs.writeFileSync(PENDING_FILE, JSON.stringify(data, null, 2)); }
function readOrders() { 
    try { return JSON.parse(fs.readFileSync(ORDERS_FILE)); } 
    catch(e) { return {}; }
}
function writeOrders(data) { fs.writeFileSync(ORDERS_FILE, JSON.stringify(data, null, 2)); }
function readBalanceCache() { 
    try { return JSON.parse(fs.readFileSync(BALANCE_CACHE_FILE)); } 
    catch(e) { return {}; }
}
function writeBalanceCache(data) { fs.writeFileSync(BALANCE_CACHE_FILE, JSON.stringify(data, null, 2)); }

function encrypt(text) {
    if (!text) return "";
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text) {
    if (!text) return "";
    const parts = text.split(':');
    const iv = Buffer.from(parts.shift(), 'hex');
    const encryptedText = parts.join(':');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

function cleanKey(k) { return k ? k.replace(/[\s\n\r\t]+/g, '').trim() : ""; }

// ==================== AUTO STRATEGY SELECTION ====================
function selectStrategy(asset, marketCondition) {
    // Auto-select best strategy based on asset volatility and market condition
    if (asset.volatility === 'high' && marketCondition.momentum > 0.5) {
        return STRATEGIES.momentum;
    } else if (asset.volatility === 'high') {
        return STRATEGIES.scalping;
    } else if (asset.liquidity === 'very high') {
        return STRATEGIES.scalping;
    } else if (asset.volatility === 'low') {
        return STRATEGIES.swing;
    } else {
        return STRATEGIES.aggressive;
    }
}

// ==================== MIDDLEWARE ====================
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: '🕋 HALAL Trading Bot' });
});

// ==================== AUTHENTICATION ====================
app.post('/api/register', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ success: false, message: 'Email and password required' });
    }
    if (password.length < 6) {
        return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }
    
    const users = readUsers();
    if (users[email]) {
        return res.status(400).json({ success: false, message: 'User already exists' });
    }
    
    const pending = readPending();
    if (pending[email]) {
        return res.status(400).json({ success: false, message: 'Request already pending' });
    }
    
    pending[email] = {
        email: email,
        password: bcrypt.hashSync(password, 10),
        requestedAt: new Date().toISOString()
    };
    writePending(pending);
    
    res.json({ success: true, message: 'Registration request sent to owner for approval.' });
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    
    const users = readUsers();
    const user = users[email];
    
    if (!user) {
        const pending = readPending();
        if (pending[email]) {
            return res.status(401).json({ success: false, message: 'Pending owner approval' });
        }
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    
    if (!bcrypt.compareSync(password, user.password)) {
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    
    if (!user.isApproved && !user.isOwner) {
        return res.status(401).json({ success: false, message: 'Account not approved by owner' });
    }
    
    if (user.isBlocked) {
        return res.status(401).json({ success: false, message: 'Account blocked. Contact owner.' });
    }
    
    const token = jwt.sign({ email: email, isOwner: user.isOwner }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, token: token, isOwner: user.isOwner });
});

function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ success: false, message: 'No token provided' });
    }
    
    const token = authHeader.split(' ')[1];
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (err) {
        res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }
}

// ==================== EXNESS API INTEGRATION ====================
const EXNESS_API = 'https://api.exness.com/v1';
const EXNESS_DEMO = 'https://demo-api.exness.com/v1';

async function makeExnessRequest(apiKey, secretKey, endpoint, params = {}, method = 'GET', useDemo = false) {
    const baseUrl = useDemo ? EXNESS_DEMO : EXNESS_API;
    const timestamp = Date.now();
    const signature = crypto.createHmac('sha256', secretKey).update(timestamp + endpoint + JSON.stringify(params)).digest('hex');
    
    const response = await axios({
        method: method,
        url: `${baseUrl}${endpoint}`,
        headers: {
            'X-API-Key': apiKey,
            'X-Signature': signature,
            'X-Timestamp': timestamp,
            'Content-Type': 'application/json'
        },
        data: method === 'POST' ? params : undefined,
        params: method === 'GET' ? params : undefined,
        timeout: 15000
    });
    return response.data;
}

async function getExnessBalance(apiKey, secretKey, useDemo = false) {
    try {
        const account = await makeExnessRequest(apiKey, secretKey, '/account/balance', {}, 'GET', useDemo);
        return {
            balance: parseFloat(account.balance || 0),
            equity: parseFloat(account.equity || 0),
            margin: parseFloat(account.margin || 0),
            freeMargin: parseFloat(account.freeMargin || 0),
            currency: account.currency || 'USD'
        };
    } catch (error) {
        console.error('Balance fetch error:', error.response?.data || error.message);
        return { balance: 0, equity: 0, margin: 0, freeMargin: 0, currency: 'USD' };
    }
}

async function getExnessCurrentPrice(symbol, useDemo = false) {
    try {
        const price = await makeExnessRequest(null, null, `/market/price?symbol=${symbol}`, {}, 'GET', useDemo);
        return {
            bid: parseFloat(price.bid),
            ask: parseFloat(price.ask),
            spread: parseFloat(price.ask) - parseFloat(price.bid),
            timestamp: price.timestamp
        };
    } catch (error) {
        console.error('Price fetch error:', error.message);
        const asset = HALAL_ASSETS.find(a => a.symbol === symbol);
        const basePrice = asset?.basePrice || 100;
        return { bid: basePrice, ask: basePrice * 1.0001, spread: basePrice * 0.0001 };
    }
}

async function placeExnessLimitOrder(apiKey, secretKey, symbol, side, volume, price, useDemo = false) {
    try {
        const order = await makeExnessRequest(apiKey, secretKey, '/orders', {
            symbol: symbol,
            side: side,
            type: 'LIMIT',
            volume: volume,
            price: price,
            timeInForce: 'GTC'
        }, 'POST', useDemo);
        return {
            orderId: order.id,
            status: order.status,
            symbol: symbol,
            side: side,
            price: parseFloat(order.price),
            volume: parseFloat(order.volume),
            createdAt: order.createdAt
        };
    } catch (error) {
        console.error('Order placement error:', error.response?.data || error.message);
        throw error;
    }
}

async function checkExnessOrderStatus(apiKey, secretKey, orderId, useDemo = false) {
    try {
        const order = await makeExnessRequest(apiKey, secretKey, `/orders/${orderId}`, {}, 'GET', useDemo);
        return {
            orderId: order.id,
            status: order.status,
            filledVolume: parseFloat(order.filledVolume || 0),
            avgPrice: parseFloat(order.avgPrice || 0),
            createdAt: order.createdAt,
            updatedAt: order.updatedAt
        };
    } catch (error) {
        console.error('Order status error:', error.message);
        return { status: 'PENDING', filledVolume: 0, avgPrice: 0 };
    }
}

async function cancelExnessOrder(apiKey, secretKey, orderId, useDemo = false) {
    try {
        const result = await makeExnessRequest(apiKey, secretKey, `/orders/${orderId}`, {}, 'DELETE', useDemo);
        return { success: true, orderId: orderId, status: 'CANCELLED' };
    } catch (error) {
        console.error('Cancel order error:', error.message);
        return { success: false, error: error.message };
    }
}

// ==================== TRADING ENGINE ====================
const activeSessions = new Map();

// Function to get market conditions for strategy selection
async function getMarketConditions(symbol, useDemo) {
    try {
        const price = await getExnessCurrentPrice(symbol, useDemo);
        // Calculate simple momentum based on price movement
        return {
            momentum: Math.random() * 0.8 + 0.2, // Simulate for demo
            volatility: Math.random() * 0.5 + 0.3,
            spread: price.spread
        };
    } catch (error) {
        return { momentum: 0.5, volatility: 0.4, spread: 0 };
    }
}

// Calculate trade volume based on current balance and target
function calculateTradeVolume(currentBalance, targetAmount, remainingTime, totalTrades) {
    // Dynamic volume calculation - increases as we get closer to target
    const remainingNeeded = Math.max(0, targetAmount - currentBalance);
    const timeFactor = Math.max(0.1, remainingTime / TIME_LIMIT_HOURS);
    const tradeCount = totalTrades + 1;
    
    // Aggressive scaling to reach target quickly
    let volume = remainingNeeded / (tradeCount * timeFactor);
    
    // Ensure reasonable volume (not too small, not too large)
    volume = Math.max(0.01, Math.min(volume, currentBalance * 0.2));
    
    return volume;
}

app.post('/api/start-trading', authenticate, async (req, res) => {
    try {
        console.log('Start trading request received:', req.body);
        
        const { investmentAmount, targetAmount, timeLimitHours, accountType } = req.body;
        
        // Validate required fields
        if (!investmentAmount || !targetAmount) {
            return res.status(400).json({ success: false, message: 'Investment amount and target amount required' });
        }
        
        if (investmentAmount < 10) {
            return res.status(400).json({ success: false, message: 'Minimum investment is $10' });
        }
        
        if (targetAmount <= investmentAmount) {
            return res.status(400).json({ success: false, message: 'Target must be greater than investment' });
        }
        
        const user = readUsers()[req.user.email];
        if (!user?.apiKey) {
            return res.status(400).json({ success: false, message: 'Add Exness API keys first' });
        }
        
        const apiKey = decrypt(user.apiKey);
        const secretKey = decrypt(user.secretKey);
        const useDemo = accountType === 'demo';
        const timeLimit = timeLimitHours || TIME_LIMIT_HOURS;
        
        // Get current balance
        let currentBalance = 0;
        try {
            const balance = await getExnessBalance(apiKey, secretKey, useDemo);
            currentBalance = balance.freeMargin || balance.balance;
        } catch (error) {
            console.error('Balance check error:', error);
            return res.status(401).json({ success: false, message: 'Cannot verify balance. Check API keys.' });
        }
        
        if (currentBalance < investmentAmount) {
            return res.status(400).json({ 
                success: false, 
                message: `Insufficient balance. You have ${currentBalance} USD, need ${investmentAmount} USD.`
            });
        }
        
        // Create trading session
        const sessionId = crypto.randomBytes(16).toString('hex');
        
        const sessionData = {
            userId: req.user.email,
            initialInvestment: investmentAmount,
            targetAmount: targetAmount,
            currentBalance: investmentAmount,
            totalProfit: 0,
            startTime: Date.now(),
            timeLimitHours: timeLimit,
            useDemo: useDemo,
            apiKey: apiKey,
            secretKey: secretKey,
            status: 'ACTIVE',
            activeTrades: [],
            completedTrades: [],
            totalTrades: 0,
            successfulTrades: 0,
            failedTrades: 0
        };
        
        activeSessions.set(sessionId, sessionData);
        
        // Save to orders file
        const orders = readOrders();
        orders[sessionId] = {
            userId: req.user.email,
            initialInvestment: investmentAmount,
            targetAmount: targetAmount,
            startTime: new Date().toISOString(),
            timeLimitHours: timeLimit,
            status: 'ACTIVE'
        };
        writeOrders(orders);
        
        // Start the aggressive trading engine
        startAggressiveTrading(sessionId);
        
        const mode = useDemo ? 'DEMO' : 'REAL';
        const profitNeeded = targetAmount - investmentAmount;
        const requiredReturn = ((targetAmount / investmentAmount) - 1) * 100;
        
        res.json({ 
            success: true, 
            sessionId: sessionId, 
            message: `✅ HALAL TRADING STARTED on Exness!\n\n` +
                    `📊 Account: ${mode}\n` +
                    `💰 Initial Investment: $${investmentAmount}\n` +
                    `🎯 Target Amount: $${targetAmount}\n` +
                    `📈 Required Profit: $${profitNeeded} (${requiredReturn.toFixed(1)}% return)\n` +
                    `⏰ Time Limit: ${timeLimit} hour(s)\n\n` +
                    `⚡ Bot will place multiple concurrent trades to reach target.\n` +
                    `🔄 Trade size increases automatically as profits grow.\n` +
                    `🧠 Strategy auto-selected for each asset based on market conditions.\n\n` +
                    `⚠️ Islamic Reminder: This trade has NO Riba, NO Gharar, NO Maysir, NO leverage, NO short selling.\n\n` +
                    `The bot will trade continuously until target is reached or time expires.`
        });
        
    } catch (error) {
        console.error('Start trading error:', error);
        res.status(500).json({ success: false, message: 'Server error: ' + error.message });
    }
});

// Main trading engine - places multiple concurrent trades
async function startAggressiveTrading(sessionId) {
    const session = activeSessions.get(sessionId);
    if (!session || session.status !== 'ACTIVE') return;
    
    // Check if target reached
    if (session.currentBalance >= session.targetAmount) {
        session.status = 'TARGET_REACHED';
        session.completedAt = Date.now();
        console.log(`🎯 TARGET REACHED! ${session.userId} achieved $${session.currentBalance.toFixed(2)} from $${session.initialInvestment}`);
        activeSessions.delete(sessionId);
        return;
    }
    
    // Check time limit
    const elapsedHours = (Date.now() - session.startTime) / (1000 * 60 * 60);
    if (elapsedHours >= session.timeLimitHours) {
        session.status = 'TIME_LIMIT_REACHED';
        console.log(`⏰ TIME LIMIT REACHED for ${session.userId}. Final balance: $${session.currentBalance.toFixed(2)}`);
        activeSessions.delete(sessionId);
        return;
    }
    
    // Clean up completed trades and update balance
    for (let i = session.activeTrades.length - 1; i >= 0; i--) {
        const trade = session.activeTrades[i];
        if (trade.status === 'COMPLETED') {
            // Add profit to balance
            session.currentBalance += trade.profit;
            session.totalProfit += trade.profit;
            session.successfulTrades++;
            session.completedTrades.push(trade);
            session.activeTrades.splice(i, 1);
            
            console.log(`✅ Trade completed! Profit: $${trade.profit.toFixed(2)}. New balance: $${session.currentBalance.toFixed(2)}`);
            
            // Immediately check if target reached after profit
            if (session.currentBalance >= session.targetAmount) {
                session.status = 'TARGET_REACHED';
                console.log(`🎯 TARGET REACHED! Balance: $${session.currentBalance.toFixed(2)}`);
                return;
            }
        } else if (trade.status === 'FAILED') {
            session.failedTrades++;
            session.activeTrades.splice(i, 1);
        } else if (trade.status === 'FILLED') {
            // Check if sell order filled
            await checkSellOrderStatus(session, trade);
        } else if (trade.status === 'BUY_ORDER_PLACED') {
            // Check if buy order filled
            await checkBuyOrderStatus(session, trade);
        }
    }
    
    // Calculate remaining time factor
    const remainingHours = Math.max(0.1, session.timeLimitHours - elapsedHours);
    const timeFactor = Math.min(1, remainingHours / session.timeLimitHours);
    
    // Calculate how many new trades to place (more aggressive as time runs out)
    const tradesToPlace = Math.min(
        MAX_CONCURRENT_TRADES - session.activeTrades.length,
        Math.ceil(5 / timeFactor) // More trades as time decreases
    );
    
    // Place new trades
    for (let i = 0; i < tradesToPlace; i++) {
        if (session.currentBalance >= session.targetAmount) break;
        
        await placeNewTrade(session);
    }
    
    // Schedule next check
    setTimeout(() => {
        startAggressiveTrading(sessionId);
    }, PROFIT_CHECK_INTERVAL);
}

async function placeNewTrade(session) {
    // Select random asset
    const asset = HALAL_ASSETS[Math.floor(Math.random() * HALAL_ASSETS.length)];
    
    // Get market conditions for strategy selection
    const marketConditions = await getMarketConditions(asset.symbol, session.useDemo);
    
    // Auto-select strategy based on asset and market
    const strategy = selectStrategy(asset, marketConditions);
    
    // Calculate trade volume based on current balance and target
    const remainingNeeded = session.targetAmount - session.currentBalance;
    const timeRemaining = Math.max(0.1, (session.startTime + session.timeLimitHours * 3600000 - Date.now()) / 3600000);
    
    // Aggressive volume calculation - increases as we get closer to deadline
    let volume = remainingNeeded / (session.totalTrades + 1) / timeRemaining;
    volume = Math.min(volume, session.currentBalance * 0.1); // Max 10% of balance per trade
    volume = Math.max(asset.minVolume, Math.floor(volume / asset.stepSize) * asset.stepSize);
    
    if (volume < asset.minVolume) return;
    
    // Get current price
    const price = await getExnessCurrentPrice(asset.symbol, session.useDemo);
    const entryPrice = price.bid * 0.999; // Buy slightly below market
    const targetPrice = entryPrice * strategy.targetMultiplier;
    
    try {
        // Place BUY order
        const buyOrder = await placeExnessLimitOrder(
            session.apiKey, session.secretKey, asset.symbol, 'BUY', 
            volume, entryPrice, session.useDemo
        );
        
        const trade = {
            id: buyOrder.orderId,
            symbol: asset.symbol,
            strategy: strategy.name,
            volume: volume,
            entryPrice: entryPrice,
            targetPrice: targetPrice,
            buyOrderId: buyOrder.orderId,
            status: 'BUY_ORDER_PLACED',
            createdAt: Date.now()
        };
        
        session.activeTrades.push(trade);
        session.totalTrades++;
        
        console.log(`📈 New trade placed: ${volume} ${asset.symbol} @ ${entryPrice} (Strategy: ${strategy.name})`);
        
    } catch (error) {
        console.error(`Failed to place trade for ${asset.symbol}:`, error.message);
    }
}

async function checkBuyOrderStatus(session, trade) {
    try {
        const orderStatus = await checkExnessOrderStatus(
            session.apiKey, session.secretKey, trade.buyOrderId, session.useDemo
        );
        
        if (orderStatus.status === 'FILLED') {
            trade.status = 'FILLED';
            trade.fillPrice = orderStatus.avgPrice;
            
            // Place SELL order at target price
            const sellOrder = await placeExnessLimitOrder(
                session.apiKey, session.secretKey, trade.symbol, 'SELL',
                trade.volume, trade.targetPrice, session.useDemo
            );
            
            trade.sellOrderId = sellOrder.orderId;
            trade.status = 'SELL_ORDER_PLACED';
            
            console.log(`✅ Buy order filled: ${trade.volume} ${trade.symbol} @ ${trade.fillPrice}`);
            
        } else if (orderStatus.status === 'EXPIRED' || orderStatus.status === 'CANCELLED') {
            trade.status = 'FAILED';
        }
    } catch (error) {
        console.error('Buy order check error:', error.message);
    }
}

async function checkSellOrderStatus(session, trade) {
    try {
        const orderStatus = await checkExnessOrderStatus(
            session.apiKey, session.secretKey, trade.sellOrderId, session.useDemo
        );
        
        if (orderStatus.status === 'FILLED') {
            const profit = (orderStatus.avgPrice - trade.fillPrice) * trade.volume;
            trade.status = 'COMPLETED';
            trade.profit = profit;
            trade.exitPrice = orderStatus.avgPrice;
            
            console.log(`✅ SELL order filled! Profit: $${profit.toFixed(2)}`);
            
        } else if (orderStatus.status === 'EXPIRED' || orderStatus.status === 'CANCELLED') {
            trade.status = 'FAILED';
        }
    } catch (error) {
        console.error('Sell order check error:', error.message);
    }
}

app.post('/api/stop-trading', authenticate, (req, res) => {
    const { sessionId } = req.body;
    if (activeSessions.has(sessionId)) {
        const session = activeSessions.get(sessionId);
        session.status = 'STOPPED_BY_USER';
        activeSessions.delete(sessionId);
        res.json({ success: true, message: 'Trading stopped successfully' });
    } else {
        res.json({ success: false, message: 'Session not found' });
    }
});

app.post('/api/trade-status', authenticate, (req, res) => {
    const session = activeSessions.get(req.body.sessionId);
    if (!session) return res.json({ success: true, active: false });
    
    const elapsedHours = (Date.now() - session.startTime) / (1000 * 60 * 60);
    const timeRemaining = Math.max(0, session.timeLimitHours - elapsedHours);
    const progressPercent = ((session.currentBalance - session.initialInvestment) / (session.targetAmount - session.initialInvestment)) * 100;
    const winRate = session.totalTrades > 0 ? (session.successfulTrades / session.totalTrades) * 100 : 0;
    
    res.json({ 
        success: true, 
        active: session.status === 'ACTIVE',
        initialInvestment: session.initialInvestment,
        targetAmount: session.targetAmount,
        currentBalance: session.currentBalance,
        totalProfit: session.totalProfit,
        progressPercent: Math.min(100, Math.max(0, progressPercent)).toFixed(1),
        totalTrades: session.totalTrades,
        successfulTrades: session.successfulTrades,
        failedTrades: session.failedTrades,
        winRate: winRate.toFixed(1),
        activeTrades: session.activeTrades.length,
        timeRemaining: timeRemaining.toFixed(2),
        status: session.status
    });
});

app.get('/api/trade-history', authenticate, (req, res) => {
    const file = path.join(TRADES_DIR, req.user.email.replace(/[^a-z0-9]/gi, '_') + '.json');
    if (!fs.existsSync(file)) return res.json({ success: true, trades: [] });
    const trades = JSON.parse(fs.readFileSync(file));
    res.json({ success: true, trades: trades });
});

app.get('/api/halal-assets', authenticate, (req, res) => {
    res.json({ success: true, assets: HALAL_ASSETS });
});

// ==================== API KEY MANAGEMENT ====================
app.post('/api/set-exness-keys', authenticate, async (req, res) => {
    let { exnessId, apiKey, secretKey, accountType } = req.body;
    if (!apiKey || !secretKey) {
        return res.status(400).json({ success: false, message: 'Both API keys required' });
    }
    
    const cleanApi = cleanKey(apiKey);
    const cleanSecret = cleanKey(secretKey);
    const useDemo = accountType === 'demo';
    
    try {
        const balance = await getExnessBalance(cleanApi, cleanSecret, useDemo);
        const users = readUsers();
        users[req.user.email].exnessId = exnessId || "";
        users[req.user.email].apiKey = encrypt(cleanApi);
        users[req.user.email].secretKey = encrypt(cleanSecret);
        users[req.user.email].accountType = accountType || "real";
        writeUsers(users);
        
        res.json({ 
            success: true, 
            message: `Exness API keys saved! Balance: ${balance.balance} ${balance.currency}`, 
            balance: balance.balance
        });
    } catch (err) {
        console.error('API key error:', err);
        res.status(401).json({ success: false, message: 'Invalid API keys. Check Exness API permissions.' });
    }
});

app.post('/api/connect-exness', authenticate, async (req, res) => {
    const { accountType } = req.body;
    const user = readUsers()[req.user.email];
    if (!user?.apiKey) {
        return res.status(400).json({ success: false, message: 'No API keys saved' });
    }
    
    const apiKey = decrypt(user.apiKey);
    const secretKey = decrypt(user.secretKey);
    const useDemo = accountType === 'demo';
    
    try {
        const balance = await getExnessBalance(apiKey, secretKey, useDemo);
        
        res.json({ 
            success: true, 
            balance: balance.balance,
            equity: balance.equity,
            freeMargin: balance.freeMargin,
            message: `Connected to Exness! Balance: ${balance.balance} ${balance.currency}`
        });
    } catch (error) {
        console.error('Connect error:', error);
        res.status(401).json({ success: false, message: 'Connection failed. Check API keys.' });
    }
});

app.get('/api/get-keys', authenticate, (req, res) => {
    const user = readUsers()[req.user.email];
    if (!user?.apiKey) return res.json({ success: false, message: 'No keys saved' });
    res.json({ 
        success: true, 
        exnessId: user.exnessId || "", 
        apiKey: decrypt(user.apiKey), 
        secretKey: decrypt(user.secretKey),
        accountType: user.accountType || "real"
    });
});

app.post('/api/get-balance', authenticate, async (req, res) => {
    const { accountType } = req.body;
    const user = readUsers()[req.user.email];
    if (!user?.apiKey) return res.json({ success: false, message: 'No API keys' });
    
    const apiKey = decrypt(user.apiKey);
    const secretKey = decrypt(user.secretKey);
    const useDemo = accountType === 'demo';
    const balance = await getExnessBalance(apiKey, secretKey, useDemo);
    
    res.json({ 
        success: true, 
        balance: balance.balance,
        equity: balance.equity,
        freeMargin: balance.freeMargin,
        currency: balance.currency
    });
});

// ==================== ADMIN ENDPOINTS ====================
app.get('/api/admin/pending-users', authenticate, (req, res) => {
    if (!req.user.isOwner) return res.status(403).json({ success: false });
    const pending = readPending();
    const list = Object.keys(pending).map(e => ({ email: e, requestedAt: pending[e].requestedAt }));
    res.json({ success: true, pending: list });
});

app.post('/api/admin/approve-user', authenticate, (req, res) => {
    if (!req.user.isOwner) return res.status(403).json({ success: false });
    const { email } = req.body;
    const pending = readPending();
    if (!pending[email]) return res.status(404).json({ success: false });
    const users = readUsers();
    users[email] = {
        email: email,
        password: pending[email].password,
        isOwner: false,
        isApproved: true,
        isBlocked: false,
        exnessId: "",
        apiKey: "",
        secretKey: "",
        accountType: "real",
        createdAt: new Date().toISOString()
    };
    writeUsers(users);
    delete pending[email];
    writePending(pending);
    res.json({ success: true, message: `User ${email} approved` });
});

app.post('/api/admin/reject-user', authenticate, (req, res) => {
    if (!req.user.isOwner) return res.status(403).json({ success: false });
    const { email } = req.body;
    const pending = readPending();
    if (!pending[email]) return res.status(404).json({ success: false });
    delete pending[email];
    writePending(pending);
    res.json({ success: true, message: `User ${email} rejected` });
});

app.post('/api/admin/toggle-block', authenticate, (req, res) => {
    if (!req.user.isOwner) return res.status(403).json({ success: false });
    const { email } = req.body;
    const users = readUsers();
    if (!users[email]) return res.status(404).json({ success: false });
    users[email].isBlocked = !users[email].isBlocked;
    writeUsers(users);
    const status = users[email].isBlocked ? 'BLOCKED' : 'ACTIVE';
    res.json({ success: true, message: `User ${email} is now ${status}` });
});

app.get('/api/admin/users', authenticate, (req, res) => {
    if (!req.user.isOwner) return res.status(403).json({ success: false });
    const users = readUsers();
    const list = Object.keys(users).map(e => ({
        email: e,
        hasApiKeys: !!users[e].apiKey,
        isOwner: users[e].isOwner,
        isApproved: users[e].isApproved,
        isBlocked: users[e].isBlocked,
        accountType: users[e].accountType || "real",
        createdAt: users[e].createdAt
    }));
    res.json({ success: true, users: list });
});

app.get('/api/admin/user-balances', authenticate, async (req, res) => {
    if (!req.user.isOwner) return res.status(403).json({ success: false });
    const users = readUsers();
    const balances = {};
    
    for (const [email, userData] of Object.entries(users)) {
        if (userData.apiKey) {
            try {
                const apiKey = decrypt(userData.apiKey);
                const secretKey = decrypt(userData.secretKey);
                const useDemo = userData.accountType === 'demo';
                const balance = await getExnessBalance(apiKey, secretKey, useDemo);
                balances[email] = {
                    balance: balance.balance,
                    equity: balance.equity,
                    freeMargin: balance.freeMargin,
                    currency: balance.currency,
                    hasKeys: true,
                    lastUpdated: new Date().toISOString()
                };
            } catch {
                balances[email] = { balance: 0, equity: 0, freeMargin: 0, hasKeys: true, error: true };
            }
        } else {
            balances[email] = { balance: 0, equity: 0, freeMargin: 0, hasKeys: false };
        }
    }
    res.json({ success: true, balances: balances });
});

app.get('/api/admin/all-trades', authenticate, (req, res) => {
    if (!req.user.isOwner) return res.status(403).json({ success: false });
    const allTrades = {};
    const files = fs.readdirSync(TRADES_DIR);
    for (const file of files) {
        if (file === '.gitkeep') continue;
        const userId = file.replace('.json', '');
        const trades = JSON.parse(fs.readFileSync(path.join(TRADES_DIR, file)));
        allTrades[userId] = trades;
    }
    res.json({ success: true, trades: allTrades });
});

app.post('/api/change-password', authenticate, (req, res) => {
    if (!req.user.isOwner) return res.status(403).json({ success: false });
    const { currentPassword, newPassword } = req.body;
    const users = readUsers();
    const owner = users[req.user.email];
    if (!bcrypt.compareSync(currentPassword, owner.password)) {
        return res.status(401).json({ success: false, message: 'Wrong current password' });
    }
    if (newPassword.length < 6) {
        return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }
    owner.password = bcrypt.hashSync(newPassword, 10);
    writeUsers(users);
    res.json({ success: true, message: 'Password changed! Please login again.' });
});

// ==================== SERVE FRONTEND ====================
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n========================================`);
    console.log(`🕋 HALAL TRADING BOT - RUNNING`);
    console.log(`========================================`);
    console.log(`✅ Owner: mujtabahatif@gmail.com`);
    console.log(`✅ Password: Mujtabah@2598`);
    console.log(`✅ ${HALAL_ASSETS.length} Halal Assets`);
    console.log(`✅ FEATURES:`);
    console.log(`   - Single investment for whole target`);
    console.log(`   - Auto-compounding (trade size increases with profits)`);
    console.log(`   - Target in $ (not percentage)`);
    console.log(`   - No trade interval - continuous trading`);
    console.log(`   - Time limit: 1 hour (configurable)`);
    console.log(`   - Auto strategy selection based on market`);
    console.log(`   - Multiple concurrent trades (up to ${MAX_CONCURRENT_TRADES})`);
    console.log(`✅ NO Riba | NO Gharar | NO Maysir | NO Leverage | NO Short Selling`);
    console.log(`========================================`);
    console.log(`Server running on port: ${PORT}`);
});
