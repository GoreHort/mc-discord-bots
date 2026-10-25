FROM node:20-bullseye-slim

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install --omit=dev --no-fund --no-audit

# Copy project files
COPY . .

# Port 7860 is required for Hugging Face Spaces
EXPOSE 7860

CMD ["node", "index.js"]
