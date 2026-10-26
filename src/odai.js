// お題。架空の手の動き（位置と時刻の列）を作る。
// 同じ筆に通して描くので、お題の太さは人の手で出せる。
// お題は一つだけで、みんなが同じものを描く。向きだけ選べて、逆向きは左右を反転させたもの（形も速さも同じ）。

const HZ = 120;

export const CW = 1;   // 時計回り（左下から描き出す）
export const CCW = -1; // 反時計回り（右下から描き出す）

const R = 0.3;
const A0 = 0.72 * Math.PI;         // 描き始め（左下。画面は y が下向き）
const SWEEP = Math.PI * 2 * 0.96;  // 少しだけ開けて閉じない
const DWELL = 0.35;                // 入りの溜め
const DUR = 1.4;                   // 回る時間
const SLOW_AT = 0.5, SLOW_BY = 0.2; // 途中のゆるみ
const END_FAST = 0.8;              // 抜けに向けて速く

export function makeOdai(dir = CW) {
  const point = (u) => {
    const a = A0 + SWEEP * u;
    return { x: 0.5 + dir * Math.cos(a) * R, y: 0.5 + Math.sin(a) * R };
  };

  // 速さの流れ: 出だしはゆっくり、途中で一度ゆるみ、終わりは速く
  const speed = (s) => {
    let v = 0.3 + Math.min(1, s / 0.18) * 0.7;
    v *= 1 - SLOW_BY * Math.exp(-(((s - SLOW_AT) / 0.12) ** 2));
    return v * (1 + END_FAST * s * s);
  };
  const N = 400;
  const cum = [0];
  for (let i = 1; i <= N; i++) cum.push(cum[i - 1] + 1 / speed((i - 0.5) / N));
  const total = cum[N];

  const samples = [];
  const p0 = point(0);
  for (let t = 0; t < DWELL; t += 1 / HZ) samples.push({ x: p0.x, y: p0.y, t });
  // 時刻 → 進み具合 u
  for (let i = 1; i / HZ <= DUR; i++) {
    const target = (i / HZ / DUR) * total;
    let k = cum.findIndex((c) => c >= target);
    if (k < 1) k = 1;
    const u = (k - 1 + (target - cum[k - 1]) / (cum[k] - cum[k - 1])) / N;
    const p = point(u);
    samples.push({ x: p.x, y: p.y, t: DWELL + i / HZ });
  }
  const pe = point(1);
  samples.push({ x: pe.x, y: pe.y, t: DWELL + DUR });
  return { dir, samples, end: DWELL + DUR };
}

// 筆に手の動きを流し込む（記録だけ・まとめて描くとき）
export function playInto(brush, odai) {
  const [first, ...rest] = odai.samples;
  brush.start(first.x, first.y, first.t);
  for (const s of rest) brush.move(s.x, s.y, s.t);
  brush.end(odai.end);
  return brush;
}
