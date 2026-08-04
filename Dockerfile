# Use Node.js 18 Alpine (smaller image size)
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Create data directory for persistent storage
RUN mkdir -p /data && chmod 755 /data

# Copy package files first (for better caching)
COPY package*.json ./

# Install production dependencies only
RUN npm install --production

# Copy application files
COPY . .

# Create local backup directory
RUN mkdir -p /app/data && chmod 755 /app/data

# Make start.sh executable
RUN chmod +x start.sh

# Switch to non-root user for security
USER node

# Expose the port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {r.statusCode === 200 ? process.exit(0) : process.exit(1)})"

# Start the application using start.sh
CMD ["./start.sh"]
