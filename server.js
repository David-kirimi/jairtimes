const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const crypto = require('crypto');
const axios = require('axios');
const admin = require('firebase-admin');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

app.use(express.json());
app.use(session({
    name: 'jairtimes_sid',
    secret: process.env.SESSION_SECRET || 'change_me_to_a_strong_secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 1000 * 60 * 60 * 4
    }
}));
app.use(express.static(path.join(__dirname, 'public')));

let firestore = null;

const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const CUSTOMERS_FILE = path.join(DATA_DIR, 'customers.json');

function ensureDataDirectory() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

function loadJson(filePath, fallback) {
    try {
        if (!fs.existsSync(filePath)) return fallback;
        const raw = fs.readFileSync(filePath, 'utf8');
        return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
        console.error(`Unable to read ${filePath}:`, err);
        return fallback;
    }
}

function saveJson(filePath, payload) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
    } catch (err) {
        console.error(`Unable to write ${filePath}:`, err);
    }
}

ensureDataDirectory();

const defaultConfig = {
    darajaBaseUrl: 'https://api.safaricom.co.ke',
    talksasaUrl: 'https://api.talksasa.com/v1/sms/send',
    talksasaApiKey: '',
    talksasaSender: 'JAirtimes',
    firebaseDatabaseUrl: '',
    firebaseProjectId: '',
    firebaseClientEmail: '',
    firebasePrivateKey: '',
    adminUser: process.env.ADMIN_USER || 'admin',
    adminPass: process.env.ADMIN_PASS || 'Password123',
    bundles: [
        { code: 1, amount: 10, commissionRate: 0.10 },
        { code: 2, amount: 20, commissionRate: 0.10 },
        { code: 3, amount: 50, commissionRate: 0.10 }
    ],
    commissionPayoutDay: 'Friday',
    commissionPayoutTime: '09:00'
};

const appConfig = {
    ...defaultConfig,
    ...loadJson(CONFIG_FILE, {})
};

function buildDarajaUrls() {
    const base = appConfig.darajaBaseUrl || 'https://api.safaricom.co.ke';
    return {
        oauth: `${base}/oauth/v1/generate?grant_type=client_credentials`,
        c2bV2Register: `${base}/mpesa/c2b/v2/registerurl`,
        c2bV1Register: `${base}/mpesa/c2b/v1/registerurl`,
        transactionStatus: `${base}/mpesa/transactionstatus/v1/query`,
        accountBalance: `${base}/mpesa/accountbalance/v1/query`,
        stkPush: `${base}/mpesa/stkpush/v1/processrequest`,
        stkPushQuery: `${base}/mpesa/stkpushquery/v1/query`,
        reversal: `${base}/mpesa/reversal/v1/request`
    };
}

let DARAJA_URLS = buildDarajaUrls();

function parseFirebasePrivateKey(value) {
    return String(value || '').replace(/\\n/g, '\n');
}

function initFirebase() {
    const fromEnvJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const fromEnvPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    let credentials = null;

    if (fromEnvJson) {
        try {
            credentials = JSON.parse(fromEnvJson);
        } catch (err) {
            console.error('Invalid FIREBASE_SERVICE_ACCOUNT_JSON', err);
        }
    } else if (fromEnvPath && fs.existsSync(fromEnvPath)) {
        try {
            credentials = JSON.parse(fs.readFileSync(fromEnvPath, 'utf8'));
        } catch (err) {
            console.error('Unable to read FIREBASE_SERVICE_ACCOUNT_PATH', err);
        }
    }

    if (!credentials) {
        const projectId = appConfig.firebaseProjectId || process.env.FIREBASE_PROJECT_ID;
        const clientEmail = appConfig.firebaseClientEmail || process.env.FIREBASE_CLIENT_EMAIL;
        const privateKey = parseFirebasePrivateKey(appConfig.firebasePrivateKey || process.env.FIREBASE_PRIVATE_KEY);
        if (projectId && clientEmail && privateKey) {
            credentials = { projectId, clientEmail, privateKey };
        }
    }

    const databaseURL = appConfig.firebaseDatabaseUrl || process.env.FIREBASE_DATABASE_URL;

    if (credentials) {
        try {
            if (!admin.apps.length) {
                admin.initializeApp({
                    credential: admin.credential.cert(credentials),
                    databaseURL: databaseURL || undefined
                });
            }
            firestore = admin.firestore();
            emitSystemLog('SYSTEM', 'Firebase initialized successfully.');
        } catch (err) {
            console.error('Firebase initialization failed:', err);
            emitSystemLog('ERROR', `Firebase init failed: ${err.message}`);
        }
    }
}

