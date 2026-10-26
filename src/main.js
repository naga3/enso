import { Brush, W_MAX, grain, rng } from './brush.js';
import { makeOdai, playInto } from './odai.js';
import { score, GRID } from './score.js';

const $ = (id) => document.getElementById(id);
const paper = $('paper');
const view = paper.getContext('2d');
const S = Math.min(1200, Math.round(Math.min(innerWidth, innerHeight * 0.62) * devicePixelRatio)) || 800;
paper.width = paper.height = S;

const layer = () => {
  const c = new OffscreenCanvas(S, S);
  const g = c.getContext('2d');
  return { c, g };
};
const paperTex = makePaper();
const odaiInk = layer(), playerInk = layer(), demoInk = layer();
// 紙とお題を重ねたもの。お題を変えたときだけ作り直す
const under = layer(), underDemo = layer();
const diffLayer = new OffscreenCanvas(GRID, GRID);

let n = Number(location.hash.slice(1)) || Number(localStorage.getItem('enso.n')) || 1;
let odai, odaiRec;
let state = 'ready'; // ready | drawing | done | demo
let brush = null, last = null, attempt = 0;
let demo = null;
let full = true; // 次のフレームで紙を丸ごと描き直す

function clearInk(l) {
  l.g.setTransform(1, 0, 0, 1, 0, 0);
  l.g.globalCompositeOperation = 'source-over';
  l.g.fillStyle = '#fff';
  l.g.fillRect(0, 0, S, S);
  l.g.setTransform(S, 0, 0, S, 0, 0);
  l.g.globalCompositeOperation = 'darken';
  l.g.lineCap = 'round';
}

function loadOdai() {
  odai = makeOdai(n);
  clearInk(odaiInk);
  odaiRec = playInto(new Brush(odaiInk.g, n), odai).record;
  for (const [l, a] of [[under, 0.2], [underDemo, 0.12]]) {
    l.g.globalCompositeOperation = 'source-over'; l.g.globalAlpha = 1;
    l.g.drawImage(paperTex, 0, 0);
    l.g.globalCompositeOperation = 'multiply'; l.g.globalAlpha = a;
    l.g.drawImage(odaiInk.c, 0, 0);
  }
  $('odai-name').textContent = `第 ${toKanji(n)} 題`;
  localStorage.setItem('enso.n', n);
  history.replaceState(null, '', `#${n}`);
  showBest();
  reset();
}

function reset() {
  clearInk(playerInk);
  brush = null; state = 'ready'; demo = null; full = true;
  $('result').hidden = true;
  $('prompt').style.opacity = 1;
}

function showBest() {
  const b = Number(localStorage.getItem(`enso.best.${n}`));
  $('best').textContent = b ? `最高 ${b.toFixed(0)}` : '';
}

// 入力
const toPaper = (e) => {
  const r = paper.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, t: e.timeStamp / 1000 };
};
paper.addEventListener('pointerdown', (e) => {
  if (state !== 'ready') return;
  paper.setPointerCapture(e.pointerId);
  const p = toPaper(e);
  brush = new Brush(playerInk.g, 1000 + attempt++);
  brush.start(p.x, p.y, p.t);
  last = p; state = 'drawing';
  $('prompt').style.opacity = 0;
});
paper.addEventListener('pointermove', (e) => {
  if (state !== 'drawing') return;
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of evs.length ? evs : [e]) {
    last = toPaper(ev);
    brush.move(last.x, last.y, last.t);
  }
});
const up = (e) => {
  if (state !== 'drawing') return;
  brush.end(Math.max(e.timeStamp / 1000, brush.ht));
  finish();
};
paper.addEventListener('pointerup', up);
paper.addEventListener('pointercancel', up);

function finish() {
  const s = score(odaiRec, brush.record);
  state = 'done';
  if (!s) { reset(); return; }
  const key = `enso.best.${n}`;
  if (s.total > (Number(localStorage.getItem(key)) || 0)) localStorage.setItem(key, s.total.toFixed(1));
  showBest();
  paintDiff(s.diff);
  full = true;
  showResult(s);
}

