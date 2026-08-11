const express = require('express');
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const multer = require('multer');
const app = express();

// Configuration
const PORT = process.env.PORT || 3000;

// Admin Password from Environment Variables
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://trail_db_user:ZFjmUOMVSdatCOsq@cluster0.h1pqrer.mongodb.net/?retryWrites=true&w=majority';
const DB_NAME = process.env.DB_NAME || 'payslip_system';
const COLLECTION_NAME = 'payslip_data';
const PDF_COLLECTION_NAME = 'payslip_pdfs';

let db = null;
let collection = null;
let pdfCollection = null;
let dataCache = null;
let employeeData = [];

console.log('🚀 Starting server...');
console.log('🔒 Admin password is set from environment variables');

// Configure multer for PDF uploads - INCREASED LIMITS
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 100 * 1024 * 1024, // 100MB limit per file
        files: 50 // Max 50 files
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed'), false);
        }
    }
});

// ============================================
// MIDDLEWARE
// ============================================

app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ extended: true, limit: '500mb' }));

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

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
        pdfCollection = db.collection(PDF_COLLECTION_NAME);
        
        try {
            await collection.createIndex({ 'employees.empId': 1 });
            await pdfCollection.createIndex({ _id: 1 });
            console.log('✅ Indexes created');
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
// PDF STORAGE FUNCTIONS
// ============================================

async function savePdfToMongoDB(filename, buffer, pages = 0) {
    try {
        if (!pdfCollection) {
            console.log('⚠️ No MongoDB connection, skipping PDF save');
            return false;
        }
        
        // Convert buffer to base64 for storage
        const base64 = buffer.toString('base64');
        
        // Check size before saving
        const sizeInMB = base64.length / (1024 * 1024);
        if (sizeInMB > 15) {
            console.log(`⚠️ PDF ${filename} is ${sizeInMB.toFixed(2)}MB, near 16MB limit`);
        }
        
        // Store each PDF as a separate document
        await pdfCollection.updateOne(
            { _id: filename },
            { 
                $set: { 
                    bytes: base64,
                    pages: pages || 0,
                    size: buffer.length,
                    lastUpdated: new Date().toISOString()
                }
            },
            { upsert: true }
        );
        
        console.log(`✅ PDF saved: ${filename} (${(buffer.length/1024/1024).toFixed(2)} MB)`);
        return true;
    } catch (error) {
        console.error(`❌ Error saving PDF ${filename}:`, error.message);
        return false;
    }
}

async function loadAllPdfsFromMongoDB() {
    try {
        if (!pdfCollection) return {};
        const pdfs = await pdfCollection.find({}).toArray();
        const result = {};
        pdfs.forEach(pdf => {
            try {
                const buffer = Buffer.from(pdf.bytes, 'base64');
                result[pdf._id] = {
                    bytes: buffer.buffer,
                    pages: pdf.pages || 0
                };
            } catch(e) {
                console.error(`❌ Error parsing PDF ${pdf._id}:`, e.message);
            }
        });
        console.log(`✅ Loaded ${Object.keys(result).length} PDFs from MongoDB`);
        return result;
    } catch (error) {
        console.error('❌ Error loading PDFs:', error.message);
        return {};
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
            console.log(`✅ Data loaded from MongoDB: ${employeeData.length} employees`);
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
        
        const employeeDataToSave = {
            employees: data.employees || [],
            settings: data.settings || { testMode: false },
            lastUpdated: new Date().toISOString()
        };
        
        await collection.updateOne(
            { _id: 'payslip_data' },
            { $set: employeeDataToSave },
            { upsert: true }
        );
        
        employeeData = data.employees || [];
        console.log(`✅ Data saved to MongoDB: ${employeeData.length} employees`);
        dataCache = data;
        return true;
    } catch (error) {
        console.error('❌ Error saving to MongoDB:', error);
        return false;
    }
}

async function initializeData() {
    let data = await loadDataFromMongoDB();
    const pdfs = await loadAllPdfsFromMongoDB();
    
    if (data) {
        if (!data.settings) data.settings = { testMode: false };
        if (!data.employees) data.employees = [];
        data.pdfs = pdfs;
        dataCache = data;
        employeeData = data.employees || [];
        console.log(`✅ Data initialized: ${employeeData.length} employees, ${Object.keys(pdfs).length} PDFs`);
        return data;
    }
    
    const initialData = {
        employees: [],
        pdfs: pdfs,
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
// EXTRACTION FUNCTIONS
// ============================================

function extractEmpId(text) {
    const patterns = [
        /Emp\s*Code[:.\s]*([0-9]{4,6})/i,
        /Emp\s*Code[:.\s]*(PPRR[0-9]+)/i,
        /Emp\s*Code[:.\s]*(TXIX[0-9]+)/i,
        /Emp\s*Code[:.\s]*(T1UB[0-9]+)/i,
        /Employee\s*Code[:.\s]*([0-9]{4,6})/i,
        /PPRR([0-9]+)/i,
        /TXIX([0-9]+)/i,
        /T1UB([0-9]+)/i,
        /\b([0-9]{4,6})\b/
    ];
    
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
            let id = match[1] ? match[1].trim() : match[0].trim();
            id = id.replace(/[^A-Z0-9]/g, '');
            if (id.length >= 4 && id.length <= 8) {
                return id;
            }
        }
    }
    return null;
}

function extractName(text) {
    const patterns = [
        /Name of the Employee[:.\s]*([A-Z\s]+?)(?=\s+No of Days|\s+Emp Code|\s+Aadhaar|\s+Designation|\s+UAN|\s+ESIC|\s+Dated|$)/i,
        /Employee Name[:.\s]*([A-Z\s]+?)(?=\s+No of Days|\s+Emp Code|\s+Aadhaar|\s+Designation|\s+UAN|\s+ESIC|\s+Dated|$)/i,
        /Name[:.\s]*([A-Z\s]+?)(?=\s+No of Days|\s+Emp Code|\s+Aadhaar|\s+Designation|\s+UAN|\s+ESIC|\s+Dated|$)/i,
        /Name\s+([A-Z]{2,}(?:\s+[A-Z]{2,})*)/i,
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
    return null;
}

function findEmployee(empId) {
    if (!empId) return null;
    empId = empId.toUpperCase().trim();
    
    let found = employeeData.find(e => e.empId.toUpperCase() === empId);
    if (found) return found;
    
    const numericPart = empId.replace(/^[A-Z]+/, '');
    if (numericPart && numericPart.length >= 4) {
        found = employeeData.find(e => {
            const eNumeric = e.empId.toUpperCase().replace(/^[A-Z]+/, '');
            return eNumeric === numericPart;
        });
        if (found) return found;
    }
    return null;
}

// ============================================
// ADMIN AUTHENTICATION
// ============================================

app.post('/api/admin/login', (req, res) => {
    try {
        const password = req.body && req.body.password ? req.body.password : null;
        if (!password) {
            return res.status(400).json({ success: false, message: 'Password is required' });
        }
        if (password === ADMIN_PASSWORD) {
            const expiry = Date.now() + (24 * 60 * 60 * 1000);
            const tokenData = `${expiry}:${password}`;
            const token = Buffer.from(tokenData).toString('base64');
            res.json({ success: true, token: token, message: 'Login successful', expiresIn: '24 hours' });
        } else {
            res.status(401).json({ success: false, message: 'Invalid password' });
        }
    } catch (error) {
        console.error('❌ Login error:', error);
        res.status(500).json({ success: false, message: 'Server error: ' + error.message });
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
// ⭐ FIXED: PDF UPLOAD ENDPOINT WITH BETTER ERROR HANDLING
// ============================================

app.post('/api/upload-pdfs', upload.array('pdfs', 50), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No PDF files uploaded' });
        }
        
        console.log(`📤 Received ${req.files.length} PDF files for upload`);
        let savedCount = 0;
        let errors = [];
        
        // Parse metadata from the request
        let metadata = {};
        try {
            if (req.body.metadata) {
                metadata = JSON.parse(req.body.metadata);
            }
        } catch (e) {
            console.log('⚠️ No metadata provided');
        }
        
        for (const file of req.files) {
            const filename = file.originalname;
            const pages = metadata[filename] || 0;
            
            console.log(`📄 Saving PDF: ${filename} (${(file.size/1024/1024).toFixed(2)} MB)`);
            
            try {
                const saved = await savePdfToMongoDB(filename, file.buffer, pages);
                if (saved) {
                    savedCount++;
                } else {
                    errors.push(`Failed to save ${filename}`);
                }
            } catch (err) {
                console.error(`❌ Error saving ${filename}:`, err.message);
                errors.push(`${filename}: ${err.message}`);
            }
        }
        
        // Even if some PDFs fail, return success for those that worked
        if (savedCount > 0) {
            res.json({
                success: true,
                message: `${savedCount} of ${req.files.length} PDF(s) uploaded successfully`,
                uploaded: savedCount,
                total: req.files.length,
                errors: errors.length > 0 ? errors : undefined
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to upload any PDFs',
                details: errors
            });
        }
    } catch (error) {
        console.error('❌ PDF upload error:', error);
        res.status(500).json({ 
            error: 'PDF upload failed: ' + error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// ============================================
// DOWNLOAD TRACKING
// ============================================

app.post('/api/track-download', async (req, res) => {
    try {
        const { empId } = req.body;
        if (!empId) {
            return res.status(400).json({ error: 'Employee ID required' });
        }
        
        const data = await loadDataFromMongoDB();
        if (!data || !data.employees) {
            return res.status(404).json({ error: 'No data found' });
        }
        
        const employee = data.employees.find(e => e.empId === empId || 
            e.empId.replace(/^[A-Z]+/, '') === empId.replace(/^[A-Z]+/, ''));
        
        if (!employee) {
            return res.status(404).json({ error: 'Employee not found' });
        }
        
        employee.downloadCount = (employee.downloadCount || 0) + 1;
        employee.lastDownload = new Date().toISOString();
        
        await saveDataToMongoDB(data);
        
        res.json({ 
            success: true, 
            downloadCount: employee.downloadCount,
            lastDownload: employee.lastDownload
        });
    } catch (error) {
        console.error('❌ Track download error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ============================================
// MISSING PAYSLIPS LOG
// ============================================

app.get('/api/missing-payslips', async (req, res) => {
    try {
        const data = await loadDataFromMongoDB();
        const pdfs = await loadAllPdfsFromMongoDB();
        
        if (!data || !data.employees) {
            return res.json({ employees: [], pdfs: [] });
        }
        
        const pdfFiles = Object.keys(pdfs);
        
        const pdfStats = pdfFiles.map(pdfName => {
            const foundInPdf = data.employees.filter(emp => 
                emp.pdfFile === pdfName && emp.pageNumber
            );
            
            return {
                pdfName: pdfName,
                found: foundInPdf.length,
                missing: data.employees.length - foundInPdf.length
            };
        });
        
        const missingEmployees = data.employees.filter(emp => {
            return !emp.pageNumber || !emp.pdfFile || !pdfFiles.includes(emp.pdfFile);
        });
        
        res.json({
            totalEmployees: data.employees.length,
            totalWithPayslip: data.employees.filter(e => e.pageNumber && e.pdfFile && pdfFiles.includes(e.pdfFile)).length,
            pdfStats: pdfStats,
            missingEmployees: missingEmployees.map(e => ({
                empId: e.empId,
                name: e.name,
                pageNumber: e.pageNumber || 'Not found',
                pdfFile: e.pdfFile || 'Not assigned'
            }))
        });
    } catch (error) {
        console.error('❌ Missing payslips error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ============================================
// API ROUTES
// ============================================

app.get('/api/data', async (req, res) => {
    try {
        const data = await loadDataFromMongoDB();
        if (data) {
            const pdfs = await loadAllPdfsFromMongoDB();
            data.pdfs = pdfs;
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
        if (!data.settings) data.settings = { testMode: false };
        
        const saved = await saveDataToMongoDB(data);
        if (saved) {
            dataCache = data;
            employeeData = data.employees || [];
            res.json({ 
                success: true, 
                message: 'Employee data saved successfully',
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
        const pdfs = await loadAllPdfsFromMongoDB();
        const mongodbConnected = !!collection;
        res.json({
            status: 'OK',
            timestamp: new Date().toISOString(),
            recordCount: data ? data.employees.length : 0,
            pdfCount: Object.keys(pdfs).length,
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

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

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
        console.log(`🌐 URL: http://localhost:${PORT}`);
    });
}

startServer();
