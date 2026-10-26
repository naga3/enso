// 採点。点数は見たままの重なり（足りない・はみ出し）。
// 入り・中ほど・抜けの太さの助言は、お題の上の位置で揃えて比べる。

import { W_MAX } from './brush.js';

const M = 240;
const NEAR = 0.03; // これより離れたら「描けていない」
export const GRID = 256;  // 重なりを数える升目（紙の一辺）
const TOL = 0.003;  // 重なりで許すずれ（紙の幅に対して）

// 線の通った升目。太さの半分＋tol の円を並べる
export function mask(rec, tol) {
  const m = new Uint8Array(GRID * GRID);
  for (const p of rec) {
    const r = (p.w / 2 + tol) * GRID, cx = p.x * GRID, cy = p.y * GRID;
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(GRID - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(GRID - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) m[y * GRID + x] = 1;
    }
  }
  return m;
}

export function resample(rec, m = M) {
  const cum = [0];
  for (let i = 1; i < rec.length; i++) cum.push(cum[i - 1] + Math.hypot(rec[i].x - rec[i - 1].x, rec[i].y - rec[i - 1].y));
  const L = cum[cum.length - 1];
  const out = [];
  let k = 1;
  for (let i = 0; i < m; i++) {
    const s = (L * i) / (m - 1);
    while (k < rec.length - 1 && cum[k] < s) k++;
    const a = rec[k - 1], b = rec[k];
    const f = cum[k] > cum[k - 1] ? (s - cum[k - 1]) / (cum[k] - cum[k - 1]) : 0;
    const g = Math.min(1, Math.max(0, f));
    out.push({ x: a.x + (b.x - a.x) * g, y: a.y + (b.y - a.y) * g, w: a.w + (b.w - a.w) * g, t: a.t + (b.t - a.t) * g });
  }
  return out;
}

function nearest(p, list) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < list.length; i++) {
    const d = (p.x - list[i].x) ** 2 + (p.y - list[i].y) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return { i: best, d: Math.sqrt(bd) };
}

export const RANKS = [
  [95, '名人'], [90, '七段'], [85, '五段'], [80, '三段'], [75, '初段'],
  [65, '一級'], [55, '三級'], [40, '五級'], [0, '十級'],
];

export function score(odaiRec, playerRec) {
  if (playerRec.length < 8) return null;
  const T = resample(odaiRec), P = resample(playerRec);

  // 点数は見たままの重なり。お題のうち墨が乗った割合（足りないの逆）と、
  // 自分の墨のうちお題の中にある割合（はみ出しの逆）を合わせる。少しのずれは許す
  const oT = mask(odaiRec, 0), oL = mask(odaiRec, TOL);
  const pT = mask(playerRec, 0), pL = mask(playerRec, TOL);
  let oN = 0, oHit = 0, pN = 0, pHit = 0;
  for (let k = 0; k < oT.length; k++) {
    if (oT[k]) { oN++; if (pL[k]) oHit++; }
    if (pT[k]) { pN++; if (oL[k]) pHit++; }
  }
  const cover = oHit / oN, inside = pN ? pHit / pN : 0;
  const total = cover + inside > 0 ? (200 * cover * inside) / (cover + inside) : 0;
  const miss = 100 * (1 - cover), over = 100 * (1 - inside);
  const rank = RANKS.find(([min]) => total >= min)[1];

  const pToT = P.map((p) => nearest(p, T));
  const tToP = T.map((t) => nearest(t, P));
  const widths = T.map((t, i) => (tToP[i].d < NEAR ? P[tToP[i].i].w : null));
  let fwd = 0, cnt = 0;
  for (let i = 1; i < pToT.length; i++) {
    const d = pToT[i].i - pToT[i - 1].i;
    if (d === 0 || Math.abs(d) > M / 4) continue;
    cnt++; if (d > 0) fwd++;
  }
  const dirOk = cnt ? fwd / cnt : 0;

  // どこが太い・細いか（入り・中・抜けの三つに分けて）
  const parts = ['入り', '中ほど', '抜け'].map((name, k) => {
    const from = Math.floor((M * k) / 3), to = Math.floor((M * (k + 1)) / 3);
    const ds = [];
    for (let i = from; i < to; i++) if (widths[i] != null) ds.push((widths[i] - T[i].w) / W_MAX);
    return { name, diff: ds.length ? avg(ds) : null };
  });
  const hints = [];
  if (dirOk < 0.5) hints.push('回る向きが逆');
  for (const p of parts) {
    if (p.diff == null) hints.push(`${p.name}に届いていない`);
    else if (p.diff > 0.1) hints.push(`${p.name}が太い（もっと速く）`);
    else if (p.diff < -0.1) hints.push(`${p.name}が細い（もっとゆっくり）`);
  }

  // 結果の色分け用: 1 = 足りない、2 = はみ出し
  const diff = new Uint8Array(GRID * GRID);
  for (let k = 0; k < diff.length; k++) diff[k] = oT[k] && !pL[k] ? 1 : pT[k] && !oL[k] ? 2 : 0;

  return { total, miss, over, rank, hints, T, widths, diff };
}

function avg(a) { return a.reduce((s, x) => s + x, 0) / a.length; }