initFirebase();

function saveConfig(payload) {
    Object.assign(appConfig, payload);
    saveJson(CONFIG_FILE, appConfig);
    DARAJA_URLS = buildDarajaUrls();
    if (!firestore) initFirebase();
}

function loadCustomers() {
    return loadJson(CUSTOMERS_FILE, []);
}

function saveCustomers(customers) {
    saveJson(CUSTOMERS_FILE, customers);
}



async function persistCustomer(customer) {
    const customers = loadCustomers();
    const index = customers.findIndex((item) => item.msisdn === customer.msisdn);
    if (index >= 0) {
        customers[index] = { ...customers[index], ...customer, updatedAt: new Date().toISOString() };
    } else {
        customers.unshift({ ...customer, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    }
    saveCustomers(customers);

    if (firestore) {
        try {
            await firestore.collection('customers').doc(customer.msisdn).set({ ...customer, updatedAt: new Date().toISOString() }, { merge: true });
        } catch (err) {
            emitSystemLog('ERROR', `Firebase customer save failed: ${err.message}`);
        }
    }
}

async function fetchCustomers() {
    if (firestore) {
        try {
            const snapshot = await firestore.collection('customers').orderBy('updatedAt', 'desc').limit(200).get();
            return snapshot.docs.map((doc) => ({ msisdn: doc.id, ...doc.data() }));
        } catch (err) {
            emitSystemLog('ERROR', `Firebase customer fetch failed: ${err.message}`);
        }
    }
    return loadCustomers();
}

let accountBalance = 0;
let isAndroidOnline = false;
let gatewaySocketId = null;

function emitSystemLog(logType, logMessage) {
    const systemLog = {
        id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 11).toUpperCase(),
        time: new Date().toISOString(),
        type: logType,
        message: logMessage
    };
    io.emit('new_system_log', systemLog);
}

// Store transaction reports in Firebase
async function storeTransaction(transactionData) {
    if (firestore) {
        try {
            const transactionId = transactionData.id || crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 11).toUpperCase();
            await firestore.collection('transactions').doc(transactionId).set({
                ...transactionData,
                timestamp: new Date().toISOString(),
                recordedAt: new Date()
            });
        } catch (err) {
            console.error('Failed to store transaction:', err);
        }
    }
}

// Update performance metrics in Firebase
async function updatePerformanceMetrics() {
    if (firestore) {
        try {
            await firestore.collection('performance').doc('daily_metrics').set({
                totalTransactions: totalTransactions,
                commissionEarned: commissionEarned,
                profitsGenerated: profitsGenerated,
                lastUpdated: new Date()
            }, { merge: true });
        } catch (err) {
            console.error('Failed to update performance metrics:', err);
        }
    }
}

// Store partner payout records in Firebase
async function storePartnerPayout(msisdn, payoutAmount) {
    if (firestore) {
        try {
            const payoutId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 11).toUpperCase();
            await firestore.collection('payouts').doc(payoutId).set({
                partner: msisdn,
                amount: payoutAmount,
                status: 'completed',
                timestamp: new Date()
            });
        } catch (err) {
            console.error('Failed to store partner payout:', err);
        }
    }
}

