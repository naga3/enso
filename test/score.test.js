import test from 'node:test';
import assert from 'node:assert/strict';
import { Brush } from '../src/brush.js';
import { makeOdai, playInto, CW, CCW } from '../src/odai.js';
import { score, resample } from '../src/score.js';

const draw = (odai, seed = 1, warp = (s) => s) => {
  const o = { ...odai, samples: odai.samples.map(warp), end: warp({ x: 0, y: 0, t: odai.end }).t };
  return playInto(new Brush(null, seed), o).record;
};

test('逆向きのお題は左右を反転させたもの', () => {
  const a = makeOdai(CW).samples, b = makeOdai(CCW).samples;
  assert.equal(a.length, b.length);
  a.forEach((p, i) => {
    assert.ok(Math.abs(p.x - (1 - b[i].x)) < 1e-12 && p.y === b[i].y && p.t === b[i].t);
  });
});

test('お題そのままなら満点近く', () => {
  for (const dir of [CW, CCW]) for (let seed = 2; seed <= 6; seed++) {
    const o = makeOdai(dir);
    const s = score(draw(o), draw(o, seed));
    assert.ok(s.total > 95, `${dir} ${seed}: ${s.total}`);
  }
});

test('速く描くと細くなり、足りなくなる', () => {
  const o = makeOdai(CW);
  const ref = draw(o);
  const fast = draw(o, 1, (p) => ({ ...p, t: p.t * 0.5 }));
  const avgW = (r) => { const R = resample(r); return R.reduce((a, p) => a + p.w, 0) / R.length; };
  assert.ok(avgW(fast) < avgW(ref) * 0.8);
  const s = score(ref, fast);
  assert.ok(s.miss > 20 && s.over < 15, `${s.miss} ${s.over}`);
});

test('遅く描くと太くなり、はみ出す', () => {
  const o = makeOdai(CW);
  const s = score(draw(o), draw(o, 1, (p) => ({ ...p, t: p.t * 2 })));
  assert.ok(s.over > 15 && s.miss < 5, `${s.miss} ${s.over}`);
});

test('ずらすと足りなくもなり、はみ出しもする', () => {
  const o = makeOdai(CW);
  const s = score(draw(o), draw(o, 1, (p) => ({ ...p, x: p.x + 0.02 })));
  assert.ok(s.miss > 15 && s.over > 15 && s.total < 85, JSON.stringify([s.miss, s.over, s.total]));
});

test('逆回りは向きが逆と言われる', () => {
  const o = makeOdai(CCW);
  const end = o.end;
  const rev = { ...o, samples: [...o.samples].reverse().map((p) => ({ ...p, t: end - p.t })) };
  const s = score(draw(o), playInto(new Brush(null, 1), rev).record);
  assert.ok(s.hints.includes('回る向きが逆'), s.hints.join());
});
