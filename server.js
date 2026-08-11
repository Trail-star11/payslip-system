const express = require('express');
const path = require('path');
const { MongoClient } = require('mongodb');
const multer = require('multer');
const app = express();

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://trail_db_user:ZFjmUOMVSdatCOsq@cluster0.h1pqrer.mongodb.net/?retryWrites=true&w=majority';
const DB_NAME = process.env.DB_NAME || 'payslip_system';

let db = null;
let collection = null;
let pdfCollection = null;
let employeeData = [];

console.log('🚀 Starting server...');

const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 20 * 1024 * 1024 } // 20MB limit
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

app.use(express.static('public'));

// ============================================
// MongoDB Connection
// ============================================

async function connectToMongoDB() {
    try {
        console.log('📡 Connecting to MongoDB...');
        const client = new MongoClient(MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 5000,
        });
        await client.connect();
        db = client.db(DB_NAME);
        collection = db.collection('payslip_data');
        pdfCollection = db.collection('payslip_pdfs');
        console.log('✅ MongoDB connected');
        return true;
    } catch (error) {
        console.error('❌ MongoDB connection failed:', error.message);
        return false;
    }
}

// ============================================
// Load/Save Data
// ============================================

async function loadData() {
    try {
        const data = await collection.findOne({ _id: 'payslip_data' });
        if (data) {
            delete data._id;
            employeeData = data.employees || [];
            return data;
        }
        return null;
    } catch (e) {
        console.error('❌ Load error:', e.message);
        return null;
    }
}

async function saveData(data) {
    try {
        await collection.updateOne(
            { _id: 'payslip_data' },
            { 
                $set: { 
                    employees: data.employees || [],
                    settings: data.settings || { testMode: false },
                    lastUpdated: new Date().toISOString()
                }
            },
            { upsert: true }
        );
        employeeData = data.employees || [];
        return true;
    } catch (e) {
        console.error('❌ Save error:', e.message);
        return false;
    }
}

// ============================================
// PDF Upload (Single file - more reliable)
// ============================================

app.post('/api/upload-pdf', upload.single('pdfs'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        
        const filename = req.file.originalname;
        console.log(`📄 Saving: ${filename} (${(req.file.size/1024/1024).toFixed(2)} MB)`);
        
        // Check if file is too large
        if (req.file.size > 15 * 1024 * 1024) {
            console.warn(`⚠️ ${filename} is ${(req.file.size/1024/1024).toFixed(2)} MB, may exceed MongoDB limit`);
        }
        
        const base64 = req.file.buffer.toString('base64');
        
        await pdfCollection.updateOne(
            { _id: filename },
            { $set: { bytes: base64, size: req.file.size, lastUpdated: new Date().toISOString() } },
            { upsert: true }
        );
        
        res.json({ success: true, message: 'PDF uploaded', filename: filename });
    } catch (error) {
        console.error('❌ Upload error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// Admin Login
// ============================================

app.post('/api/admin/login', (req, res) => {
    const password = req.body?.password || '';
    if (password === ADMIN_PASSWORD) {
        const token = Buffer.from(`${Date.now()}:${password}`).toString('base64');
        res.json({ success: true, token: token });
    } else {
        res.status(401).json({ success: false, message: 'Invalid password' });
    }
});

app.post('/api/admin/verify', (req, res) => {
    const token = req.body?.token || '';
    try {
        const decoded = Buffer.from(token, 'base64').toString();
        const [, password] = decoded.split(':');
        if (password === ADMIN_PASSWORD) {
            return res.json({ success: true });
        }
    } catch (e) {}
    res.json({ success: false });
});

// ============================================
// API Routes
// ============================================

app.get('/api/data', async (req, res) => {
    try {
        const data = await loadData();
        const pdfs = await pdfCollection.find({}).toArray();
        const pdfMap = {};
        pdfs.forEach(p => { pdfMap[p._id] = { bytes: p.bytes, pages: 0 }; });
        
        if (data) {
            data.pdfs = pdfMap;
            res.json(data);
        } else {
            res.json({ employees: [], pdfs: pdfMap, settings: { testMode: false } });
        }
    } catch (e) {
        res.json({ employees: [], pdfs: {}, settings: { testMode: false } });
    }
});

app.post('/api/data', async (req, res) => {
    try {
        const data = req.body;
        if (!data.employees) data.employees = [];
        if (!data.settings) data.settings = { testMode: false };
        await saveData(data);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/track-download', async (req, res) => {
    try {
        const { empId } = req.body;
        const data = await loadData();
        const emp = data.employees.find(e => e.empId === empId);
        if (emp) {
            emp.downloadCount = (emp.downloadCount || 0) + 1;
            await saveData(data);
            res.json({ success: true, downloadCount: emp.downloadCount });
        } else {
            res.status(404).json({ error: 'Employee not found' });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/missing-payslips', async (req, res) => {
    try {
        const data = await loadData();
        const pdfs = await pdfCollection.find({}).toArray();
        const pdfFiles = pdfs.map(p => p._id);
        
        const missing = (data?.employees || []).filter(e => 
            !e.pageNumber || !e.pdfFile || !pdfFiles.includes(e.pdfFile)
        );
        
        res.json({
            totalEmployees: data?.employees?.length || 0,
            totalWithPayslip: (data?.employees || []).filter(e => 
                e.pageNumber && e.pdfFile && pdfFiles.includes(e.pdfFile)
            ).length,
            pdfStats: pdfFiles.map(name => ({ 
                pdfName: name, 
                found: (data?.employees || []).filter(e => e.pdfFile === name && e.pageNumber).length,
                missing: (data?.employees || []).length - (data?.employees || []).filter(e => e.pdfFile === name && e.pageNumber).length
            })),
            missingEmployees: missing.map(e => ({ empId: e.empId, name: e.name, pageNumber: e.pageNumber || 'Not found', pdfFile: e.pdfFile || 'Not assigned' }))
        });
    } catch (e) {
        res.json({ totalEmployees: 0, totalWithPayslip: 0, pdfStats: [], missingEmployees: [] });
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================
// Start
// ============================================

async function start() {
    await connectToMongoDB();
    await loadData();
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`✅ Server running on port ${PORT}`);
        console.log(`📊 Employees: ${employeeData.length}`);
    });
}

start();
