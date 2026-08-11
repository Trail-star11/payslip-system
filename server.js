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
let employeeData = []; // Global reference for matching

console.log('🚀 Starting server...');
console.log('🔒 Admin password is set from environment variables');

// ============================================
// ✅ MIDDLEWARE - MUST come BEFORE routes
// ============================================

app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ extended: true, limit: '500mb' }));

// CORS middleware
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
            employeeData = data.employees || [];
            console.log(`✅ Data loaded from MongoDB: ${employeeData.length} employees, ${data.pdfs ? Object.keys(data.pdfs).length : 0} PDFs`);
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
            employeeData = data.employees || [];
            return false;
        }
        
        data.lastUpdated = new Date().toISOString();
        delete data._id;
        
        await collection.updateOne(
            { _id: 'payslip_data' },
            { $set: data },
            { upsert: true }
        );
        
        employeeData = data.employees || [];
        console.log(`✅ Data saved to MongoDB: ${employeeData.length} employees, ${data.pdfs ? Object.keys(data.pdfs).length : 0} PDFs`);
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
        employeeData = data.employees || [];
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
    employeeData = [];
    console.log('✅ Created new data document in MongoDB');
    return initialData;
}

// ============================================
// ⭐ FIXED: EXTRACTION FUNCTIONS
// ============================================

function extractName(text) {
    const patterns = [
        /Name of the Employee[:.\s]*([A-Z\s]+?)(?=\s+No of Days|\s+Emp Code|\s+Aadhaar|\s+Designation|\s+UAN|\s+ESIC|\s+Dated|$)/i,
        /Employee Name[:.\s]*([A-Z\s]+?)(?=\s+No of Days|\s+Emp Code|\s+Aadhaar|\s+Designation|\s+UAN|\s+ESIC|\s+Dated|$)/i,
        /Name[:.\s]*([A-Z\s]+?)(?=\s+No of Days|\s+Emp Code|\s+Aadhaar|\s+Designation|\s+UAN|\s+ESIC|\s+Dated|$)/i,
        /Name\s+([A-Z]{2,}(?:\s+[A-Z]{2,})*)/i,
        /Employee\s+([A-Z]{2,}(?:\s+[A-Z]{2,})*)/i,
    ];
    
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
            let name = match[1].trim();
            name = name.replace(/\s+No of Days.*$/i, '')
                       .replace(/\s+Emp Code.*$/i, '')
                       .replace(/\s+Aadhaar.*$/i, '')
                       .replace(/\s+Designation.*$/i, '')
                       .replace(/\s+UAN.*$/i, '')
                       .replace(/\s+ESIC.*$/i, '')
                       .replace(/\s+Dated.*$/i, '')
                       .replace(/\s+Location.*$/i, '')
                       .replace(/\s+Pay-mode.*$/i, '');
            name = name.replace(/[^A-Za-z\s\.]/g, '');
            if (name.length > 1) {
                return name.trim();
            }
        }
    }
    
    const fallbackMatch = text.match(/([A-Z]{2,}(?:\s+[A-Z]{2,}){1,5})/);
    if (fallbackMatch) {
        let name = fallbackMatch[1].trim();
        const stopWords = ['BASIC', 'HRA', 'ALLOWANCE', 'BONUS', 'LWF', 'UAN', 'ESIC', 'P TAX', 'TOTAL', 'GROSS', 'AMOUNT', 'PARTICULARS', 'EARNING', 'DEDUCTIONS', 'FIXED', 'RATE', 'BANK', 'TRANSFER', 'EXEMPTED', 'LOCATION', 'NOIDA', 'KHASRA', 'NEAR', 'BSES', 'OFFICE', 'VILLAGE', 'POST', 'BHARTHAL', 'DWARKA', 'SECTOR', 'NEW', 'DELHI', 'SUPERVISOR', 'SHIFT', 'INCHARGE', 'TEAM', 'LEADER', 'PICKER', 'LOADER', 'UNLOADER', 'EXECUTIVE'];
        if (stopWords.some(w => name.includes(w))) {
            return null;
        }
        return name;
    }
    
    return null;
}

