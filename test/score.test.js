import test from 'node:test';
import assert from 'node:assert/strict';
import { Brush } from '../src/brush.js';
import { makeOdai, playInto } from '../src/odai.js';
import { score, resample } from '../src/score.js';

const draw = (odai, seed = 1, warp = (s) => s) => {
  const o = { ...odai, samples: odai.samples.map(warp), end: warp({ x: 0, y: 0, t: odai.end }).t };
  return playInto(new Brush(null, seed), o).record;
};

test('お題は番号で決まる', () => {
  assert.deepEqual(makeOdai(5).samples, makeOdai(5).samples);
  assert.notDeepEqual(makeOdai(5).samples, makeOdai(6).samples);
});

test('お題そのままなら満点近く', () => {
  for (let n = 1; n <= 20; n++) {
    const o = makeOdai(n);
    const s = score(draw(o), draw(o, 2));
    assert.ok(s.total > 95, `${n}: ${s.total}`);
  }
});

test('速く描くと細くなり、足りなくなる', () => {
  const o = makeOdai(3);
  const ref = draw(o);
  const fast = draw(o, 1, (p) => ({ ...p, t: p.t * 0.5 }));
  const avgW = (r) => { const R = resample(r); return R.reduce((a, p) => a + p.w, 0) / R.length; };
  assert.ok(avgW(fast) < avgW(ref) * 0.8);
  const s = score(ref, fast);
  assert.ok(s.miss > 20 && s.over < 15, `${s.miss} ${s.over}`);
});

test('遅く描くと太くなり、はみ出す', () => {
  const o = makeOdai(3);
  const s = score(draw(o), draw(o, 1, (p) => ({ ...p, t: p.t * 2 })));
  assert.ok(s.over > 15 && s.miss < 5, `${s.miss} ${s.over}`);
});

test('ずらすと足りなくもなり、はみ出しもする', () => {
  const o = makeOdai(4);
  const s = score(draw(o), draw(o, 1, (p) => ({ ...p, x: p.x + 0.02 })));
  assert.ok(s.miss > 15 && s.over > 15 && s.total < 85, JSON.stringify([s.miss, s.over, s.total]));
});

test('逆回りは向きが逆と言われる', () => {
  const o = makeOdai(8);
  const end = o.end;
  const rev = { ...o, samples: [...o.samples].reverse().map((p) => ({ ...p, t: end - p.t })) };
  const s = score(draw(o), playInto(new Brush(null, 1), rev).record);
  assert.ok(s.hints.includes('回る向きが逆'), s.hints.join());
});
