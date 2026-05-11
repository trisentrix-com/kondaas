# 1. Use the Node 20 environment
FROM node:20-slim

# 2. Install Puppeteer dependencies for Linux
# This installs Chromium and the libraries needed to run a "headless" browser
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 \
    --no-install-recommends && rm -rf /var/lib/apt/lists/*

# 3. Create the working directory inside the "box"
WORKDIR /app

# 4. Copy your package files first
COPY package*.json ./

# 5. Install your dependencies inside the box
RUN npm install

# 6. Copy the rest of your code
COPY . .

# 7. Open Port 3000 (Adjusted to your 3002)
EXPOSE 3002

# 8. The command to start the server
CMD ["node", "index.js"]