import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const port = Number(process.env.PORT || 5000);
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.json':'application/json; charset=utf-8', '.ico':'image/x-icon', '.png':'image/png', '.jpg':'image/jpeg', '.webp':'image/webp' };
http.createServer((req,res)=>{
  let decoded;
  try { decoded = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400); res.end('Bad request'); return; }
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep) && file !== path.join(root,'index.html')) { res.writeHead(403); res.end('Forbidden'); return; }
  if (!existsSync(file) || !statSync(file).isFile()) {
    const notFound = path.join(root,'404.html');
    res.writeHead(404, {'Content-Type':'text/html; charset=utf-8'});
    createReadStream(notFound).pipe(res); return;
  }
  res.writeHead(200, {'Content-Type':types[path.extname(file).toLowerCase()] || 'application/octet-stream','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'});
  createReadStream(file).pipe(res);
}).listen(port,()=>console.log('StageHub running at http://localhost:'+port));
