# 1. Use the Node 20 environment
FROM node:20-slim

# 2. Create the working directory inside the "box"
WORKDIR /app

# 3. Copy your package files first
COPY package*.json ./

# 4. Install your dependencies inside the box
RUN npm install

# 5. Copy the rest of your code
COPY . .

# 6. Open Port 3000
EXPOSE 3002

# 7. The command to start the server
CMD ["node", "index.js"]