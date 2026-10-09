// 과제함 60초 홍보 영상 렌더러
// index.html 의 window.render(t) 를 프레임마다 호출해 캡처하고 ffmpeg 로 인코딩한 뒤,
// music.py 로 만든 음악·효과음을 합칩니다.
//
//   node render.mjs                         # 전체 영상 → out/gwajeham-60s.mp4
//   node render.mjs --url https://...       # 끝 장면에 주소 + QR 넣기
//   node render.mjs --still 0.9,14,30       # 지정한 시각의 정지 화면만 out/stills/ 에 저장
//   node render.mjs --fps 60 --workers 4
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import QRCode from 'qrcode';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => {
  if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return a;
}, []));
const FPS = +(args.fps || 30);
const WORKERS = +(args.workers || 4);
const OUT_DIR = path.join(ROOT, 'out');
const OUT = path.resolve(args.out || path.join(OUT_DIR, 'gwajeham-60s.mp4'));
const TMP = path.join(OUT_DIR, '.tmp');
fs.mkdirSync(TMP, { recursive: true });

const MIME = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.woff2': 'font/woff2', '.js': 'text/javascript' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/index.html`;

const config = { url: args.url && args.url !== true ? args.url : '' };
if (config.url) config.qrSvg = await QRCode.toString(config.url, { type: 'svg', margin: 0, color: { dark: '#111111', light: '#ffffff' } });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
async function openPage() {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.addInitScript(c => { window.CONFIG = c; }, config);
  await page.goto(BASE);
  await page.evaluate(() => window.ready);
  return page;
}
const run = (cmd, a, opts = {}) => new Promise((res, rej) => {
  const p = spawn(cmd, a, { stdio: ['pipe', 'inherit', 'inherit'], ...opts });
  p.on('exit', c => (c ? rej(new Error(`${cmd} exited ${c}`)) : res()));
});

if (args.still) {
  const page = await openPage();
  const dir = path.join(OUT_DIR, 'stills');
  fs.mkdirSync(dir, { recursive: true });
  for (const t of String(args.still).split(',').map(Number)) {
    await page.evaluate(t => window.render(t), t);
    await page.screenshot({ path: path.join(dir, `t${t.toFixed(2).padStart(5, '0')}.png`) });
    console.log('still', t);
  }
  await browser.close(); server.close();
  process.exit(0);
}

// ---- video frames, split across workers; each worker encodes its own segment ----
const meta = await (async () => { const p = await openPage(); const m = await p.evaluate(() => ({ d: window.DURATION, sfx: window.SFX })); await p.close(); return m; })();
const N = Math.round(meta.d * FPS);
const per = Math.ceil(N / WORKERS);
const t0 = Date.now();
let done = 0;
await Promise.all(Array.from({ length: WORKERS }, async (_, w) => {
  const from = w * per, to = Math.min(N, from + per);
  if (from >= to) return;
  const page = await openPage();
  const seg = path.join(TMP, `seg${w}.mp4`);
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-tune', 'animation', '-r', String(FPS), seg],
    { stdio: ['pipe', 'inherit', 'inherit'] });
  const closed = new Promise((res, rej) => ff.on('exit', c => (c ? rej(new Error('ffmpeg ' + c)) : res())));
  for (let f = from; f < to; f++) {
    await page.evaluate(t => window.render(t), f / FPS);
    const buf = await page.screenshot({ type: 'png' });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (++done % 150 === 0) console.log(`frames ${done}/${N}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  ff.stdin.end();
  await closed;
  await page.close();
}));
await browser.close(); server.close();

const list = path.join(TMP, 'list.txt');
fs.writeFileSync(list, Array.from({ length: WORKERS }, (_, w) => `file 'seg${w}.mp4'`).filter((_, w) => w * per < N).join('\n'));
const silent = path.join(TMP, 'video.mp4');
await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', silent]);

// ---- audio: synthesized music + sound effects from the cue sheet ----
const cues = path.join(TMP, 'sfx.json');
fs.writeFileSync(cues, JSON.stringify(meta.sfx, null, 1));
const wav = path.join(TMP, 'audio.wav');
await run('python3', [path.join(ROOT, 'music.py'), cues, wav, String(meta.d)]);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', silent, '-i', wav,
  '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest', '-movflags', '+faststart', OUT]);
console.log(`done → ${OUT}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
