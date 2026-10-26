// 紹介動画のコマを描く。ゲームと同じ筆・お題・採点を使い、時刻はコマごとに進める（実時間に左右されない）。
// render.mjs が frame(i) を順に呼んで画像を受け取り、動画にする。

import { Brush } from '../src/brush.js';
import { makeOdai, playInto, CW } from '../src/odai.js';
import { score, GRID } from '../src/score.js';
import { makePaper } from '../src/paper.js';

export const W = 1080, H = 1920, FPS = 30, LENGTH = 25;
const P = 960, PX = 60, PY = 520; // 紙の大きさと位置
const SERIF = "'Noto Serif CJK JP', serif";

const canvas = document.getElementById('c');
canvas.width = W; canvas.height = H;
const g = canvas.getContext('2d');

const title = new Image();
title.src = '../img/title.jpg';
await title.decode();
await document.fonts.load(`700 76px ${SERIF}`);

const paper = makePaper(P);
const ink = () => {
  const c = new OffscreenCanvas(P, P);
  const x = c.getContext('2d');
  x.setTransform(P, 0, 0, P, 0, 0); x.lineCap = 'butt';
  return { c, x };
};
const odai = makeOdai(CW);
const odaiInk = ink();
const odaiRec = playInto(new Brush(odaiInk.x, 1), odai).record;

// 筆を時刻どおりに進める
class Feeder {
  constructor(layer, samples, end, start, seed) {
    Object.assign(this, { samples, end, start, i: 0, ended: false });
    this.brush = new Brush(layer.x, seed);
  }
  update(t) {
    const local = t - this.start;
    if (local < 0 || this.ended) return 0;
    const b = this.brush, ss = this.samples;
    if (this.i === 0) { b.start(ss[0].x, ss[0].y, ss[0].t); this.i = 1; }
    while (this.i < ss.length && ss[this.i].t <= local) { b.move(ss[this.i].x, ss[this.i].y, ss[this.i].t); this.i++; }
    if (local >= this.end) { b.end(this.end); this.ended = true; return 0; }
    return Math.hypot(b.vx, b.vy);
  }
}

// 人がなぞったような手の動き: お題を少し揺らし、少しゆっくり
// （採点で朱と青がちゃんと見えるくらい。五段 87 点になる）
const WARP = 1.15;
const player = odai.samples.map((s) => {
  const k = 1 + 0.03 * Math.sin(s.t * 4.3 + 0.7);
  return { x: 0.5 + (s.x - 0.5) * k + 0.008, y: 0.5 + (s.y - 0.5) * k - 0.0056, t: s.t * WARP };
});

// 速さと太さの見せ場の手の動き
const line = (y, dur, dwell = 0, from = 0.14, to = 0.86, wave = 0.025) => {
  const out = [];
  for (let t = 0; t < dwell; t += 1 / 120) out.push({ x: from, y, t });
  for (let t = 0; t <= dur; t += 1 / 120) {
    const u = t / dur, e = u * u * (3 - 2 * u);
    out.push({ x: from + (to - from) * e, y: y + Math.sin(e * Math.PI * 1.5) * wave, t: dwell + t });
  }
  return { samples: out, end: dwell + dur };
};
const slow = line(0.24, 2.0), fast = line(0.52, 0.32), pool = line(0.8, 0.45, 1.3, 0.3, 0.7, 0.01);

const traceInk = ink(), mechInk = ink();
const T = { trace: 4.6, slow: 7.7, fast: 10.2, pool: 11.9, result: 15.4, diff: 16.2, rank: 17.1, end: 20.6 };
const feeders = [
  new Feeder(traceInk, player, odai.end * WARP, T.trace, 1001),
  new Feeder(mechInk, slow.samples, slow.end, T.slow, 7),
  new Feeder(mechInk, fast.samples, fast.end, T.fast, 8),
  new Feeder(mechInk, pool.samples, pool.end, T.pool, 9),
];
let result = null;
const diffLayer = new OffscreenCanvas(GRID, GRID);

export const HITS = [0.35, T.rank, T.end + 0.1]; // 太鼓を鳴らす時刻

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const ease = (x) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
// a〜b の間だけ見え、前後 f 秒で溶ける
const span = (t, a, b, f = 0.4) => Math.min(ease((t - a) / f), ease((b - t) / f));

function caption(text, y, alpha, size = 76, color = '#ece4d3') {
  if (alpha <= 0) return;
  g.globalAlpha = alpha;
  g.fillStyle = color;
  g.font = `700 ${size}px ${SERIF}`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, W / 2, y + (1 - alpha) * 16);
  g.globalAlpha = 1;
}