// --- PRODUCTION DARAJA CREDENTIAL CONFIGURATION ---
const CONSUMER_KEY = process.env.DARAJA_CONSUMER_KEY || "YOUR_LIVE_CONSUMER_KEY";
const CONSUMER_SECRET = process.env.DARAJA_CONSUMER_SECRET || "YOUR_LIVE_CONSUMER_SECRET";
const SHORTCODE = process.env.DARAJA_SHORTCODE || "YOUR_TILL_OR_PAYBILL";
const PASSKEY = process.env.DARAJA_PASSKEY || "YOUR_LIPA_NA_MPESA_PASSKEY";
const HOST_URL = process.env.HOST_URL || process.env.RENDER_EXTERNAL_URL || "https://your-app.onrender.com";

// Security credentials for balance & status queries (Generated via Safaricom Portal)
const INITIATOR_NAME = process.env.DARAJA_INITIATOR_NAME || "YOUR_API_INITIATOR_NAME";
const SECURITY_CREDENTIAL = process.env.DARAJA_SECURITY_CREDENTIAL || "YOUR_ENCRYPTED_INITIATOR_PASSWORD";

let commissionEarned = 0;
let profitsGenerated = 0;
let totalTransactions = 0;
let partnerCommissions = {};
let weeklyPayoutLog = [];

// --- ACCESS TOKEN GENERATION ---
async function getDarajaToken() {
    const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
    try {
        const response = await axios.get(DARAJA_URLS.oauth, {
            headers: { Authorization: `Basic ${auth}` }
        });
        return response.data.access_token;
    } catch (err) {
        emitSystemLog("ERROR", `OAuth Failure: ${err.message}`);
        throw err;
    }
}

// --- SOCKET.IO HANDSHAKE ---
io.on('connection', (socket) => {
    const clientType = socket.handshake.query.type;

    if (clientType === 'android_gateway') {
        isAndroidOnline = true;
        gatewaySocketId = socket.id;
        io.emit('gateway_status_update', true);
        socket.emit('balance_snapshot', accountBalance);
        socket.emit('metrics_update', { commission: commissionEarned.toFixed(2), profits: profitsGenerated.toFixed(2), transactions: totalTransactions });
        emitSystemLog("GATEWAY", "Android physical gateway device connected and online.");
    } else {
        socket.emit('gateway_status_update', isAndroidOnline);
        socket.emit('balance_snapshot', accountBalance);
        socket.emit('metrics_update', { commission: commissionEarned.toFixed(2), profits: profitsGenerated.toFixed(2), transactions: totalTransactions });
    }

    socket.on('disconnect', () => {
        if (clientType === 'android_gateway' && socket.id === gatewaySocketId) {
            isAndroidOnline = false;
            gatewaySocketId = null;
            io.emit('gateway_status_update', false);
            emitSystemLog("ERROR", "Android gateway disconnected.");
        }
    });
});

// --- ADMIN AUTHENTICATION MIDDLEWARE ---
function requireAdmin(req, res, next) {
    if (!req.session || !req.session.adminAuthenticated) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    next();
}

app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body || {};
    if (username === appConfig.adminUser && password === appConfig.adminPass) {
        req.session.adminAuthenticated = true;
        return res.status(200).json({ success: true });
    }
    res.status(401).json({ success: false, error: 'Invalid credentials' });
});

app.get('/api/admin/config', requireAdmin, (req, res) => {
    res.json({
        darajaKey: CONSUMER_KEY,
        darajaSecret: CONSUMER_SECRET,
        shortcode: SHORTCODE,
        talksasaApiKey: appConfig.talksasaApiKey,
        talksasaSender: appConfig.talksasaSender,
        firebaseProjectId: appConfig.firebaseProjectId,
        firebaseDatabaseUrl: appConfig.firebaseDatabaseUrl
    });
});

