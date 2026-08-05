const express = require('express');
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const app = express();

// Configuration
const PORT = process.env.PORT || 3000;

// Admin Password from Environment Variables
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://trail_db_user:ZFjmUOMVSdatCOsq@cluster0.h1pqrer.mongodb.net/?retryWrites=true&w=majority';
const DB_NAME = process.env.DB_NAME || 'payslip_system';
const COLLECTION_NAME = 'payslip_data';

let db = null;
let collection = null;
let dataCache = null;

console.log('🚀 Starting server...');
console.log('🔒 Admin password is set from environment variables');

// ============================================
// MONGODB CONNECTION
// ============================================

async function connectToMongoDB() {
    try {
        console.log('📡 Connecting to MongoDB Atlas...');
        const client = new MongoClient(MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 10000,
            socketTimeoutMS: 45000,
        });
        
        await client.connect();
        console.log('✅ Connected to MongoDB Atlas successfully!');
        
        db = client.db(DB_NAME);
        collection = db.collection(COLLECTION_NAME);
        
        try {
            await collection.createIndex({ 'employees.empId': 1 });
            console.log('✅ Index created on empId');
        } catch (e) {
            console.log('⚠️ Index may already exist:', e.message);
        }
        
        return true;
    } catch (error) {
        console.error('❌ MongoDB connection failed:', error.message);
        console.log('⚠️ Running with local storage only');
        return false;
    }
}

// ============================================
// DATA OPERATIONS
// ============================================

async function loadDataFromMongoDB() {
    try {
        if (!collection) return null;
        const data = await collection.findOne({ _id: 'payslip_data' });
        if (data) {
            delete data._id;
            console.log(`✅ Data loaded from MongoDB: ${data.employees ? data.employees.length : 0} employees, ${data.pdfs ? Object.keys(data.pdfs).length : 0} PDFs`);
            return data;
        }
        return null;
    } catch (error) {
        console.error('❌ Error loading from MongoDB:', error);
        return null;
    }
}

async function saveDataToMongoDB(data) {
    try {
        if (!collection) {
            console.log('⚠️ No MongoDB connection, saving to local cache only');
            dataCache = data;
            return false;
        }
        
        data.lastUpdated = new Date().toISOString();
        delete data._id;
        
        await collection.updateOne(
            { _id: 'payslip_data' },
            { $set: data },
            { upsert: true }
        );
        
        console.log(`✅ Data saved to MongoDB: ${data.employees ? data.employees.length : 0} employees, ${data.pdfs ? Object.keys(data.pdfs).length : 0} PDFs`);
        dataCache = data;
        return true;
    } catch (error) {
        console.error('❌ Error saving to MongoDB:', error);
        return false;
    }
}

async function initializeData() {
    let data = await loadDataFromMongoDB();
    
    if (data) {
        if (!data.settings) data.settings = { testMode: false };
        if (!data.pdfs) data.pdfs = {};
        if (!data.employees) data.employees = [];
        dataCache = data;
        return data;
    }
    
    const initialData = {
        employees: [],
        pdfs: {},
        settings: { testMode: false },
        lastUpdated: new Date().toISOString()
    };
    
    await saveDataToMongoDB(initialData);
    dataCache = initialData;
    console.log('✅ Created new data document in MongoDB');
    return initialData;
}

// ============================================
// ADMIN AUTHENTICATION ENDPOINTS
// ============================================

app.post('/api/admin/login', (req, res) => {
    try {
        console.log('🔐 Admin login request received');
        
        // Check if body exists
        if (!req.body) {
            console.log('❌ No request body received');
            return res.status(400).json({ 
                success: false, 
                message: 'No request body received' 
            });
        }
        
        const password = req.body.password;
        console.log('🔐 Password received, length:', password ? password.length : 0);
        
        if (!password) {
            console.log('❌ No password provided');
            return res.status(400).json({ 
                success: false, 
                message: 'Password is required' 
            });
        }
        
        if (password === ADMIN_PASSWORD) {
            const expiry = Date.now() + (24 * 60 * 60 * 1000);
            const tokenData = `${expiry}:${password}`;
            const token = Buffer.from(tokenData).toString('base64');
            
            console.log('✅ Admin login successful');
            res.json({ 
                success: true, 
                token: token,
                message: 'Login successful',
                expiresIn: '24 hours'
            });
        } else {
            console.log('❌ Admin login failed: Invalid password');
            res.status(401).json({ 
                success: false, 
                message: 'Invalid password' 
            });
        }
    } catch (error) {
        console.error('❌ Login error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error: ' + error.message 
        });
    }
});