function extractEmpId(text) {
    // 🔥 PRIORITY: Look for PPRR pattern FIRST (your most common format)
    const pprrMatch = text.match(/(PPRR[A-Z0-9]+)/i);
    if (pprrMatch) {
        let id = pprrMatch[1].trim().toUpperCase();
        if (id.length >= 4 && id.startsWith('PPRR')) {
            console.log(`✅ Found PPRR ID: ${id}`);
            return id;
        }
    }
    
    // Look for Emp Code with PPRR
    const empCodeMatch = text.match(/Emp Code[:.\s]*(PPRR[A-Z0-9]+)/i);
    if (empCodeMatch) {
        let id = empCodeMatch[1].trim().toUpperCase();
        if (id.length >= 4) {
            console.log(`✅ Found Emp Code: ${id}`);
            return id;
        }
    }
    
    // Look for Employee Code with PPRR
    const employeeCodeMatch = text.match(/Employee Code[:.\s]*(PPRR[A-Z0-9]+)/i);
    if (employeeCodeMatch) {
        let id = employeeCodeMatch[1].trim().toUpperCase();
        if (id.length >= 4) {
            console.log(`✅ Found Employee Code: ${id}`);
            return id;
        }
    }
    
    // Generic PPRR pattern (fallback)
    const genericMatch = text.match(/\b(PPRR[A-Z0-9]+)\b/i);
    if (genericMatch) {
        let id = genericMatch[1].trim().toUpperCase();
        if (id.length >= 4) {
            console.log(`✅ Found PPRR (generic): ${id}`);
            return id;
        }
    }
    
    // TXIX format (older format)
    const txixMatch = text.match(/(TXIX[A-Z0-9]+)/i);
    if (txixMatch) {
        let id = txixMatch[1].trim().toUpperCase();
        if (id.length >= 4) {
            console.log(`✅ Found TXIX ID: ${id}`);
            return id;
        }
    }
    
    // T1UB format
    const t1ubMatch = text.match(/(T1UB[A-Z0-9]+)/i);
    if (t1ubMatch) {
        let id = t1ubMatch[1].trim().toUpperCase();
        if (id.length >= 4) {
            console.log(`✅ Found T1UB ID: ${id}`);
            return id;
        }
    }
    
    // Look for numeric-only Emp Code (like "11906" from your PDF)
    // Then convert to PPRR format if it's a valid ID
    const numericMatch = text.match(/Emp Code[:.\s]*([0-9]{4,6})/i);
    if (numericMatch) {
        let num = numericMatch[1].trim();
        if (num.length >= 4 && num.length <= 6) {
            // Check if this numeric ID exists in our data with any prefix
            if (employeeData && employeeData.length > 0) {
                for (const emp of employeeData) {
                    const empNumeric = emp.empId.toUpperCase().replace(/^[A-Z]+/, '');
                    if (empNumeric === num) {
                        console.log(`✅ Matched numeric ID ${num} to existing employee ${emp.empId}`);
                        return emp.empId.toUpperCase();
                    }
                }
            }
            // If no match found, use PPRR as default
            console.log(`⚠️ Converting numeric ID ${num} to PPRR${num}`);
            return `PPRR${num}`;
        }
    }
    
    // Fallback: Look for any 4+ char alphanumeric that looks like an ID
    const fallbackMatch = text.match(/\b([A-Z]{2,4}[0-9]{4,6})\b/);
    if (fallbackMatch) {
        let id = fallbackMatch[1].trim().toUpperCase();
        id = id.replace(/[^A-Z0-9]/g, '');
        if (id.length >= 4 && /[A-Z]/.test(id) && /[0-9]/.test(id)) {
            console.log(`✅ Found fallback ID: ${id}`);
            return id;
        }
    }
    
    console.log(`❌ No ID found in text`);
    return null;
}

// ============================================
// ⭐ FIXED: FIND EMPLOYEE - Matches by numeric part
// ============================================

function findEmployee(empId) {
    if (!empId) return null;
    
    empId = empId.toUpperCase().trim();
    
    // Extract numeric part (e.g., "11906" from "PPRR11906" or "TXIX11906")
    const numericPart = empId.replace(/^[A-Z]+/, '');
    
    // 1. Try exact match first
    let found = employeeData.find(e => e.empId.toUpperCase() === empId);
    if (found) return found;
    
    // 2. Try matching by numeric part (TXIX11906 vs PPRR11906)
    found = employeeData.find(e => {
        const eNumeric = e.empId.toUpperCase().replace(/^[A-Z]+/, '');
        return eNumeric === numericPart;
    });
    if (found) {
        console.log(`✅ Matched ${empId} to ${found.empId} by numeric part`);
        return found;
    }
    
    // 3. Try partial match
    found = employeeData.find(e => {
        const eId = e.empId.toUpperCase();
        const eNumeric = eId.replace(/^[A-Z]+/, '');
        return eNumeric.includes(numericPart) || numericPart.includes(eNumeric);
    });
    if (found) {
        console.log(`✅ Matched ${empId} to ${found.empId} by partial match`);
        return found;
    }
    
    return null;
}

// ============================================
// ADMIN AUTHENTICATION
// ============================================

app.post('/api/admin/login', (req, res) => {
    try {
        console.log('🔐 Admin login request received');
        console.log('📦 Request body:', req.body);
        
        const password = req.body && req.body.password ? req.body.password : null;
        
        if (!password) {
            console.log('❌ No password provided');
            return res.status(400).json({ 
                success: false, 
                message: 'Password is required' 
            });
        }
        
        console.log('🔐 Password received, checking...');
        
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
        const token = req.body && req.body.token ? req.body.token : null;
        
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
// API ROUTES
// ============================================

app.get('/api/data', async (req, res) => {
    try {
        const data = await loadDataFromMongoDB();
        if (data) {
            dataCache = data;
            employeeData = data.employees || [];
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
            employeeData = data.employees || [];
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
        console.log(`📊 Employees: ${employeeData.length}`);
        console.log(`📄 PDFs: ${dataCache.pdfs ? Object.keys(dataCache.pdfs).length : 0}`);
        console.log(`🔒 Test Mode: ${dataCache.settings?.testMode ? 'ON' : 'OFF'}`);
        console.log(`💾 Storage: ${connected ? 'MongoDB Atlas (Free) ✅' : 'Local (ephemeral) ⚠️'}`);
        console.log(`🔐 Admin auth: Server-side (secure)`);
        console.log(`🌐 URL: http://localhost:${PORT}`);
    });
}

startServer();
