const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();

// Configuration
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const PORT = process.env.PORT || 3000;

console.log('🚀 Starting server...');
console.log('📁 Current directory:', __dirname);
console.log('📂 Data directory:', DATA_DIR);
console.log('📄 Data file:', DATA_FILE);

// Ensure data directory exists with proper permissions
function ensureDataDirectory() {
    try {
        // Check if we can write to the directory
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
            console.log('✅ Created data directory');
        }
        
        // Test write permission
        const testFile = path.join(DATA_DIR, '.write-test');
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);
        console.log('✅ Data directory is writable');
        
    } catch (error) {
        console.error('❌ Error with data directory:', error);
        // Fallback to local directory
        console.log('⚠️ Falling back to local data directory');
        const localDir = path.join(__dirname, 'local-data');
        if (!fs.existsSync(localDir)) {
            fs.mkdirSync(localDir, { recursive: true });
        }
        return localDir;
    }
    return DATA_DIR;
}

// Initialize data directory
const activeDataDir = ensureDataDirectory();
const activeDataFile = path.join(activeDataDir, 'data.json');

// Update DATA_FILE to use the active directory
const FINAL_DATA_FILE = activeDataFile;

console.log('📁 Using data file:', FINAL_DATA_FILE);

// Initialize data file if it doesn't exist
try {
    if (!fs.existsSync(FINAL_DATA_FILE)) {
        const initialData = { 
            employees: [], 
            pdfs: {}, 
            settings: { testMode: false },
            lastUpdated: new Date().toISOString()
        };
        fs.writeFileSync(FINAL_DATA_FILE, JSON.stringify(initialData, null, 2));
        console.log('✅ Created new data file');
    } else {
        // Verify data file is valid
        const data = fs.readFileSync(FINAL_DATA_FILE, 'utf8');
        JSON.parse(data);
        console.log('✅ Data file is valid');
    }
} catch (error) {
    console.error('❌ Error with data file:', error);
    // Create backup of corrupted file
    if (fs.existsSync(FINAL_DATA_FILE)) {
        const backupFile = FINAL_DATA_FILE + '.backup';
        fs.copyFileSync(FINAL_DATA_FILE, backupFile);
        console.log(`📦 Created backup at ${backupFile}`);
    }
    // Create fresh file
    const initialData = { 
        employees: [], 
        pdfs: {}, 
        settings: { testMode: false },
        lastUpdated: new Date().toISOString()
    };
    fs.writeFileSync(FINAL_DATA_FILE, JSON.stringify(initialData, null, 2));
    console.log('✅ Created fresh data file');
}

// Backup data function
function backupData() {
    try {
        if (fs.existsSync(FINAL_DATA_FILE)) {
            const backupDir = path.join(activeDataDir, 'backups');
            if (!fs.existsSync(backupDir)) {
                fs.mkdirSync(backupDir, { recursive: true });
            }
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupFile = path.join(backupDir, `data-${timestamp}.json`);
            fs.copyFileSync(FINAL_DATA_FILE, backupFile);
            console.log(`📦 Backup created: ${backupFile}`);
            
            // Keep only last 5 backups
            const files = fs.readdirSync(backupDir).filter(f => f.startsWith('data-')).sort();
            while (files.length > 5) {
                const oldFile = path.join(backupDir, files.shift());
                fs.unlinkSync(oldFile);
                console.log(`🗑️ Removed old backup: ${oldFile}`);
            }
        }
    } catch (error) {
        console.error('❌ Backup failed:', error);
    }
}

// Run backup every hour
setInterval(backupData, 3600000);

// Also backup on shutdown
process.on('SIGINT', () => {
    console.log('📦 Creating backup before shutdown...');
    backupData();
    process.exit();
});

process.on('SIGTERM', () => {
    console.log('📦 Creating backup before shutdown...');
    backupData();
    process.exit();
});

// Middleware
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

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

// Serve static files from public directory
app.use(express.static('public'));