app.post('/api/admin/config/daraja', requireAdmin, (req, res) => {
    const { darajaKey, darajaSecret, shortcode } = req.body;
    Object.assign(appConfig, { darajaKey, darajaSecret, shortcode });
    saveConfig(appConfig);
    emitSystemLog('SYSTEM', 'Daraja configuration updated');
    res.json({ success: true });
});

app.post('/api/admin/config/talksasa', requireAdmin, (req, res) => {
    const { talksasaApiKey, talksasaSender } = req.body;
    Object.assign(appConfig, { talksasaApiKey, talksasaSender });
    saveConfig(appConfig);
    emitSystemLog('SYSTEM', 'Talksasa configuration updated');
    res.json({ success: true });
});

app.post('/api/admin/config/firebase', requireAdmin, (req, res) => {
    const { firebaseProjectId, firebaseDatabaseUrl } = req.body;
    Object.assign(appConfig, { firebaseProjectId, firebaseDatabaseUrl });
    saveConfig(appConfig);
    initFirebase();
    emitSystemLog('SYSTEM', 'Firebase configuration updated');
    res.json({ success: true });
});

app.post('/api/admin/credentials', requireAdmin, (req, res) => {
    const { username, password } = req.body;
    if (username && password) {
        appConfig.adminUser = username;
        appConfig.adminPass = password;
        saveConfig(appConfig);
        emitSystemLog('SYSTEM', 'Admin credentials updated');
        return res.json({ success: true });
    }
    res.status(400).json({ success: false, error: 'Username and password required' });
});

app.get('/api/admin/partners', requireAdmin, (req, res) => {
    const partners = Object.entries(partnerCommissions).map(([msisdn, data]) => ({
        msisdn,
        ...data
    }));
    res.json(partners);
});

