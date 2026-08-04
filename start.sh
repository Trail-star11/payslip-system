#!/bin/bash

echo "🚀 Starting Payslip System..."
echo "📁 Current directory: $(pwd)"

# Ensure data directory exists with proper permissions
echo "📂 Setting up data directories..."

# Primary data directory (Render's persistent disk)
if [ -d "/data" ]; then
    echo "✅ /data directory exists"
    chmod -R 755 /data
else
    echo "⚠️ /data directory not found, creating..."
    mkdir -p /data
    chmod 755 /data
fi

# Local backup directory
if [ ! -d "/app/data" ]; then
    echo "📁 Creating local data directory..."
    mkdir -p /app/data
    chmod 755 /app/data
fi

# Check if data file exists, if not, create it
if [ ! -f "/data/data.json" ] && [ ! -f "/app/data/data.json" ]; then
    echo "📄 Creating initial data file..."
    echo '{"employees":[],"pdfs":{},"settings":{"testMode":false},"lastUpdated":"'$(date -Iseconds)'"}' > /data/data.json
    chmod 644 /data/data.json
    cp /data/data.json /app/data/data.json 2>/dev/null || true
fi

# Check if data file exists in primary location
if [ -f "/data/data.json" ]; then
    echo "✅ Data file found in /data"
    # Copy to local backup if it doesn't exist
    if [ ! -f "/app/data/data.json" ]; then
        cp /data/data.json /app/data/data.json 2>/dev/null || true
    fi
elif [ -f "/app/data/data.json" ]; then
    echo "✅ Data file found in local backup"
    # Copy to primary location
    cp /app/data/data.json /data/data.json 2>/dev/null || true
else
    echo "⚠️ No data file found, creating new one..."
    echo '{"employees":[],"pdfs":{},"settings":{"testMode":false},"lastUpdated":"'$(date -Iseconds)'"}' > /data/data.json
    chmod 644 /data/data.json
fi

# Show data file info
if [ -f "/data/data.json" ]; then
    FILE_SIZE=$(ls -lh /data/data.json | awk '{print $5}')
    echo "📊 Data file size: $FILE_SIZE"
    # Show first few characters to verify it's valid
    head -c 200 /data/data.json | echo "📄 Data preview: $(cat)"
fi

echo "✅ Setup complete! Starting server..."
echo "🌐 Server will run on port $PORT"

# Start the Node.js server
exec node server.js