// API Routes
app.get('/api/data', (req, res) => {
    try {
        console.log('📖 Reading data from:', FINAL_DATA_FILE);
        const data = fs.readFileSync(FINAL_DATA_FILE, 'utf8');
        const parsedData = JSON.parse(data);
        
        // Ensure settings exists
        if (!parsedData.settings) {
            parsedData.settings = { testMode: false };
        }
        
        // Add metadata
        parsedData._meta = {
            lastUpdated: parsedData.lastUpdated || new Date().toISOString(),
            recordCount: parsedData.employees ? parsedData.employees.length : 0,
            pdfCount: parsedData.pdfs ? Object.keys(parsedData.pdfs).length : 0
        };
        
        res.json(parsedData);
    } catch (error) {
        console.error('❌ Error reading data:', error);
        res.status(500).json({ 
            error: 'Error reading data', 
            details: error.message 
        });
    }
});

app.post('/api/data', (req, res) => {
    try {
        console.log('💾 Saving data to:', FINAL_DATA_FILE);
        const data = req.body;
        
        if (!data || typeof data !== 'object') {
            return res.status(400).json({ error: 'Invalid data format' });
        }
        
        // Ensure required fields
        if (!data.employees) data.employees = [];
        if (!data.pdfs) data.pdfs = {};
        if (!data.settings) data.settings = { testMode: false };
        
        // Add timestamp
        data.lastUpdated = new Date().toISOString();
        
        // Write to a temp file first, then rename for atomic operation
        const tempFile = FINAL_DATA_FILE + '.tmp';
        fs.writeFileSync(tempFile, JSON.stringify(data, null, 2));
        fs.renameSync(tempFile, FINAL_DATA_FILE);
        
        console.log('✅ Data saved successfully');
        console.log(`📊 ${data.employees.length} employees, ${Object.keys(data.pdfs).length} PDFs`);
        
        res.json({ 
            success: true, 
            message: 'Data saved successfully',
            lastUpdated: data.lastUpdated
        });
    } catch (error) {
        console.error('❌ Error saving data:', error);
        res.status(500).json({ 
            error: 'Error saving data', 
            details: error.message 
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    try {
        const stats = fs.statSync(FINAL_DATA_FILE);
        res.status(200).json({ 
            status: 'OK', 
            timestamp: new Date().toISOString(),
            dataFile: FINAL_DATA_FILE,
            dataSize: stats.size,
            dataExists: fs.existsSync(FINAL_DATA_FILE)
        });
    } catch (error) {
        res.status(200).json({ 
            status: 'OK', 
            timestamp: new Date().toISOString(),
            dataFile: FINAL_DATA_FILE,
            error: error.message
        });
    }
});

// IMPORTANT: Serve index.html for root path
app.get('/', (req, res) => {
    console.log('📄 Serving index.html');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// For any other route, serve index.html (SPA support)
app.get('*', (req, res) => {
    console.log('📄 Serving index.html for:', req.url);
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('❌ Server error:', err);
    res.status(500).json({ 
        error: 'Internal server error', 
        details: err.message 
    });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🌐 URL: http://localhost:${PORT}`);
    console.log(`📁 Data directory: ${activeDataDir}`);
    console.log(`📄 Data file: ${FINAL_DATA_FILE}`);
    
    // Log data file stats
    try {
        const stats = fs.statSync(FINAL_DATA_FILE);
        console.log(`📊 Data file size: ${stats.size} bytes`);
        const data = JSON.parse(fs.readFileSync(FINAL_DATA_FILE, 'utf8'));
        console.log(`👥 Employees: ${data.employees ? data.employees.length : 0}`);
        console.log(`📄 PDFs: ${data.pdfs ? Object.keys(data.pdfs).length : 0}`);
        console.log(`📅 Last updated: ${data.lastUpdated || 'Never'}`);
    } catch (error) {
        console.log('⚠️ Could not read data file stats');
    }
});
