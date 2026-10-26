// お題。架空の手の動き（位置と時刻の列）を作る。
// 同じ筆に通して描くので、お題の太さはどれも人の手で出せる。

import { rng } from './brush.js';

const HZ = 120;

export function makeOdai(n) {
  const r = rng(n * 7919 + 17);
  const between = (a, b) => a + (b - a) * r();
  const dir = r() < 0.5 ? 1 : -1;
  const R = between(0.28, 0.33);
  const cx = 0.5 + between(-0.02, 0.02), cy = 0.5 + between(-0.02, 0.02);
  const ecc = between(-0.07, 0.07), rot = between(0, Math.PI);
  const h2 = between(0, 0.03), p2 = between(0, 6.3), h3 = between(0, 0.02), p3 = between(0, 6.3);
  // 描き始めは左側のどこか（画面は y が下向き）
  const a0 = between(0.55, 1.45) * Math.PI;
  const sweep = Math.PI * 2 * between(0.86, 1.06);
  const dwell = between(0.12, 0.6);
  const dur = between(0.9, 1.9);
  const slowAt = between(0.25, 0.7), slowBy = between(0, 0.55);
  const tome = r() < 0.25; // 終わりを止める
  const endFast = tome ? 0 : between(0.4, 1.2);

  const point = (u) => {
    const a = a0 + dir * sweep * u;
    const rr = R * (1 + h2 * Math.sin(2 * a + p2) + h3 * Math.sin(3 * a + p3));
    const ex = Math.cos(a) * rr * (1 + ecc), ey = Math.sin(a) * rr * (1 - ecc);
    return {
      x: cx + ex * Math.cos(rot) - ey * Math.sin(rot),
      y: cy + ex * Math.sin(rot) + ey * Math.cos(rot),
    };
  };

  // 速さの流れ: 出だしはゆっくり、途中で一度ゆるみ、終わりは速く（止めなら遅く）
  const speed = (s) => {
    let v = 0.3 + Math.min(1, s / 0.18) * 0.7;
    v *= 1 - slowBy * Math.exp(-(((s - slowAt) / 0.12) ** 2));
    v *= tome ? 1 - 0.65 * smoothEnd(s) : 1 + endFast * s * s;
    return v;
  };
  const N = 400;
  const cum = [0];
  for (let i = 1; i <= N; i++) cum.push(cum[i - 1] + 1 / speed((i - 0.5) / N));
  const total = cum[N];

  const samples = [];
  const p0 = point(0);
  const t0 = 0;
  samples.push({ x: p0.x, y: p0.y, t: t0 });
  for (let t = 1 / HZ; t < dwell; t += 1 / HZ) samples.push({ x: p0.x, y: p0.y, t: t0 + t });
  // 時刻 → 進み具合 u
  for (let i = 1; ; i++) {
    const tt = i / HZ;
    if (tt > dur) break;
    const target = (tt / dur) * total;
    let k = cum.findIndex((c) => c >= target);
    if (k < 1) k = 1;
    const u = (k - 1 + (target - cum[k - 1]) / (cum[k] - cum[k - 1])) / N;
    const p = point(u);
    samples.push({ x: p.x, y: p.y, t: dwell + tt });
  }
  const pe = point(1);
  samples.push({ x: pe.x, y: pe.y, t: dwell + dur });
  let end = dwell + dur;
  if (tome) {
    for (let t = 1 / HZ; t < 0.12; t += 1 / HZ) samples.push({ x: pe.x, y: pe.y, t: end + t });
    end += 0.12;
  }
  return { n, samples, end, dir, tome };
}

function smoothEnd(s) {
  const t = Math.min(1, Math.max(0, (s - 0.75) / 0.25));
  return t * t * (3 - 2 * t);
}

// 筆に手の動きを流し込む（記録だけ・まとめて描くとき）
export function playInto(brush, odai) {
  const [first, ...rest] = odai.samples;
  brush.start(first.x, first.y, first.t);
  for (const s of rest) brush.move(s.x, s.y, s.t);
  brush.end(odai.end);
  return brush;
}
