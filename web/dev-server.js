const http = require('http');
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

  // 1. Subdomain routing simulation
  const isAdminSubdomain = host.startsWith('admin.');

  if (isAdminSubdomain) {
    // Serve from /admin folder internally
    if (!pathname.startsWith('/admin')) {
      pathname = `/admin${pathname}`;
    }
  } else {
    // If accessing /admin on the main domain, redirect to admin.localhost
    if (pathname.startsWith('/admin')) {
      const hostPart = host.split(':')[0];
      const portPart = host.split(':')[1] ? `:${host.split(':')[1]}` : '';
      
      let targetHost = 'admin.localhost';
      if (hostPart !== 'localhost' && hostPart !== '127.0.0.1') {
        targetHost = `admin.${hostPart}`;
      }

      const redirectUrl = `http://${targetHost}${portPart}${pathname.substring(6) || '/'}`;
      
      res.writeHead(301, { Location: redirectUrl });
      res.end();
      return;
    }
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
   │   Subdomain Dev Server Running!           │
   │                                           │
   │   - Public Site: http://localhost:3000    │
   │   - Admin Site:  http://admin.localhost:3000
   │                                           │
   │   (Requires hosts file mapping:           │
   │    127.0.0.1 admin.localhost)             │
   │                                           │
   └───────────────────────────────────────────┘
  `);
});
