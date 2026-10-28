// Pre-renders the robot cell as WebP frames for browsers without GPU acceleration.
// Re-run whenever the robot, the cell layout, the lighting or the timeline (cell.js) changes:
//
//   npm i -D playwright && npx playwright install chromium   (once)
//   node tools/render-frames.mjs [--quality 0.72] [--px 9] [--only 0,40,90]
//
// It writes frames/<version>/f0000.webp… plus manifest.json, and points
// frames/current.json at it. Each run makes a NEW version folder: frames are cached as
// immutable, so never overwrite one. Delete the old version folder once the new one is committed.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const framesDir = path.join(siteRoot, 'frames');
const args = process.argv.slice(2);
const opt = (name, dflt) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : dflt;
};
const quality = Number(opt('quality', '0.72'));
const px = Number(opt('px', '9'));
const only = opt('only', '') ? opt('only').split(',').map(Number) : null;

const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
const server = http.createServer((req, res) => {
    const file = path.join(siteRoot, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(siteRoot) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

// Software GL works everywhere (slow but deterministic); behind a proxy, route through it for the fonts.
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    ...(proxy ? { proxy: { server: proxy, bypass: '127.0.0.1,localhost' } } : {})
});
const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
page.on('pageerror', e => console.error('page error:', e.message));
await page.goto(`http://127.0.0.1:${port}/tools/render-frames.html?px=${px}`);
await page.waitForFunction(() => window.rendererReady, null, { timeout: 300000 });
const info = await page.evaluate(() => window.frameInfo);
console.log(`${info.frames.length} frames to render (signature ${info.signature})`);

const version = `v${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12)}`;
const outDir = path.join(framesDir, only ? `test-${version}` : version);
fs.mkdirSync(outDir, { recursive: true });

const list = only || info.frames.map((_, i) => i);
let bytes = 0;
const t0 = Date.now();
for (const [n, i] of list.entries()) {
    const url = await page.evaluate(([i, q]) => window.renderFrame(i, q), [i, quality]);
    const buf = Buffer.from(url.split(',')[1], 'base64');
    fs.writeFileSync(path.join(outDir, `f${String(i).padStart(4, '0')}.webp`), buf);
    bytes += buf.length;
    if (n % 25 === 0 || n === list.length - 1) {
        console.log(`frame ${i} (${n + 1}/${list.length}) ${(buf.length / 1024).toFixed(0)} KB, ${((Date.now() - t0) / (n + 1) / 1000).toFixed(2)}s/frame`);
    }
}

fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({ ...info, pattern: 'f{i}.webp', pad: 4 }));
if (!only) fs.writeFileSync(path.join(framesDir, 'current.json'), JSON.stringify({ dir: `frames/${version}/` }));
console.log(`\n${list.length} frames, ${(bytes / 1024 / 1024).toFixed(1)} MB total → ${path.relative(siteRoot, outDir)}`);
await browser.close();
server.close();
