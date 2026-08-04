const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();

// Configuration
const PORT = process.env.PORT || 3000;

// Multiple storage locations for redundancy
const STORAGE_LOCATIONS = [
    process.env.DATA_DIR || '/data',
    path.join(__dirname, 'data'),
    path.join(__dirname, 'persistent-data')
];

let activeDataDir = null;
let activeDataFile = null;

console.log('🚀 Starting server...');
console.log('📁 Current directory:', __dirname);

// Function to find the best available storage location
function findAvailableStorage() {
    for (const location of STORAGE_LOCATIONS) {
        try {
            if (!fs.existsSync(location)) {
                fs.mkdirSync(location, { recursive: true });
            }
            const testFile = path.join(location, '.write-test');
            fs.writeFileSync(testFile, 'test');
            fs.unlinkSync(testFile);
            console.log(`✅ Storage available at: ${location}`);
            return location;
        } catch (error) {
            console.log(`❌ Cannot use ${location}: ${error.message}`);
        }
    }
    const fallback = path.join(__dirname, 'fallback-data');
    if (!fs.existsSync(fallback)) {
        fs.mkdirSync(fallback, { recursive: true });
    }
    console.log(`⚠️ Using fallback storage at: ${fallback}`);
    return fallback;
}

activeDataDir = findAvailableStorage();
const DATA_FILE = path.join(activeDataDir, 'data.json');
console.log('📄 Data file:', DATA_FILE);

// Initialize or recover data file
function initializeDataFile() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const content = fs.readFileSync(DATA_FILE, 'utf8');
            const data = JSON.parse(content);
            
            if (!data.settings) {
                data.settings = { testMode: false };
            }
            if (data.settings.testMode === undefined || data.settings.testMode === null) {
                data.settings.testMode = false;
            }
            if (!data.pdfs) {
                data.pdfs = {};
            }
            
            const pdfCount = data.pdfs ? Object.keys(data.pdfs).length : 0;
            console.log(`✅ Data file loaded: ${data.employees ? data.employees.length : 0} employees, ${pdfCount} PDFs`);
            console.log(`🔒 Test Mode: ${data.settings.testMode ? 'ON' : 'OFF'}`);
            
            return data;
        }
    } catch (error) {
        console.log('⚠️ Data file corrupted, attempting recovery...');
        const backupFile = DATA_FILE + '.backup';
        if (fs.existsSync(backupFile)) {
            try {
                const content = fs.readFileSync(backupFile, 'utf8');
                const data = JSON.parse(content);
                if (!data.settings) data.settings = { testMode: false };
                if (!data.pdfs) data.pdfs = {};
                fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
                console.log('✅ Data recovered from backup');
                return data;
            } catch (e) {
                console.log('❌ Backup recovery failed');
            }
        }
    }
    
    const initialData = {
        employees: [],
        pdfs: {},
        settings: { testMode: false },
        lastUpdated: new Date().toISOString()
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2));
    console.log('✅ Created new data file with Test Mode OFF');
    return initialData;
}

let dataCache = initializeDataFile();

// Function to save data with redundancy
function saveData(data) {
    try {
        if (!data.settings) data.settings = { testMode: false };
        if (!data.pdfs) data.pdfs = {};
        data.lastUpdated = new Date().toISOString();
        
        // Save to primary location
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        console.log('✅ Data saved to primary storage');
        
        // Save backup
        const backupFile = DATA_FILE + '.backup';
        fs.writeFileSync(backupFile, JSON.stringify(data, null, 2));
        console.log('✅ Backup saved');
        
        // Save local backup if using /data
        if (activeDataDir === '/data') {
            const localDir = path.join(__dirname, 'data');
            if (!fs.existsSync(localDir)) {
                fs.mkdirSync(localDir, { recursive: true });
            }
            const localBackup = path.join(localDir, 'data.json');
            fs.writeFileSync(localBackup, JSON.stringify(data, null, 2));
            console.log('✅ Additional backup saved locally');
        }
        
        dataCache = data;
        return true;
    } catch (error) {
        console.error('❌ Error saving data:', error);
        return false;
    }
}

