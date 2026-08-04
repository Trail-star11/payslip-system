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
console.log('📂 Public directory:', path.join(__dirname, 'public'));

// Ensure data directory exists
try {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        console.log('✅ Created data directory');
    }
    
    if (!fs.existsSync(DATA_FILE)) {
        const initialData = { employees: [], pdfs: {}, settings: { testMode: false } };
        fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2));
        console.log('✅ Created data file');
    }
} catch (error) {
    console.error('❌ Error setting up data directory:', error);
}

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
        console.log('📖 Reading data from:', DATA_FILE);
        const data = fs.readFileSync(DATA_FILE, 'utf8');
        const parsedData = JSON.parse(data);
        // Ensure settings exists
        if (!parsedData.settings) {
            parsedData.settings = { testMode: false };
        }
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
        console.log('💾 Saving data to:', DATA_FILE);
        const data = req.body;
        
        if (!data || typeof data !== 'object') {
            return res.status(400).json({ error: 'Invalid data format' });
        }
        
        if (!data.employees) data.employees = [];
        if (!data.pdfs) data.pdfs = {};
        if (!data.settings) data.settings = { testMode: false };
        
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        console.log('✅ Data saved successfully');
        res.json({ success: true, message: 'Data saved successfully' });
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
    res.status(200).json({ 
        status: 'OK', 
        timestamp: new Date().toISOString()
    });
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
    console.log(`📁 Data directory: ${DATA_DIR}`);
});