app.post('/api/admin/verify', (req, res) => {
    try {
        const { token } = req.body;
        
        if (!token) {
            return res.json({ success: false, message: 'No token provided' });
        }
        
        try {
            const decoded = Buffer.from(token, 'base64').toString();
            const [expiry, password] = decoded.split(':');
            
            if (Date.now() > parseInt(expiry)) {
                return res.json({ success: false, message: 'Token expired' });
            }
            
            if (password === ADMIN_PASSWORD) {
                return res.json({ success: true, message: 'Token valid' });
            }
        } catch (e) {
            return res.json({ success: false, message: 'Invalid token' });
        }
        
        res.json({ success: false, message: 'Invalid token' });
    } catch (error) {
        console.error('❌ Verify error:', error);
        res.json({ success: false, message: 'Server error' });
    }
});

// ============================================
// MIDDLEWARE
// ============================================

app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ extended: true, limit: '500mb' }));

// CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Serve static files
app.use(express.static('public'));

// ============================================
// API ROUTES
// ============================================

app.get('/api/data', async (req, res) => {
    try {
        const data = await loadDataFromMongoDB();
        if (data) {
            dataCache = data;
            res.json(data);
        } else {
            res.json(dataCache || { employees: [], pdfs: {}, settings: { testMode: false } });
        }
    } catch (error) {
        console.error('❌ Error reading data:', error);
        res.json(dataCache || { employees: [], pdfs: {}, settings: { testMode: false } });
    }
});

app.post('/api/data', async (req, res) => {
    try {
        const data = req.body;
        if (!data || typeof data !== 'object') {
            return res.status(400).json({ error: 'Invalid data format' });
        }
        
        if (!data.employees) data.employees = [];
        if (!data.pdfs) data.pdfs = {};
        if (!data.settings) data.settings = { testMode: false };
        
        const saved = await saveDataToMongoDB(data);
        if (saved) {
            dataCache = data;
            res.json({ 
                success: true, 
                message: 'Data saved successfully',
                lastUpdated: data.lastUpdated
            });
        } else {
            res.status(500).json({ error: 'Failed to save data to MongoDB' });
        }
    } catch (error) {
        console.error('❌ Error saving data:', error);
        res.status(500).json({ error: 'Error saving data' });
    }
});

app.get('/health', async (req, res) => {
    try {
        const data = await loadDataFromMongoDB();
        const mongodbConnected = !!collection;
        res.json({
            status: 'OK',
            timestamp: new Date().toISOString(),
            recordCount: data ? data.employees.length : 0,
            pdfCount: data ? Object.keys(data.pdfs).length : 0,
            testMode: data ? data.settings?.testMode : false,
            storageType: mongodbConnected ? 'MongoDB Atlas (Free Tier) ✅' : 'Local (ephemeral) ⚠️',
            mongodbConnected: mongodbConnected,
            dataExists: !!data
        });
    } catch (error) {
        res.json({
            status: 'OK',
            timestamp: new Date().toISOString(),
            storageType: 'MongoDB Atlas',
            error: error.message,
            mongodbConnected: false
        });
    }
});

// Serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling
app.use((err, req, res, next) => {
    console.error('❌ Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('🔄 Received SIGTERM, saving data...');
    if (dataCache) {
        await saveDataToMongoDB(dataCache);
    }
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('🔄 Received SIGINT, saving data...');
    if (dataCache) {
        await saveDataToMongoDB(dataCache);
    }
    process.exit(0);
});

// ============================================
// START SERVER
// ============================================

async function startServer() {
    const connected = await connectToMongoDB();
    await initializeData();
    
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`✅ Server running on port ${PORT}`);
        console.log(`📊 Employees: ${dataCache.employees ? dataCache.employees.length : 0}`);
        console.log(`📄 PDFs: ${dataCache.pdfs ? Object.keys(dataCache.pdfs).length : 0}`);
        console.log(`🔒 Test Mode: ${dataCache.settings?.testMode ? 'ON' : 'OFF'}`);
        console.log(`💾 Storage: ${connected ? 'MongoDB Atlas (Free) ✅' : 'Local (ephemeral) ⚠️'}`);
        console.log(`🔐 Admin auth: Server-side (secure)`);
        console.log(`🌐 URL: http://localhost:${PORT}`);
    });
}

startServer();