function drawPaper(alpha, layers) {
  if (alpha <= 0) return;
  g.globalAlpha = alpha;
  g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 40; g.shadowOffsetY = 12;
  g.drawImage(paper, PX, PY);
  g.shadowColor = 'transparent';
  for (const [c, a] of layers) { g.globalAlpha = alpha * a; g.drawImage(c, PX, PY); }
  g.globalAlpha = 1;
}

export function frame(i) {
  const t = i / FPS;
  let speed = 0;
  for (const f of feeders) speed += f.update(t);
  if (!result && feeders[0].ended) {
    result = score(odaiRec, feeders[0].brush.record);
    const d = diffLayer.getContext('2d'), img = d.createImageData(GRID, GRID);
    result.diff.forEach((v, k) => { if (v) img.data.set(v === 1 ? [200, 50, 31, 255] : [40, 90, 170, 255], k * 4); });
    d.putImageData(img, 0, 0);
  }

  g.fillStyle = '#16130f'; g.fillRect(0, 0, W, H);

  // 表紙
  const ta = Math.min(ease(t / 0.8), ease((4.0 - t) / 0.6));
  if (ta > 0) {
    const z = 1 + t * 0.012, w = 1080 * z, h = 1440 * z;
    g.globalAlpha = ta; g.drawImage(title, (W - w) / 2, 240 - (h - 1440) / 2, w, h); g.globalAlpha = 1;
  }

  // なぞる
  const trA = Math.max(span(t, 3.6, T.slow - 0.2, 0.6), span(t, T.result, T.end, 0.6));
  drawPaper(trA, [[odaiInk.c, 0.2], [traceInk.c, 1]]);
  caption('お題の一円相を', 300, span(t, 4.0, T.slow - 0.3));
  caption('一筆でなぞる', 410, span(t, T.trace, T.slow - 0.3));

  // 速さと太さ
  drawPaper(span(t, T.slow - 0.4, T.result - 0.1, 0.5), [[mechInk.c, 1]]);
  caption('ゆっくりは、太く', 340, span(t, T.slow - 0.1, T.fast - 0.2));
  caption('速いと、細くかすれる', 340, span(t, T.fast - 0.1, T.pool - 0.2));
  caption('止まると、墨が溜まる', 340, span(t, T.pool - 0.1, T.result - 0.3));

  // 採点
  if (result) {
    const da = span(t, T.diff, T.end, 0.6) * 0.7;
    if (da > 0) { g.globalAlpha = da; g.imageSmoothingEnabled = true; g.drawImage(diffLayer, PX, PY, P, P); g.globalAlpha = 1; }
    caption('見たままの重なりで採点', 340, span(t, T.result + 0.2, T.end - 0.2));
    const ra = span(t, T.rank, T.end, 0.25);
    if (ra > 0) {
      const pop = 1 + (1 - ease((t - T.rank) / 0.25)) * 0.25;
      g.save(); g.translate(W / 2, 1640); g.scale(pop, pop);
      g.globalAlpha = ra; g.textAlign = 'right'; g.textBaseline = 'alphabetic';
      g.fillStyle = '#e8443a'; g.font = `900 150px ${SERIF}`; g.fillText(result.rank, 60, 50);
      g.textAlign = 'left'; g.fillStyle = '#ece4d3'; g.font = `700 72px ${SERIF}`; g.fillText(`${result.total.toFixed(0)} 点`, 90, 50);
      g.restore(); g.globalAlpha = 1;
    }
    const la = span(t, T.rank + 0.6, T.end - 0.1);
    if (la > 0) {
      g.globalAlpha = la; g.font = `500 40px ${SERIF}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#e0573e'; g.fillText('朱 ＝ 足りない', W / 2 - 190, 1790);
      g.fillStyle = '#6b95dc'; g.fillText('青 ＝ はみ出し', W / 2 + 190, 1790);
      g.globalAlpha = 1;
    }
  }

  // 締め
  const ea = Math.min(ease((t - T.end) / 0.8), ease((LENGTH - t) / 0.8));
  if (ea > 0) {
    const w = 900, h = 1200;
    g.globalAlpha = ea; g.drawImage(title, (W - w) / 2, 150, w, h); g.globalAlpha = 1;
    caption('時計回りでも、反時計回りでも', 1470, ea, 48, '#c9bda8');
    caption('スマホでも、PC でも', 1550, ea, 48, '#c9bda8');
    caption('naga3.github.io/enso', 1700, ea, 60, '#ece4d3');
  }

  return { img: canvas.toDataURL('image/jpeg', 0.93), speed };
}

window.promo = { frame, FPS, LENGTH, HITS };
window.promoReady = true;
