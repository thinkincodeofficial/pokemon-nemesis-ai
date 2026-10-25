'use strict';

// Small helpers shared by every module.
const Utils = {
  rand: (min, max) => min + Math.random() * (max - min),
  randInt: (min, max) => Math.floor(min + Math.random() * (max - min + 1)),
  chance: p => Math.random() < p,
  choice: arr => arr[Math.floor(Math.random() * arr.length)],
  clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
  lerp: (a, b, t) => a + (b - a) * t,
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  uid: () => Math.random().toString(36).slice(2, 10),

  pretty: s => String(s).split('-').map(w => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' '),
  pct: v => `${Math.round(v * 100)}%`,
  escape: s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  idFromUrl: url => Number(String(url).split('/').filter(Boolean).pop()),

  linear: t => t,
  easeOutQuad: t => 1 - (1 - t) * (1 - t),
  easeInOutQuad: t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  easeOutBack: t => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2),

  // HP fraction -> 0..4 bucket (0-20%, 20-40%, ...). Used as learning context.
  hpBucket: frac => Utils.clamp(Math.floor(frac * 5), 0, 4),
  bucketLabel: b => `${b * 20}-${b * 20 + 20}%`,

  stageMultiplier: s => (s >= 0 ? (2 + s) / 2 : 2 / (2 - s)),
  accuracyMultiplier: s => (s >= 0 ? (3 + s) / 3 : 3 / (3 - s)),

  // Turns scores into probabilities. Lower temperature = greedier choice.
  softmax(scores, temperature) {
    const t = Math.max(0.01, temperature);
    const max = Math.max(...scores);
    const ex = scores.map(s => Math.exp((s - max) / t));
    const sum = ex.reduce((a, b) => a + b, 0);
    return ex.map(e => e / sum);
  },

  weightedIndex(weights) {
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r <= 0) return i;
    }
    return weights.length - 1;
  },

  normalize(obj) {
    const keys = Object.keys(obj);
    const sum = keys.reduce((s, k) => s + obj[k], 0);
    const out = {};
    for (const k of keys) out[k] = sum > 0 ? obj[k] / sum : 1 / keys.length;
    return out;
  },

  argmax(obj) {
    let best = null, bestValue = -Infinity;
    for (const k in obj) if (obj[k] > bestValue) { bestValue = obj[k]; best = k; }
    return best;
  },

  hpColor: frac => (frac > 0.5 ? '#48d048' : frac > 0.2 ? '#f8c030' : '#f05030'),

  // Deterministic 0..1 noise per tile, so procedural tiles look the same every frame.
  hash(x, y) {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  },

  withTimeout(promise, ms) {
    return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
  },
};