app.post('/api/admin/payout', requireAdmin, async (req, res) => {
    const { msisdn } = req.body;
    if (!partnerCommissions[msisdn]) {
        return res.status(404).json({ success: false, error: 'Partner not found' });
    }

    const partner = partnerCommissions[msisdn];
    const payoutAmount = parseFloat(partner.pending);

    if (payoutAmount <= 0) {
        return res.status(400).json({ success: false, error: 'No pending commission' });
    }

    try {
        partner.paid += payoutAmount;
        partner.pending = 0;
        weeklyPayoutLog.push({
            msisdn,
            amount: payoutAmount,
            date: new Date().toISOString(),
            status: 'completed'
        });

        // Store payout record in Firebase
        storePartnerPayout(msisdn, payoutAmount);

        if (appConfig.talksasaApiKey && appConfig.talksasaUrl) {
            await axios.post(appConfig.talksasaUrl, {
                apikey: appConfig.talksasaApiKey,
                to: msisdn,
                message: `JAirtimes: Your weekly commission of Ksh ${payoutAmount.toFixed(2)} has been processed. Total earned: Ksh ${partner.paid.toFixed(2)}`
            });
        }

        emitSystemLog('SYSTEM', `Partner ${msisdn} weekly payout processed: Ksh ${payoutAmount.toFixed(2)}`);
        res.json({ success: true });
    } catch (err) {
        emitSystemLog('ERROR', `Payout failed for ${msisdn}: ${err.message}`);
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- DARAJA API INTERACTIONS & WEBHOOKS ---

// 1. C2B URL Registration Action Endpoint
app.post('/api/mpesa/register-urls', async (req, res) => {
    try {
        const token = await getDarajaToken();
        const response = await axios.post(DARAJA_URLS.c2bV2Register, {
            ShortCode: SHORTCODE,
            ResponseType: "Completed",
            ConfirmationURL: `${HOST_URL}/api/mpesa/confirmation`,
            ValidationURL: `${HOST_URL}/api/mpesa/validation`
        }, {
            headers: { Authorization: `Bearer ${token}` }
        });
        emitSystemLog("SYSTEM", `C2B URL Registration Status: ${JSON.stringify(response.data)}`);
        res.status(200).json({ success: true, data: response.data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 2. C2B Validation
app.post('/api/mpesa/validation', (req, res) => {
    res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
});

// 3. C2B Confirmation Webhook (Triggers Device Automation)
app.post('/api/mpesa/confirmation', (req, res) => {
    const payload = req.body;
    const amountPaid = parseFloat(payload.TransAmount || 0);
    const customerNumber = payload.MSISDN;
    const mpesaReceipt = payload.TransID;
    const partnerPhone = payload.ReferencedReferredCustomer || null;
    
    accountBalance = parseFloat(payload.OrgAccountBalance || accountBalance);
    io.emit('balance_snapshot', accountBalance);
    
    totalTransactions += 1;
    
    const matchedBundle = appConfig.bundles.find(b => b.amount === amountPaid);
    if (matchedBundle) {
        const bundleCommission = matchedBundle.amount * matchedBundle.commissionRate;
        commissionEarned += bundleCommission;
        profitsGenerated += amountPaid * 0.01;
        
        if (partnerPhone) {
            if (!partnerCommissions[partnerPhone]) {
                partnerCommissions[partnerPhone] = { name: partnerPhone, pending: 0, paid: 0, sales: 0 };
            }
            partnerCommissions[partnerPhone].pending += bundleCommission;
            partnerCommissions[partnerPhone].sales += 1;
            emitSystemLog("TRANSACTION", `Bundle Ksh ${amountPaid} sold via partner ${partnerPhone}. Commission: Ksh ${bundleCommission.toFixed(2)}`);
            storeTransaction({
                type: 'bundle_sale',
                amount: amountPaid,
                bundleCode: matchedBundle.code,
                commission: bundleCommission,
                partnerPhone: partnerPhone,
                customerNumber: customerNumber,
                mpesaReceipt: mpesaReceipt
            });
        } else {
            emitSystemLog("TRANSACTION", `Bundle Ksh ${amountPaid} confirmed from ${customerNumber}. Commission: Ksh ${bundleCommission.toFixed(2)}. ID: ${mpesaReceipt}`);
            storeTransaction({
                type: 'bundle_purchase',
                amount: amountPaid,
                bundleCode: matchedBundle.code,
                commission: bundleCommission,
                customerNumber: customerNumber,
                mpesaReceipt: mpesaReceipt
            });
        }
    } else {
        emitSystemLog("TRANSACTION", `Payment Ksh ${amountPaid} from ${customerNumber}. ID: ${mpesaReceipt}`);
        storeTransaction({
            type: 'payment',
            amount: amountPaid,
            customerNumber: customerNumber,
            mpesaReceipt: mpesaReceipt
        });
    }
    
    updatePerformanceMetrics();
    
    io.emit('metrics_update', { 
        commission: commissionEarned.toFixed(2), 
        profits: profitsGenerated.toFixed(2), 
        transactions: totalTransactions,
        partnerCommissions: partnerCommissions
    });

    // Package triggers mapping rules matrix
    let dialString = "";
    if (amountPaid === 10) dialString = "*544*1*1#";
    if (amountPaid === 20) dialString = "*544*2*1#";
    if (amountPaid === 50) dialString = "*544*3*2#";

    if (dialString) {
        if (isAndroidOnline && gatewaySocketId) {
            emitSystemLog("GATEWAY", `Command dispatched -> Dialing ${dialString} for target line ${customerNumber}`);
            io.to(gatewaySocketId).emit('execute_ussd_command', { code: dialString, phone: customerNumber });
        } else {
            emitSystemLog("ERROR", `Failed auto-trigger: Android Gateway device is offline.`);
        }
    }
    res.status(200).json({ ResultCode: 0, ResultDesc: "Success" });
});

app.post('/api/mpesa/stk-push', async (req, res) => {
    const { phone, amount } = req.body || {};
    const sanitizedPhone = String(phone || '').replace(/\D/g, '');
    const sanitizedAmount = Number(amount);

    if (!sanitizedPhone || !sanitizedAmount || sanitizedAmount <= 0) {
        return res.status(400).json({ success: false, error: 'phone and amount are required' });
    }

    try {
        const token = await getDarajaToken();
        const timestamp = new Date().toISOString().replace(/[-:TZ]/g, '').slice(0, 14);
        const password = Buffer.from(`${SHORTCODE}${PASSKEY}${timestamp}`).toString('base64');

        const response = await axios.post(
            DARAJA_URLS.stkPush,
            {
                BusinessShortCode: SHORTCODE,
                Password: password,
                Timestamp: timestamp,
                TransactionType: 'CustomerPayBillOnline',
                Amount: sanitizedAmount,
                PartyA: sanitizedPhone,
                PartyB: SHORTCODE,
                PhoneNumber: sanitizedPhone,
                CallBackURL: `${HOST_URL}/api/mpesa/stk-push-result`,
                AccountReference: 'JAirtimes',
                TransactionDesc: 'Manual STK Push from dashboard'
            },
            {
                headers: { Authorization: `Bearer ${token}` }
            }
        );

        emitSystemLog('SYSTEM', `Manual STK Push requested for ${sanitizedPhone} amount Ksh ${sanitizedAmount}`);
        res.status(200).json({ success: true, data: response.data });
    } catch (err) {
        emitSystemLog('ERROR', `STK Push failure: ${err.message}`);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 4. Query Account Balance Programmatically
app.post('/api/mpesa/query-balance', async (req, res) => {
    try {
        const token = await getDarajaToken();
        const response = await axios.post(DARAJA_URLS.accountBalance, {
            Initiator: INITIATOR_NAME,
            SecurityCredential: SECURITY_CREDENTIAL,
            CommandID: "AccountBalance",
            PartyA: SHORTCODE,
            IdentifierType: "4", // 4 is for Shortcode
            Remarks: "Dashboard Query",
            QueueTimeOutURL: `${HOST_URL}/api/mpesa/queue-timeout`,
            ResultURL: `${HOST_URL}/api/mpesa/balance-result`
        }, {
            headers: { Authorization: `Bearer ${token}` }
        });
        res.status(200).json({ success: true, message: "Balance query request sent to Safaricom.", data: response.data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 5. Query Specific Transaction Status
app.post('/api/mpesa/query-status', async (req, res) => {
    const { transactionId } = req.body;
    try {
        const token = await getDarajaToken();
        const response = await axios.post(DARAJA_URLS.transactionStatus, {
            Initiator: INITIATOR_NAME,
            SecurityCredential: SECURITY_CREDENTIAL,
            CommandID: "TransactionStatusQuery",
            TransactionID: transactionId,
            PartyA: SHORTCODE,
            IdentifierType: "4",
            Remarks: "Dashboard Status Check",
            Occasion: "Verification",
            QueueTimeOutURL: `${HOST_URL}/api/mpesa/queue-timeout`,
            ResultURL: `${HOST_URL}/api/mpesa/status-result`
        }, {
            headers: { Authorization: `Bearer ${token}` }
        });
        res.status(200).json({ success: true, message: "Status check sent.", data: response.data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- SAFARICOM ASYNCHRONOUS RESULT RECEIVERS ---
app.post('/api/mpesa/balance-result', (req, res) => {
    emitSystemLog("SYSTEM", `Account Balance Result Payload: ${JSON.stringify(req.body.Result)}`);
    res.status(200).json("OK");
});

app.post('/api/mpesa/status-result', (req, res) => {
    emitSystemLog("SYSTEM", `Transaction Status Result Payload: ${JSON.stringify(req.body.Result)}`);
    res.status(200).json("OK");
});

app.post('/api/mpesa/queue-timeout', (req, res) => {
    emitSystemLog("WARNING", "Safaricom asynchronous timeout event occurred.");
    res.status(200).json("OK");
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Production Broker running on port ${PORT}`));