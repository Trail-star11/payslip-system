const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();

// Configuration
const PORT = process.env.PORT || 3000;

// Multiple storage locations for redundancy
const STORAGE_LOCATIONS = [
    process.env.DATA_DIR || '/data',  // Render's persistent disk
    path.join(__dirname, 'data'),      // Local data directory
    path.join(__dirname, 'persistent-data') // Fallback
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
            // Test write permission
            const testFile = path.join(location, '.write-test');
            fs.writeFileSync(testFile, 'test');
            fs.unlinkSync(testFile);
            console.log(`✅ Storage available at: ${location}`);
            return location;
        } catch (error) {
            console.log(`❌ Cannot use ${location}: ${error.message}`);
        }
    }
    // Fallback to current directory
    const fallback = path.join(__dirname, 'fallback-data');
    if (!fs.existsSync(fallback)) {
        fs.mkdirSync(fallback, { recursive: true });
    }
    console.log(`⚠️ Using fallback storage at: ${fallback}`);
    return fallback;
}

// Find best storage location
activeDataDir = findAvailableStorage();
const DATA_FILE = path.join(activeDataDir, 'data.json');

console.log('📄 Data file:', DATA_FILE);

// Initialize or recover data file
function initializeDataFile() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            // Try to read existing data
            const content = fs.readFileSync(DATA_FILE, 'utf8');
            const data = JSON.parse(content);
            
            // Ensure settings exists
            if (!data.settings) {
                data.settings = { testMode: false };
            }
            if (data.settings.testMode === undefined || data.settings.testMode === null) {
                data.settings.testMode = false;
            }
            
            // Log PDF info
            const pdfCount = data.pdfs ? Object.keys(data.pdfs).length : 0;
            console.log(`✅ Data file loaded: ${data.employees ? data.employees.length : 0} employees, ${pdfCount} PDFs`);
            console.log(`🔒 Test Mode: ${data.settings.testMode ? 'ON' : 'OFF'}`);
            
            // Log PDF sizes
            if (data.pdfs) {
                for (const [name, pdf] of Object.entries(data.pdfs)) {
                    const size = pdf.bytes ? (pdf.bytes.length * 0.75 / 1024 / 1024).toFixed(2) : 0;
                    console.log(`   📄 ${name}: ${pdf.pages || 0} pages, ${size}MB (base64)`);
                }
            }
            return data;
        }
    } catch (error) {
        console.log('⚠️ Data file corrupted, attempting recovery...');
        // Try to recover from backup
        const backupFile = DATA_FILE + '.backup';
        if (fs.existsSync(backupFile)) {
            try {
                const content = fs.readFileSync(backupFile, 'utf8');
                const data = JSON.parse(content);
                
                if (!data.settings) {
                    data.settings = { testMode: false };
                }
                if (data.settings.testMode === undefined || data.settings.testMode === null) {
                    data.settings.testMode = false;
                }
                
                fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
                console.log('✅ Data recovered from backup');
                console.log(`🔒 Test Mode: ${data.settings.testMode ? 'ON' : 'OFF'}`);
                return data;
            } catch (e) {
                console.log('❌ Backup recovery failed');
            }
        }
    }
    
    // Create new data file
    const initialData = {
        employees: [],
        pdfs: {},
        settings: { testMode: false },
        lastUpdated: new Date().toISOString()
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2));
    console.log('✅ Created new data file with Test Mode OFF');
    console.log('🔒 Test Mode: OFF');
    return initialData;
}

// Initialize data
let dataCache = initializeDataFile();

// Function to save data (with multiple redundancy)
function saveData(data) {
    try {
        // Ensure settings exists
        if (!data.settings) {
            data.settings = { testMode: false };
        }
        if (data.settings.testMode === undefined || data.settings.testMode === null) {
            data.settings.testMode = false;
        }
        
        // Add timestamp
        data.lastUpdated = new Date().toISOString();
        
        // Log PDF info before saving
        const pdfCount = data.pdfs ? Object.keys(data.pdfs).length : 0;
        console.log(`💾 Saving ${pdfCount} PDFs...`);
        
        // Save to primary location
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        console.log('✅ Data saved to primary storage');
        console.log(`🔒 Test Mode saved as: ${data.settings.testMode ? 'ON' : 'OFF'}`);
        
        // Save backup in same location
        const backupFile = DATA_FILE + '.backup';
        fs.writeFileSync(backupFile, JSON.stringify(data, null, 2));
        console.log('✅ Backup saved');
        
        // If we're using /data, also save to local directory as additional backup
        if (activeDataDir === '/data') {
            const localBackup = path.join(__dirname, 'data', 'data.json');
            const localDir = path.join(__dirname, 'data');
            if (!fs.existsSync(localDir)) {
                fs.mkdirSync(localDir, { recursive: true });
            }
            fs.writeFileSync(localBackup, JSON.stringify(data, null, 2));
            console.log('✅ Additional backup saved locally');
        }
        
        // Update cache
        dataCache = data;
        return true;
    } catch (error) {
        console.error('❌ Error saving data:', error);
        return false;
    }
}

// Middleware - Increase limit for large PDFs
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

