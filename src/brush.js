// 筆。手の動き（位置と時刻）を受け取り、紙の上に墨を置く。
// 座標は紙を 1×1 とした値。太さは速さで決まり（遅いと太い）、止まると墨が溜まって広がる。
// お題も同じ筆に架空の手の動きを入れて描くので、ここを変えるとお題も変わる。

export const DT = 1 / 240;
export const W_MAX = 0.1; // 遅いときの太さ
export const W_MIN = 0.008; // 速いときの太さ
const V0 = 1.1;             // 太さが半分ほどになる速さ（紙/秒）
const W_TAU = 0.07;         // 太さが追いつくまでの時間
const POOL_GAIN = 0.22;     // 溜まりで太くなるぶん（W_MAX に対して）
const POOL_TAU = 0.6;
const STILL_V = 0.08;       // これより遅いと「止まっている」
const SPRING_HZ = 7;        // 筆先が手についてくる速さ
const DAMP = 0.85;
const BRISTLES = 44;
const INK_USE = 0.55;

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 紙のきめ。かすれの出かたを決める。0〜1 にならした値
const G = 256;
export const grain = (() => {
  const r = rng(12345);
  const raw = new Float32Array(G * G);
  for (let i = 0; i < raw.length; i++) raw[i] = r();
  const mix = new Float32Array(G * G);
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
    let s = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -2; dx <= 2; dx++) s += raw[((y + dy) & 255) * G + ((x + dx) & 255)];
    mix[y * G + x] = 0.55 * s / 15 + 0.45 * raw[y * G + x];
  }
  const order = [...mix.keys()].sort((a, b) => mix[a] - mix[b]);
  const out = new Float32Array(G * G);
  order.forEach((idx, rank) => { out[idx] = rank / (order.length - 1); });
  return out;
})();
const GRAIN_SCALE = 520;
const grainAt = (x, y) => grain[((y * GRAIN_SCALE) & 255) * G + ((x * GRAIN_SCALE) & 255)];

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class Brush {
  // ctx は白地のキャンバス（darken で重ねる）。null なら記録だけする
  constructor(ctx, seed = 1) {
    this.ctx = ctx;
    const r = rng(seed);
    this.r = r;
    this.bristles = [];
    for (let j = 0; j < BRISTLES; j++) {
      const u = ((j + 0.5) / BRISTLES) * 2 - 1 + (r() - 0.5) * 0.04;
      const cap = 0.45 + r() * 0.85;
      this.bristles.push({ u, a: (r() - 0.5) * 2, k: 0.6 + r() * 0.8, cap, ink: cap, px: 0, py: 0, has: false });
    }
    this.record = []; // {x,y,w,t} 一歩ごと
    this.dirty = null; // 前に takeDirty してから墨を置いた範囲
    this.down = false;
    this.done = false;
  }

  start(x, y, t) {
    this.hx = x; this.hy = y; this.ht = t;
    this.x = x; this.y = y; this.vx = 0; this.vy = 0;
    this.dirx = 1; this.diry = 0;
    this.w = 0; this.pool = 0; this.lift = 1;
    this.t = t; this.down = true;
  }

  // 手の位置を渡す。前の位置から直線でつないで筆を進める
  move(x, y, t) {
    if (!this.down) return;
    if (t < this.ht) t = this.ht;
    const x0 = this.hx, y0 = this.hy, t0 = this.ht;
    while (this.t + DT <= t) {
      const k = t > t0 ? (this.t + DT - t0) / (t - t0) : 1;
      this.step(x0 + (x - x0) * k, y0 + (y - y0) * k, false);
    }
    this.hx = x; this.hy = y; this.ht = t;
  }

  // 筆を上げる。動いていれば払い、止まっていれば止め
  end(t) {
    if (!this.down) return;
    this.move(this.hx, this.hy, t);
    const v = Math.hypot(this.vx, this.vy);
    const liftTime = v > 0.5 ? 0.07 : 0.04;
    let hx = this.hx, hy = this.hy;
    let hvx = this.vx, hvy = this.vy;
    const n = Math.ceil(liftTime / DT);
    for (let i = 0; i < n; i++) {
      hx += hvx * DT; hy += hvy * DT;
      hvx *= 0.95; hvy *= 0.95;
      this.lift = 1 - (i + 1) / n;
      this.step(hx, hy, true);
    }
    this.down = false;
    this.done = true;
  }

  step(hx, hy, lifting) {
    const om = 2 * Math.PI * SPRING_HZ;
    const ax = om * om * (hx - this.x) - 2 * DAMP * om * this.vx;
    const ay = om * om * (hy - this.y) - 2 * DAMP * om * this.vy;
    this.vx += ax * DT; this.vy += ay * DT;
    const px = this.x, py = this.y;
    this.x += this.vx * DT; this.y += this.vy * DT;
    this.t += DT;

    const v = Math.hypot(this.vx, this.vy);
    if (v > 0.02) {
      const k = Math.min(1, v / 0.3);
      this.dirx += (this.vx / v - this.dirx) * k * 0.5;
      this.diry += (this.vy / v - this.diry) * k * 0.5;
      const l = Math.hypot(this.dirx, this.diry) || 1;
      this.dirx /= l; this.diry /= l;
    }

    if (!lifting) {
      if (v < STILL_V) this.pool += DT; else this.pool = Math.max(0, this.pool - DT * 3);
    }
    const poolF = 1 - Math.exp(-this.pool / POOL_TAU);
    const inkAll = this.inkLevel();
    const wv = W_MIN + (W_MAX - W_MIN) / (1 + (v / V0) ** 2);
    const target = (wv + W_MAX * POOL_GAIN * poolF) * (0.7 + 0.3 * smooth(0, 0.6, inkAll));
    this.w += (target - this.w) * (1 - Math.exp(-DT / W_TAU));
    const w = this.w * (lifting ? this.lift ** 1.5 : 1);
    if (w > 0.0005) this.record.push({ x: this.x, y: this.y, w, t: this.t });
    this.paint(px, py, w, v, poolF);
    const m = this.w * 0.8 + 0.004;
    this.extend(px, py, m); this.extend(this.x, this.y, m);
  }

  extend(x, y, m) {
    const d = this.dirty;
    if (!d) { this.dirty = { x0: x - m, y0: y - m, x1: x + m, y1: y + m }; return; }
    d.x0 = Math.min(d.x0, x - m); d.y0 = Math.min(d.y0, y - m);
    d.x1 = Math.max(d.x1, x + m); d.y1 = Math.max(d.y1, y + m);
  }

  takeDirty() {
    const d = this.dirty;
    this.dirty = null;
    return d;
  }

  inkLevel() {
    let s = 0;
    for (const b of this.bristles) s += b.ink / b.cap;
    return s / this.bristles.length;
  }

  paint(px, py, w, v, poolF) {
    const ctx = this.ctx;
    const nx = -this.diry, ny = this.dirx;
    const seg = Math.hypot(this.x - px, this.y - py);
    const wr = w / W_MAX;
    if (ctx && poolF > 0.02 && this.r() < 0.3) {
      // 溜まり。筆の周りに墨がにじむ。縁は紙のきめでぎざつかせる
      const rb = (w / 2) * (0.8 + 0.3 * poolF);
      const c = Math.round(22 + 40 * (1 - this.inkLevel()));
      for (let k = 0; k < 3; k++) {
        const ox = (this.r() - 0.5) * rb * 0.25, oy = (this.r() - 0.5) * rb * 0.25;
        const rr = rb * (0.85 + this.r() * 0.2);
        const g = ctx.createRadialGradient(this.x + ox, this.y + oy, 0, this.x + ox, this.y + oy, rr);
        g.addColorStop(0, `rgb(${c},${c},${c})`);
        g.addColorStop(0.86, `rgb(${c + 6},${c + 6},${c + 8})`);
        g.addColorStop(0.93, `rgb(${c + 70},${c + 70},${c + 74})`);
        g.addColorStop(1, 'rgb(255,255,255)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(this.x + ox, this.y + oy, rr, 0, Math.PI * 2); ctx.fill();
      }
    }
    const skipBase = Math.min(0.5, Math.max(0, (v - 1.3) / 4));
    const lw = (w / BRISTLES) * 1.8;
    const moving = v > 0.04;
    for (const b of this.bristles) {
      const off = b.u * w / 2 + (this.r() - 0.5) * w * 0.03 * (0.3 + Math.abs(b.u));
      const along = b.a * w * 0.12;
      const bx = this.x + nx * off + this.dirx * along;
      const by = this.y + ny * off + this.diry * along;
      if (b.has && ctx && moving) {
        const wet = smooth(0.02, 0.32, b.ink);
        const p = wet * (1 - skipBase * (0.5 + Math.abs(b.u)));
        if (grainAt((bx + b.px) / 2, (by + b.py) / 2) < p) {
          const c = Math.round(16 + 80 * (1 - smooth(0, 0.6, b.ink)));
          ctx.strokeStyle = `rgb(${c},${c},${c + 2})`;
          ctx.lineWidth = Math.max(0.0009, lw * b.k);
          ctx.beginPath(); ctx.moveTo(b.px, b.py); ctx.lineTo(bx, by); ctx.stroke();
        }
      }
      b.ink = Math.max(0, b.ink - seg * INK_USE * (0.6 + 0.8 * wr) * (0.8 + 0.4 * Math.abs(b.u)));
      b.px = bx; b.py = by; b.has = true;
    }
  }
}
