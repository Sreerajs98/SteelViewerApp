/* Static dev server for the viewer UI.
 *
 * Serves the real Viewer3D.html + viewer/js/* unmodified, so what renders here
 * is exactly what the WinForms WebView2 host renders. The scene JSON that the
 * C# side normally pushes is exposed at /scene.json.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const APP_ROOT = path.resolve(__dirname, '..');
// SCENE=devharness/scenes/a1410.json pins a run to one job. Without it the
// live cache is used, which the WinForms app can overwrite mid-run.
const SCENE_FILE = process.env.SCENE
  ? path.resolve(__dirname, process.env.SCENE)
  : path.join(APP_ROOT, 'bin', 'Debug', 'net8.0-windows', '_scene_cache.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function send(res, code, body, type) {
  res.writeHead(code, {
    'Content-Type': type || 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/Viewer3D.html';

  const filePath = urlPath === '/scene.json'
    ? SCENE_FILE
    : path.join(APP_ROOT, urlPath);

  // Keep reads inside the app folder (plus the scene file)
  if (filePath !== SCENE_FILE && !filePath.startsWith(APP_ROOT)) {
    return send(res, 403, 'Forbidden');
  }

  fs.readFile(filePath, (err, buf) => {
    if (err) return send(res, 404, 'Not found: ' + urlPath);
    send(res, 200, buf, MIME[path.extname(filePath).toLowerCase()]);
  });
});

const PORT = Number(process.env.PORT) || 5178;
server.listen(PORT, '127.0.0.1', () => {
  console.log(`viewer dev server: http://127.0.0.1:${PORT}/Viewer3D.html`);
  console.log(`scene json:        http://127.0.0.1:${PORT}/scene.json`);
});