function showResult(s) {
  $('result').hidden = false;
  $('rank').textContent = s.rank;
  $('total').textContent = `${s.total.toFixed(0)} 点`;
  $('bar-miss').style.width = `${s.miss}%`;
  $('bar-over').style.width = `${s.over}%`;
  $('miss').textContent = `${s.miss.toFixed(0)}%`;
  $('over').textContent = `${s.over.toFixed(0)}%`;
  $('hints').innerHTML = (s.hints.length ? s.hints : ['よく揃っている']).map((h) => `<li>${h}</li>`).join('');
  drawGraph(s);
  $('result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// 足りない所を朱、はみ出した所を群青で塗る
function paintDiff(diff) {
  const g = diffLayer.getContext('2d');
  const img = g.createImageData(GRID, GRID);
  for (let k = 0; k < diff.length; k++) {
    const c = diff[k] === 1 ? [200, 50, 31] : diff[k] === 2 ? [40, 90, 170] : null;
    if (c) img.data.set([...c, 255], k * 4);
  }
  g.putImageData(img, 0, 0);
}

// 太さの比べ: 横はお題の上の位置、縦は太さ
function drawGraph(s) {
  const c = $('graph');
  const w = c.clientWidth * devicePixelRatio, h = c.clientHeight * devicePixelRatio;
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const pad = 4 * devicePixelRatio;
  const X = (i) => pad + ((w - pad * 2) * i) / (s.T.length - 1);
  const Y = (v) => h - pad - ((h - pad * 2) * v) / (W_MAX * 1.45);
  g.strokeStyle = '#3a332b'; g.lineWidth = 1;
  for (const k of [1, 2]) { g.beginPath(); g.moveTo(X((s.T.length - 1) * k / 3), 0); g.lineTo(X((s.T.length - 1) * k / 3), h); g.stroke(); }
  g.lineWidth = 3 * devicePixelRatio; g.lineJoin = 'round';
  g.strokeStyle = '#c8321f';
  g.beginPath(); s.T.forEach((p, i) => (i ? g.lineTo(X(i), Y(p.w)) : g.moveTo(X(i), Y(p.w)))); g.stroke();
  g.strokeStyle = '#ece4d3'; g.lineWidth = 2 * devicePixelRatio;
  g.beginPath();
  let pen = false;
  s.widths.forEach((v, i) => {
    if (v == null) { pen = false; return; }
    if (pen) g.lineTo(X(i), Y(v)); else g.moveTo(X(i), Y(v));
    pen = true;
  });
  g.stroke();
  g.fillStyle = '#8a7c67'; g.font = `${11 * devicePixelRatio}px serif`;
  ['入り', '中ほど', '抜け'].forEach((t, k) => g.fillText(t, X((s.T.length - 1) * k / 3) + pad, 12 * devicePixelRatio));
  g.fillStyle = '#c8321f'; g.fillText('お題', w - 70 * devicePixelRatio, 12 * devicePixelRatio);
  g.fillStyle = '#ece4d3'; g.fillText('自分', w - 34 * devicePixelRatio, 12 * devicePixelRatio);
}

// お手本: お題の手の動きをそのままの速さで描いて見せる
$('demo').onclick = () => {
  if (state === 'drawing') return;
  clearInk(demoInk);
  demo = { brush: new Brush(demoInk.g, n), i: 0, t0: performance.now() / 1000, ended: 0 };
  const f = odai.samples[0];
  demo.brush.start(f.x, f.y, f.t);
  state = 'demo'; full = true;
  $('result').hidden = true;
  $('prompt').style.opacity = 0;
};
$('retry').onclick = () => { if (state !== 'drawing') reset(); };
$('next').onclick = () => { if (state !== 'drawing') { n++; loadOdai(); } };
$('start').onclick = () => { $('title').hidden = true; $('game').hidden = false; loadOdai(); };
$('back').onclick = () => { $('game').hidden = true; $('title').hidden = false; };

function frame() {
  const now = performance.now() / 1000;
  if (state === 'drawing' && last) brush.move(last.x, last.y, now);
  if (state === 'demo') {
    const el = now - demo.t0;
    const ss = odai.samples;
    while (demo.i + 1 < ss.length && ss[demo.i + 1].t <= el) { demo.i++; demo.brush.move(ss[demo.i].x, ss[demo.i].y, ss[demo.i].t); }
    if (!demo.ended && el >= odai.end) { demo.brush.end(odai.end); demo.ended = now; }
    if (demo.ended && now - demo.ended > 1.2) reset();
  }
  const active = state === 'drawing' ? brush : state === 'demo' ? demo.brush : null;
  const d = active && active.takeDirty();
  if (full) { compose(0, 0, S, S); full = false; }
  else if (d) {
    const x0 = Math.max(0, Math.floor(d.x0 * S) - 2), y0 = Math.max(0, Math.floor(d.y0 * S) - 2);
    const x1 = Math.min(S, Math.ceil(d.x1 * S) + 2), y1 = Math.min(S, Math.ceil(d.y1 * S) + 2);
    if (x1 > x0 && y1 > y0) compose(x0, y0, x1 - x0, y1 - y0);
  }
  requestAnimationFrame(frame);
}

// 紙の (x, y, w, h) の範囲を描き直す（画素）
function compose(x, y, w, h) {
  const put = (img, alpha = 1) => { view.globalAlpha = alpha; view.drawImage(img, x, y, w, h, x, y, w, h); };
  view.globalCompositeOperation = 'source-over';
  put(state === 'demo' ? underDemo.c : under.c);
  view.globalCompositeOperation = 'multiply';
  put(state === 'demo' ? demoInk.c : playerInk.c);
  if (state === 'done') {
    view.globalCompositeOperation = 'source-over';
    view.globalAlpha = 0.7; view.imageSmoothingEnabled = true; view.drawImage(diffLayer, 0, 0, S, S);
  }
  view.globalAlpha = 1;
  view.globalCompositeOperation = 'source-over';
}

function makePaper() {
  const c = new OffscreenCanvas(S, S);
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const v = grain[((y >> 1) & 255) * 256 + ((x >> 1) & 255)] - 0.5;
    const cx = x / S - 0.5, cy = y / S - 0.5;
    const vig = 1 - (cx * cx + cy * cy) * 0.18;
    const i = (y * S + x) * 4;
    d[i] = (240 + v * 7) * vig; d[i + 1] = (233 + v * 7) * vig; d[i + 2] = (218 + v * 8) * vig; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // 楮の繊維
  const r = rng(7);
  g.lineCap = 'round';
  for (let k = 0; k < 260; k++) {
    let x = r() * S, y = r() * S, a = r() * Math.PI * 2;
    g.strokeStyle = `rgba(${r() < 0.5 ? '255,252,244' : '200,188,165'},${0.25 + r() * 0.3})`;
    g.lineWidth = (0.4 + r() * 0.8) * S / 800;
    g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s < 6; s++) { a += (r() - 0.5) * 0.9; x += Math.cos(a) * S * 0.006; y += Math.sin(a) * S * 0.006; g.lineTo(x, y); }
    g.stroke();
  }
  return c;
}

function toKanji(k) {
  const d = '〇一二三四五六七八九';
  if (k < 10) return d[k];
  if (k < 100) return `${k >= 20 ? d[Math.floor(k / 10)] : ''}十${k % 10 ? d[k % 10] : ''}`;
  return String(k);
}

if (location.hash) $('start').click();
requestAnimationFrame(frame);
window.enso = { get odai() { return odai; }, get rec() { return odaiRec; }, redraw() { compose(0, 0, S, S); }, score, Brush, playInto };
