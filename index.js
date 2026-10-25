// index.js - Minimal runner for Alt Bot (b2)
const fs = require('fs');
const { execSync } = require('child_process');

// 1. Auto-install dependencies if node_modules is missing
if (!fs.existsSync('./node_modules')) {
  console.log('[INSTALL] Installing minimal bot dependencies...');
  try {
    execSync('npm install --cache /tmp/.npm --omit=dev --no-fund --no-audit', { stdio: 'inherit' });
    console.log('[INSTALL] Dependencies installed successfully!');
  } catch (err) {
    console.error('[INSTALL ERROR] npm install failed:', err.message);
  }
}

// 2. Load environment variables
try {
  require('dotenv').config();
} catch (e) {}

const http = require('http');

// 3. Lightweight Health-Check HTTP Server
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'ONLINE',
    bot: 'alt-b2',
    uptime: Math.floor(process.uptime()),
    memoryUsageMB: Math.round(process.memoryUsage().rss / 1024 / 1024)
  }));
});

server.listen(PORT, () => {
  console.log(`[HTTP] Health check server listening on port ${PORT}`);
});

// 4. Start Alt Bot
console.log('[SYSTEM] Starting Alt Bot (b2)...');
require('./alt.js');
