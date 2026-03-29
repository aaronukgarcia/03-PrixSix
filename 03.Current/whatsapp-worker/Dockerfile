# Baileys-based WhatsApp worker — no Chromium needed (WebSocket protocol)
FROM node:20-bookworm-slim

# Set working directory
WORKDIR /app

# Minimal system deps (ca-certificates for HTTPS, wget for health check)
RUN apt-get update && apt-get install -y \
    ca-certificates \
    wget \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user for security
RUN groupadd -r appuser && useradd -r -g appuser appuser \
    && mkdir -p /home/appuser /app/auth_info \
    && chown -R appuser:appuser /home/appuser /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --omit=dev

# Copy source code
COPY --chown=appuser:appuser . .

# Build TypeScript
RUN npm run build

# Switch to non-root user
USER appuser

# Expose health check port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start the worker
CMD ["node", "dist/index.js"]
