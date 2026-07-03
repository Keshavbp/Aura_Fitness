const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = 3000;

// MIME types mapping
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  const host = req.headers.host || '';
  const url = new URL(req.url, `http://${host}`);
  let pathname = url.pathname;

  // 1.5 API Proxying (mimicking vercel.json rewrite rule)
  if (pathname.startsWith('/api')) {
    const backendUrl = `https://aura-fitness-backend.vercel.app${pathname}${url.search}`;
    const options = {
      method: req.method,
      headers: {
        ...req.headers,
        host: 'aura-fitness-backend.vercel.app'
      }
    };

    const proxyReq = https.request(backendUrl, options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error('API Proxy error:', err);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Proxy Proxy Error');
    });

    req.pipe(proxyReq);
    return;
  }

  // 2. Resolve file path
  let filePath = path.join(__dirname, pathname);
  
  // If it's a directory (or /), look for index.html
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  // 3. Serve the file
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`
   ┌───────────────────────────────────────────┐
   │                                           │
   │   Aura Fitness Dev Server Running!        │
   │                                           │
   │   - Public Site: http://localhost:3000    │
   │   - Admin Site:  http://localhost:3000/admin
   │                                           │
   └───────────────────────────────────────────┘
  `);
});
