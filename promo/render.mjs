// 紹介動画を書き出す: node promo/render.mjs → promo/out/ichiensoman.mp4
// promo/index.html をヘッドレスの Chromium で開き、1 コマずつ描かせて ffmpeg に渡す。
// 音（筆の擦れと太鼓）はコマごとの筆の速さからここで合成する。要るもの: playwright、ffmpeg

import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'promo', 'out');
await mkdir(out, { recursive: true });

const types = { '.html': 'text/html', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  try {
    const body = await readFile(join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
    res.writeHead(200, { 'content-type': types[extname(req.url.split('?')[0])] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end(); }
}).listen(0);
const port = server.address().port;

async function launch() {
  try { return await chromium.launch(); } catch (e) {
    // playwright の版に合うブラウザが無いときは、手元にあるものを使う
    const base = join(homedir(), '.cache/ms-playwright');
    const dirs = (await readdir(base)).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse();
    if (!dirs.length) throw e;
    return chromium.launch({ executablePath: join(base, dirs[0], 'chrome-headless-shell-linux64/chrome-headless-shell') });
  }
}
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
page.on('pageerror', (e) => console.error(e));
await page.goto(`http://127.0.0.1:${port}/promo/index.html`);
await page.waitForFunction(() => window.promoReady);
const { FPS, LENGTH, HITS } = await page.evaluate(() => ({ FPS: promo.FPS, LENGTH: promo.LENGTH, HITS: promo.HITS }));

const silent = join(out, 'video.mp4');
const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow', silent], { stdio: ['pipe', 'inherit', 'inherit'] });
const speeds = [];
const N = Math.round(FPS * LENGTH);
for (let i = 0; i < N; i++) {
  const { img, speed } = await page.evaluate((i) => promo.frame(i), i);
  speeds.push(speed);
  if (!ff.stdin.write(Buffer.from(img.split(',')[1], 'base64'))) await new Promise((r) => ff.stdin.once('drain', r));
  if (i % 60 === 0) process.stdout.write(`\r${i}/${N}`);
}
ff.stdin.end();
await new Promise((r) => ff.on('close', r));
await browser.close();
server.close();
console.log(`\r${N}/${N} コマ`);

// 音
const RATE = 48000, n = Math.round(LENGTH * RATE);
const buf = new Float32Array(n);
let seed = 1;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
// 筆の擦れ: 帯域を絞った雑音を、筆の速さで鳴らす
let lp1 = 0, lp2 = 0, amp = 0;
const a1 = 1 - Math.exp(-2 * Math.PI * 2600 / RATE), a2 = 1 - Math.exp(-2 * Math.PI * 350 / RATE);
for (let k = 0; k < n; k++) {
  const f = Math.min(speeds.length - 1, Math.floor((k / RATE) * FPS));
  const target = speeds[f] > 0 ? 0.25 + 0.75 * Math.min(1, speeds[f] / 2.5) ** 0.7 : 0;
  amp += (target - amp) * (target > amp ? 0.004 : 0.0015);
  const w = rnd();
  lp1 += (w - lp1) * a1; lp2 += (w - lp2) * a2;
  const grit = Math.random() < 0.002 * amp ? rnd() * 0.6 : 0;
  buf[k] = ((lp1 - lp2) * 1.6 + grit) * amp * 0.5;
}
// 太鼓: 下がっていく低い音と、打った瞬間の雑音。残響を少し
for (const h of HITS) {
  const s0 = Math.round(h * RATE);
  let ph = 0;
  for (let k = 0; k < RATE * 1.6 && s0 + k < n; k++) {
    const t = k / RATE;
    const fr = 52 + 70 * Math.exp(-t / 0.06);
    ph += 2 * Math.PI * fr / RATE;
    const v = Math.sin(ph) * Math.exp(-t / 0.42) * 0.9 + rnd() * Math.exp(-t / 0.012) * 0.35;
    for (const [d, gain] of [[0, 1], [0.11, 0.28], [0.23, 0.16], [0.37, 0.09]]) {
      const at = s0 + k + Math.round(d * RATE);
      if (at < n) buf[at] += v * gain;
    }
  }
}
let peak = 0;
for (const v of buf) peak = Math.max(peak, Math.abs(v));
const wav = Buffer.alloc(44 + n * 2);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + n * 2, 4); wav.write('WAVE', 8); wav.write('fmt ', 12);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(RATE, 24);
wav.writeUInt32LE(RATE * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(n * 2, 40);
for (let k = 0; k < n; k++) wav.writeInt16LE(Math.round((buf[k] / peak) * 0.89 * 32767), 44 + k * 2);
const audio = join(out, 'audio.wav');
await writeFile(audio, wav);

const final = join(out, 'ichiensoman.mp4');
await new Promise((r, j) => spawn('ffmpeg', ['-y', '-loglevel', 'error', '-i', silent, '-i', audio, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', final], { stdio: 'inherit' })
  .on('close', (c) => (c ? j(new Error(`ffmpeg ${c}`)) : r())));
console.log(final);