// Middleware - Increased limit for large PDFs
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
// API: GET DATA
// ============================================
app.get('/api/data', (req, res) => {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const content = fs.readFileSync(DATA_FILE, 'utf8');
            const data = JSON.parse(content);
            
            if (!data.settings) data.settings = { testMode: false };
            if (!data.pdfs) data.pdfs = {};
            
            const pdfCount = data.pdfs ? Object.keys(data.pdfs).length : 0;
            console.log(`📤 Sending: ${data.employees ? data.employees.length : 0} employees, ${pdfCount} PDFs`);
            
            data._meta = {
                lastUpdated: data.lastUpdated || new Date().toISOString(),
                recordCount: data.employees ? data.employees.length : 0,
                pdfCount: pdfCount,
                testMode: data.settings.testMode
            };
            dataCache = data;
            res.json(data);
        } else {
            res.json({ employees: [], pdfs: {}, settings: { testMode: false } });
        }
    } catch (error) {
        console.error('❌ Error reading data:', error);
        res.json({ employees: dataCache.employees || [], pdfs: dataCache.pdfs || {}, settings: { testMode: false } });
    }
});

// ============================================
// API: POST DATA - SAVE PDFs and Employees
// ============================================
app.post('/api/data', (req, res) => {
    try {
        const data = req.body;
        if (!data || typeof data !== 'object') {
            return res.status(400).json({ error: 'Invalid data format' });
        }
        
        if (!data.employees) data.employees = [];
        if (!data.pdfs) data.pdfs = {};
        if (!data.settings) data.settings = { testMode: false };
        
        // Log PDF sizes
        if (data.pdfs) {
            let totalSize = 0;
            for (const [name, pdf] of Object.entries(data.pdfs)) {
                if (pdf.bytes) {
                    const sizeInMB = (pdf.bytes.length * 0.75) / 1024 / 1024;
                    totalSize += sizeInMB;
                    console.log(`   📄 ${name}: ${pdf.pages || 0} pages, ${sizeInMB.toFixed(2)}MB (base64)`);
                }
            }
            console.log(`📦 Total PDF data: ${totalSize.toFixed(2)}MB`);
        }
        
        if (saveData(data)) {
            res.json({ 
                success: true, 
                message: 'Data saved successfully',
                lastUpdated: data.lastUpdated,
                pdfCount: Object.keys(data.pdfs || {}).length
            });
        } else {
            res.status(500).json({ error: 'Failed to save data' });
        }
    } catch (error) {
        console.error('❌ Error saving data:', error);
        res.status(500).json({ error: 'Error saving data' });
    }
});

// ============================================
// Health check
// ============================================
app.get('/health', (req, res) => {
    const stats = fs.existsSync(DATA_FILE) ? fs.statSync(DATA_FILE) : null;
    const pdfCount = dataCache.pdfs ? Object.keys(dataCache.pdfs).length : 0;
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        dataExists: fs.existsSync(DATA_FILE),
        dataSize: stats ? stats.size : 0,
        recordCount: dataCache.employees ? dataCache.employees.length : 0,
        pdfCount: pdfCount,
        testMode: dataCache.settings ? dataCache.settings.testMode : false,
        storageLocation: activeDataDir
    });
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
process.on('SIGTERM', () => {
    console.log('🔄 Received SIGTERM, saving data...');
    if (dataCache) saveData(dataCache);
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🔄 Received SIGINT, saving data...');
    if (dataCache) saveData(dataCache);
    process.exit(0);
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    const pdfCount = dataCache.pdfs ? Object.keys(dataCache.pdfs).length : 0;
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`📁 Data directory: ${activeDataDir}`);
    console.log(`👥 Employees: ${dataCache.employees ? dataCache.employees.length : 0}`);
    console.log(`📄 PDFs: ${pdfCount}`);
    console.log(`🔒 Test Mode: ${dataCache.settings?.testMode ? 'ON' : 'OFF'}`);
});
