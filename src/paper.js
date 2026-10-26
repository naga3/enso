// 和紙。きめ（brush.js の grain）と楮の繊維、少しの周辺減光

import { grain, rng } from './brush.js';

export function makePaper(S) {
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