// API Routes
app.get('/api/data', (req, res) => {
    try {
        // Always read fresh from file
        if (fs.existsSync(DATA_FILE)) {
            const content = fs.readFileSync(DATA_FILE, 'utf8');
            const data = JSON.parse(content);
            
            // Ensure settings exists
            if (!data.settings) {
                data.settings = { testMode: false };
            }
            if (data.settings.testMode === undefined || data.settings.testMode === null) {
                data.settings.testMode = false;
            }
            
            // Ensure pdfs exists
            if (!data.pdfs) {
                data.pdfs = {};
            }
            
            data._meta = {
                lastUpdated: data.lastUpdated || new Date().toISOString(),
                recordCount: data.employees ? data.employees.length : 0,
                pdfCount: data.pdfs ? Object.keys(data.pdfs).length : 0,
                storageLocation: activeDataDir,
                testMode: data.settings.testMode
            };
            dataCache = data;
            
            console.log(`📤 Sent ${data.employees ? data.employees.length : 0} employees, ${data.pdfs ? Object.keys(data.pdfs).length : 0} PDFs`);
            res.json(data);
        } else {
            // Return default data
            const defaultData = {
                employees: [],
                pdfs: {},
                settings: { testMode: false },
                lastUpdated: new Date().toISOString()
            };
            res.json(defaultData);
        }
    } catch (error) {
        console.error('❌ Error reading data:', error);
        // Return safe default
        const safeData = {
            employees: dataCache.employees || [],
            pdfs: dataCache.pdfs || {},
            settings: { testMode: false },
            lastUpdated: new Date().toISOString()
        };
        res.json(safeData);
    }
});

app.post('/api/data', (req, res) => {
    try {
        const data = req.body;
        if (!data || typeof data !== 'object') {
            return res.status(400).json({ error: 'Invalid data format' });
        }
        
        // Ensure required fields
        if (!data.employees) data.employees = [];
        if (!data.pdfs) data.pdfs = {};
        if (!data.settings) data.settings = { testMode: false };
        if (data.settings.testMode === undefined || data.settings.testMode === null) {
            data.settings.testMode = false;
        }
        
        // Validate PDF data
        if (data.pdfs) {
            let totalSize = 0;
            for (const [name, pdf] of Object.entries(data.pdfs)) {
                if (pdf.bytes) {
                    const sizeInMB = pdf.bytes.length * 0.75 / 1024 / 1024;
                    totalSize += sizeInMB;
                    console.log(`   📄 ${name}: ${pdf.pages || 0} pages, ${sizeInMB.toFixed(2)}MB (base64)`);
                }
            }
            console.log(`📦 Total PDF data size: ${totalSize.toFixed(2)}MB`);
        }
        
        // Save data
        if (saveData(data)) {
            res.json({ 
                success: true, 
                message: 'Data saved successfully',
                lastUpdated: data.lastUpdated,
                storageLocation: activeDataDir,
                testMode: data.settings.testMode
            });
        } else {
            res.status(500).json({ error: 'Failed to save data' });
        }
    } catch (error) {
        console.error('❌ Error saving data:', error);
        res.status(500).json({ error: 'Error saving data' });
    }
});

// Health check
app.get('/health', (req, res) => {
    const stats = fs.existsSync(DATA_FILE) ? fs.statSync(DATA_FILE) : null;
    const testMode = dataCache.settings ? dataCache.settings.testMode : false;
    const pdfCount = dataCache.pdfs ? Object.keys(dataCache.pdfs).length : 0;
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        dataFile: DATA_FILE,
        dataExists: fs.existsSync(DATA_FILE),
        dataSize: stats ? stats.size : 0,
        recordCount: dataCache.employees ? dataCache.employees.length : 0,
        pdfCount: pdfCount,
        storageLocation: activeDataDir,
        testMode: testMode
    });
});

// Serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// SPA support
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
    console.log('🔄 Received SIGTERM, saving data before shutdown...');
    if (dataCache) {
        try {
            if (!dataCache.settings) {
                dataCache.settings = { testMode: false };
            }
            fs.writeFileSync(DATA_FILE, JSON.stringify(dataCache, null, 2));
            console.log('✅ Data saved before shutdown');
        } catch (error) {
            console.error('❌ Error saving data on shutdown:', error);
        }
    }
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🔄 Received SIGINT, saving data before shutdown...');
    if (dataCache) {
        try {
            if (!dataCache.settings) {
                dataCache.settings = { testMode: false };
            }
            fs.writeFileSync(DATA_FILE, JSON.stringify(dataCache, null, 2));
            console.log('✅ Data saved before shutdown');
        } catch (error) {
            console.error('❌ Error saving data on shutdown:', error);
        }
    }
    process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught exception:', error);
    if (dataCache) {
        try {
            if (!dataCache.settings) {
                dataCache.settings = { testMode: false };
            }
            fs.writeFileSync(DATA_FILE, JSON.stringify(dataCache, null, 2));
            console.log('✅ Data saved before crash');
        } catch (e) {
            console.error('❌ Error saving data on crash:', e);
        }
    }
    process.exit(1);
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    const testMode = dataCache.settings ? dataCache.settings.testMode : false;
    const pdfCount = dataCache.pdfs ? Object.keys(dataCache.pdfs).length : 0;
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`📁 Data directory: ${activeDataDir}`);
    console.log(`📄 Data file: ${DATA_FILE}`);
    console.log(`👥 Employees: ${dataCache.employees ? dataCache.employees.length : 0}`);
    console.log(`📄 PDFs: ${pdfCount}`);
    console.log(`📅 Last updated: ${dataCache.lastUpdated || 'Never'}`);
    console.log(`🔒 Test Mode: ${testMode ? 'ON' : 'OFF'}`);
});
