'use strict';

// Retro sound effects synthesised with WebAudio (no audio files) + Pokémon cries from PokéAPI.
class SFX {
  constructor() {
    this.enabled = true;
    this.ac = null;
    try {
      const s = JSON.parse(localStorage.getItem(CONFIG.SETTINGS_KEY) || '{}');
      if (s.sound === false) this.enabled = false;
    } catch { /* default on */ }
  }

  setEnabled(on) {
    this.enabled = on;
    try { localStorage.setItem(CONFIG.SETTINGS_KEY, JSON.stringify({ sound: on })); } catch { /* ignore */ }
  }

  audio() {
    if (!this.ac) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      this.ac = new Ctx();
    }
    if (this.ac.state === 'suspended') this.ac.resume();
    return this.ac;
  }

  tone(freq, dur, { type = 'square', vol = 0.035, slide = 0, delay = 0 } = {}) {
    const ac = this.audio();
    if (!ac) return;
    const t0 = ac.currentTime + delay;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  noise(dur, vol = 0.08, delay = 0) {
    const ac = this.audio();
    if (!ac) return;
    const len = Math.floor(ac.sampleRate * dur);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ac.createBufferSource();
    const gain = ac.createGain();
    gain.gain.value = vol;
    src.buffer = buf;
    src.connect(gain).connect(ac.destination);
    src.start(ac.currentTime + delay);
  }

  play(name) {
    if (!this.enabled) return;
    try {
      switch (name) {
        case 'cursor': this.tone(1100, 0.03, { vol: 0.02 }); break;
        case 'select': this.tone(880, 0.05); this.tone(1320, 0.06, { delay: 0.05 }); break;
        case 'cancel': this.tone(660, 0.05); this.tone(440, 0.06, { delay: 0.05 }); break;
        case 'error': this.tone(180, 0.15, { type: 'sawtooth', vol: 0.03 }); break;
        case 'bump': this.tone(90, 0.06, { vol: 0.03 }); break;
        case 'menu': this.tone(990, 0.04); break;
        case 'hit': this.noise(0.12, 0.09); break;
        case 'super': this.noise(0.22, 0.12); this.tone(140, 0.2, { slide: -80, vol: 0.04 }); break;
        case 'weak': this.noise(0.07, 0.05); break;
        case 'faint': this.tone(700, 0.5, { slide: -600, vol: 0.04 }); break;
        case 'status': this.tone(300, 0.12, { type: 'triangle' }); this.tone(220, 0.15, { type: 'triangle', delay: 0.1 }); break;
        case 'statup': [500, 700, 900].forEach((f, i) => this.tone(f, 0.07, { delay: i * 0.06, type: 'triangle' })); break;
        case 'statdown': [900, 700, 500].forEach((f, i) => this.tone(f, 0.07, { delay: i * 0.06, type: 'triangle' })); break;
        case 'heal': [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.1, { delay: i * 0.09, type: 'triangle', vol: 0.04 })); break;
        case 'levelup': [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.08, { delay: i * 0.07 })); break;
        case 'encounter': for (let i = 0; i < 8; i++) this.tone(i % 2 ? 330 : 494, 0.07, { delay: i * 0.07 }); break;
        case 'spotted': this.tone(1200, 0.08); this.tone(1600, 0.12, { delay: 0.08 }); break;
        case 'tick': this.tone(260, 0.05, { type: 'triangle', vol: 0.05 }); break;
        case 'catch': [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, 0.12, { delay: i * 0.12 })); break;
        case 'throw': this.tone(600, 0.25, { slide: 500, type: 'triangle' }); break;
        case 'run': this.tone(400, 0.2, { slide: 400, type: 'triangle' }); break;
        case 'buy': this.tone(1046, 0.06); this.tone(1568, 0.1, { delay: 0.06 }); break;
        case 'think': this.tone(1500, 0.03, { vol: 0.012, type: 'sine' }); this.tone(1900, 0.03, { vol: 0.012, type: 'sine', delay: 0.05 }); break;
        default: break;
      }
    } catch { /* audio is optional */ }
  }

  cry(url, volume = 0.22) {
    if (!this.enabled || !url) return;
    try {
      const a = new Audio(url);
      a.volume = volume;
      a.play().catch(() => {});
    } catch { /* ignore */ }
  }
}
