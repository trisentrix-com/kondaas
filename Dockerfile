# ==========================================
# STAGE 1: The Build Environment (Builder)
# ==========================================
FROM node:20-slim AS builder
WORKDIR /app

COPY package*.json ./

# Pinned cache directory for Puppeteer's Chrome build inside the project
ENV PUPPETEER_CACHE_DIR=/app/.cache
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false

# Clean, production-only dependency install
RUN npm ci --only=production

# Copy the rest of your application source code
COPY . .


# ==========================================
# STAGE 2: The Lean Production Runner
# ==========================================
FROM node:20-slim
WORKDIR /app

# Ensure Puppeteer knows exactly where to look for the copied browser build
ENV PUPPETEER_CACHE_DIR=/app/.cache

# Install the absolute minimal baseline dependencies for headless Chrome
RUN apt-get update && apt-get install -y \
    wget \
    ca-certificates \
    fonts-freefont-ttf \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libxtst6 \
    libgbm1 \
    libnss3 \
    libasound2 \
    libpangocairo-1.0-0 \
    libpango-1.0-0 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# 🔥 OPTIMIZATION: Copy ONLY your actual source code and node_modules.
# This leaves behind the massive npm cache folder sitting in Stage 1!
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.cache ./.cache
COPY --from=builder /app/src ./src
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/index.js ./

# Open Port 3002
EXPOSE 3002

# Start the application
CMD ["node", "index.js"]