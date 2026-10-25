'use strict';

const BATTLE_BACKDROPS = {
  grass: { skyTop: '#88c8f0', skyBottom: '#d8f0f8', hill: '#a8d888', ground: '#c8e8a0', pad: '#98c870', padEdge: '#709850' },
  field: { skyTop: '#f0b878', skyBottom: '#f8e8c0', hill: '#d8c088', ground: '#e8d8a8', pad: '#c8b070', padEdge: '#987848' },
  gym:   { skyTop: '#140c2c', skyBottom: '#3a2066', hill: '#2a1850', ground: '#3c2a6a', pad: '#5a3a9a', padEdge: '#3ef0ff' },
};

/**
 * Canvas battle renderer + animation system. Every animation returns a Promise,
 * so the battle engine can simply `await scene.attack(...)`.
 */
class BattleScene {
  constructor(game) {
    this.game = game;
    this.tweens = [];
    this.particles = [];
    this.orbs = [];
    this.silhouettes = new Map();
    this.time = 0;
    this.prepare();
  }

  blankSide() {
    return { mon: null, img: null, ox: 0, oy: 0, alpha: 1, scale: 1, white: 0, hidden: true, dispHp: 0, dispExp: 0, dispLevel: 1, boxAlpha: 0 };
  }

  // Resets everything to a black screen, ready for a new battle.
  prepare() {
    this.sides = { player: this.blankSide(), enemy: this.blankSide() };
    this.shake = 0;
    this.flash = 0;
    this.fade = 1;
    this.ballFx = null;
    this.battle = null;
    this.bg = 'grass';
    this.particles = [];
    this.orbs = [];
  }

  home(side) {
    return side === 'enemy' ? { x: 312, y: 46, size: 96 } : { x: 46, y: 96, size: 144 };
  }

  center(side) {
    const h = this.home(side), s = this.sides[side];
    return { x: h.x + h.size / 2 + s.ox, y: h.y + h.size * 0.62 + s.oy };
  }

  async setup(battle) {
    this.battle = battle;
    this.bg = battle.bg in BATTLE_BACKDROPS ? battle.bg : 'grass';
    await Promise.all([this.setMon('player', battle.p), this.setMon('enemy', battle.e)]);
  }

  async setMon(side, mon) {
    const s = this.sides[side];
    s.mon = mon;
    s.dispHp = mon.hp;
    s.dispExp = mon.expProgress;
    s.dispLevel = mon.level;
    const url = side === 'enemy' ? mon.data.sprites.front : mon.data.sprites.back || mon.data.sprites.front;
    s.img = await PokeAPI.loadImage(url).catch(() => null);
  }

  // ---------------------------------------------------------------- tween engine

  tween(target, props, ms, ease = Utils.easeOutQuad) {
    return new Promise(resolve => {
      const from = {};
      for (const k in props) from[k] = target[k];
      this.tweens.push({ target, from, to: props, t: 0, ms: Math.max(1, ms), ease, resolve });
    });
  }

  update(dt) {
    this.time += dt;
    for (const tw of this.tweens.slice()) {
      tw.t += dt * 1000;
      const p = Math.min(1, tw.t / tw.ms);
      const e = tw.ease(p);
      for (const k in tw.to) tw.target[k] = tw.from[k] + (tw.to[k] - tw.from[k]) * e;
      if (p >= 1) {
        this.tweens.splice(this.tweens.indexOf(tw), 1);
        tw.resolve();
      }
    }
    for (const orb of this.orbs) {
      for (let i = 0; i < 2; i++) this.spawn(orb.x, orb.y, orb.color, { speed: 20, life: 0.35, size: 3 });
    }
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.gravity * dt;
    }
    this.particles = this.particles.filter(p => p.life > 0);
    this.shake = Math.max(0, this.shake - dt * 30);
    this.flash = Math.max(0, this.flash - dt * 3);
  }

  spawn(x, y, color, { speed = 80, life = 0.6, size = 3, gravity = 0, dir = null, count = 1 } = {}) {
    for (let i = 0; i < count; i++) {
      const a = dir ?? Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.8);
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, color, size, gravity });
    }
  }

  burst(at, color, n = 16) {
    this.spawn(at.x, at.y, color, { count: n, speed: 110, life: 0.5, size: 3 });
    this.spawn(at.x, at.y, '#ffffff', { count: 6, speed: 60, life: 0.3, size: 2 });
  }

  // ---------------------------------------------------------------- animations

  async intro({ showEnemy = true } = {}) {
    const e = this.sides.enemy;
    e.hidden = !showEnemy;
    e.ox = -280;
    await this.tween(this, { fade: 0 }, 350);
    if (showEnemy) {
      await this.tween(e, { ox: 0 }, 650);
      await this.tween(e, { boxAlpha: 1 }, 200);
    } else e.ox = 0;
  }

  async sendOut(side, mon) {
    await this.setMon(side, mon);
    const s = this.sides[side];
    s.hidden = false;
    s.ox = 0;
    s.oy = 0;
    s.alpha = 1;
    s.scale = 0.05;
    s.white = 1;
    this.burst(this.center(side), '#ffffff', 10);
    this.game.sfx.cry(mon.data.cry);
    await this.tween(s, { scale: 1 }, 320, Utils.easeOutBack);
    await this.tween(s, { white: 0, boxAlpha: 1 }, 220);
  }

  async recall(side) {
    const s = this.sides[side];
    await this.tween(s, { white: 1 }, 150);
    await this.tween(s, { scale: 0.05, boxAlpha: 0 }, 220);
    s.hidden = true;
  }

  async faint(side) {
    const s = this.sides[side];
    if (s.mon) this.game.sfx.cry(s.mon.data.cry, 0.15);
    await this.tween(s, { oy: 70, alpha: 0 }, 450, Utils.linear);
    s.hidden = true;
    s.oy = 0;
    s.alpha = 1;
    await this.tween(s, { boxAlpha: 0 }, 150);
  }

  async attack(side, move) {
    const s = this.sides[side];
    const dir = side === 'player' ? 1 : -1;
    const color = TYPE_COLORS[move.type] || '#ffffff';
    const target = side === 'player' ? 'enemy' : 'player';
    if (move.damageClass === 'special') {
      const orb = { ...this.center(side), color };
      this.orbs.push(orb);
      await this.tween(orb, this.center(target), 380, Utils.easeInOutQuad);
      this.orbs.splice(this.orbs.indexOf(orb), 1);
      this.burst(this.center(target), color, 22);
    } else {
      await this.tween(s, { ox: 26 * dir, oy: -8 * dir }, 110);
      this.burst(this.center(target), color, 16);
      await this.tween(s, { ox: 0, oy: 0 }, 150);
    }
  }

  async hit(side, eff = 1) {
    const s = this.sides[side];
    this.shake = eff > 1 ? 9 : eff < 1 ? 3 : 5;
    if (eff > 1) this.flash = 0.5;
    for (let i = 0; i < 3; i++) {
      s.alpha = 0.15;
      await Utils.sleep(55);
      s.alpha = 1;
      await Utils.sleep(55);
    }
  }

  async hp(side) {
    const s = this.sides[side];
    if (!s.mon) return;
    const diff = Math.abs(s.dispHp - s.mon.hp);
    if (diff < 0.5) { s.dispHp = s.mon.hp; return; }
    await this.tween(s, { dispHp: s.mon.hp }, Utils.clamp((diff / s.mon.maxHp) * 1000, 220, 900), Utils.linear);
  }

  async exp() {
    const s = this.sides.player, mon = s.mon;
    if (!mon) return;
    while (s.dispLevel < mon.level) {
      await this.tween(s, { dispExp: 1 }, 450, Utils.linear);
      s.dispExp = 0;
      s.dispLevel++;
    }
    await this.tween(s, { dispExp: mon.expProgress }, 450, Utils.linear);
  }

  // kind: 'up' | 'down' | 'heal' | 'ailment' | 'cast'
  async statusFx(side, kind) {
    const c = this.center(side);
    const cfg = {
      up: { color: '#ff8050', vy: -90 }, down: { color: '#5090ff', vy: 90 }, heal: { color: '#60f080', vy: -60 },
      ailment: { color: '#c060e0', vy: -30 }, cast: { color: '#ffffff', vy: -40 },
    }[kind] || { color: '#ffffff', vy: -40 };
    for (let i = 0; i < 18; i++) {
      this.particles.push({
        x: c.x + Utils.rand(-30, 30), y: c.y + Utils.rand(-20, 25), vx: Utils.rand(-8, 8), vy: cfg.vy * Utils.rand(0.5, 1),
        life: 0.7, max: 0.7, color: cfg.color, size: kind === 'cast' ? 2 : 3, gravity: 0,
      });
    }
    await Utils.sleep(420);
  }

  async ball(shakes, caught) {
    const e = this.sides.enemy;
    const target = this.center('enemy');
    const b = { t: 0, x0: 70, y0: 210, x1: target.x, y1: target.y - 8, rot: 0, visible: true, drop: 0 };
    this.ballFx = b;
    await this.tween(b, { t: 1 }, 480, Utils.linear);
    await this.tween(e, { white: 1 }, 140);
    await this.tween(e, { scale: 0.05 }, 200);
    e.hidden = true;
    await this.tween(b, { drop: 30 }, 260, Utils.easeOutQuad);
    for (let i = 0; i < shakes; i++) {
      await Utils.sleep(320);
      this.game.sfx.play('tick');
      await this.tween(b, { rot: -0.5 }, 110);
      await this.tween(b, { rot: 0.5 }, 200);
      await this.tween(b, { rot: 0 }, 110);
    }
    await Utils.sleep(350);
    if (caught) {
      this.spawn(target.x, target.y + 22, '#ffe060', { count: 14, speed: 70, life: 0.7, size: 3 });
      b.locked = true;
      await Utils.sleep(500);
    } else {
      b.visible = false;
      this.burst({ x: target.x, y: target.y + 22 }, '#ffffff', 16);
      e.hidden = false;
      e.scale = 1;
      await this.tween(e, { white: 0 }, 260);
      this.ballFx = null;
    }
  }

  // ---------------------------------------------------------------- rendering

  render(ctx) {
    const W = CONFIG.WIDTH, H = CONFIG.HEIGHT;
    ctx.save();
    if (this.shake > 0) ctx.translate(Utils.rand(-this.shake, this.shake), Utils.rand(-this.shake, this.shake) * 0.5);
    this.drawBackdrop(ctx);
    this.drawMon(ctx, 'enemy');
    this.drawMon(ctx, 'player');
    this.drawBall(ctx);
    for (const orb of this.orbs) {
      ctx.fillStyle = orb.color;
      ctx.beginPath();
      ctx.arc(orb.x, orb.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(orb.x, orb.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x - p.size / 2), Math.round(p.y - p.size / 2), p.size, p.size);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    this.drawBox(ctx, 'enemy');
    this.drawBox(ctx, 'player');
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${this.flash})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (this.fade > 0) {
      ctx.fillStyle = `rgba(0,0,0,${this.fade})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  drawBackdrop(ctx) {
    const W = CONFIG.WIDTH;
    const pal = BATTLE_BACKDROPS[this.bg];
    const sky = ctx.createLinearGradient(0, 0, 0, 150);
    sky.addColorStop(0, pal.skyTop);
    sky.addColorStop(1, pal.skyBottom);
    ctx.fillStyle = sky;
    ctx.fillRect(-20, -20, W + 40, 190);
    if (this.bg === 'gym') {
      // Neon "data grid" for NYX's gym.
      ctx.strokeStyle = 'rgba(62,240,255,0.18)';
      ctx.lineWidth = 1;
      const off = (this.time * 20) % 24;
      for (let x = -24; x < W + 24; x += 24) { ctx.beginPath(); ctx.moveTo(x + off, 0); ctx.lineTo(x + off, 150); ctx.stroke(); }
      for (let y = 0; y < 150; y += 24) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      for (let i = 0; i < 4; i++) {
        const x = ((i * 140 + this.time * 6) % (W + 120)) - 60;
        const y = 22 + (i % 2) * 26;
        ctx.fillRect(x, y, 46, 8);
        ctx.fillRect(x + 8, y - 5, 28, 6);
      }
    }
    ctx.fillStyle = pal.hill;
    ctx.beginPath();
    ctx.moveTo(-20, 150);
    for (let x = -20; x <= W + 20; x += 20) ctx.lineTo(x, 118 + Math.sin(x * 0.02) * 10);
    ctx.lineTo(W + 20, 150);
    ctx.fill();
    ctx.fillStyle = pal.ground;
    ctx.fillRect(-20, 140, W + 40, 200);
    this.drawPad(ctx, 360, 148, 86, 18, pal);
    this.drawPad(ctx, 118, 236, 112, 24, pal);
  }

  drawPad(ctx, x, y, rx, ry, pal) {
    ctx.fillStyle = pal.padEdge;
    ctx.beginPath();
    ctx.ellipse(x, y + 2, rx + 3, ry + 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = pal.pad;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  silhouette(img) {
    if (this.silhouettes.has(img)) return this.silhouettes.get(img);
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, c.width, c.height);
    this.silhouettes.set(img, c);
    return c;
  }

  drawMon(ctx, side) {
    const s = this.sides[side];
    if (!s.mon || s.hidden) return;
    const h = this.home(side);
    const size = h.size * s.scale;
    const bob = Math.sin(this.time * 2.4 + (side === 'enemy' ? 0 : 1.7)) * 1.5;
    const cx = h.x + h.size / 2 + s.ox;
    const bottom = h.y + h.size + s.oy + bob;
    ctx.globalAlpha = s.alpha;
    if (s.img) {
      ctx.drawImage(s.img, Math.round(cx - size / 2), Math.round(bottom - size), Math.round(size), Math.round(size));
      if (s.white > 0) {
        ctx.globalAlpha = s.alpha * s.white;
        ctx.drawImage(this.silhouette(s.img), Math.round(cx - size / 2), Math.round(bottom - size), Math.round(size), Math.round(size));
      }
    } else {
      // Sprite failed to load: draw a type-coloured placeholder.
      ctx.fillStyle = TYPE_COLORS[s.mon.types[0]] || '#888';
      ctx.beginPath();
      ctx.arc(cx, bottom - size * 0.4, size * 0.28, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '16px "Press Start 2P"';
      ctx.textAlign = 'center';
      ctx.fillText(s.mon.displayName[0], cx, bottom - size * 0.4 + 8);
      ctx.textAlign = 'left';
    }
    ctx.globalAlpha = 1;
  }

  drawBall(ctx) {
    const b = this.ballFx;
    if (!b || !b.visible) return;
    const x = Utils.lerp(b.x0, b.x1, b.t);
    const y = Utils.lerp(b.y0, b.y1, b.t) - Math.sin(Math.PI * b.t) * 70 + b.drop;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(b.rot + (b.t < 1 ? b.t * 12 : 0));
    ctx.fillStyle = '#e03030';
    ctx.beginPath();
    ctx.arc(0, 0, 7, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#f8f8f8';
    ctx.beginPath();
    ctx.arc(0, 0, 7, 0, Math.PI);
    ctx.fill();
    ctx.fillStyle = '#202020';
    ctx.fillRect(-7, -1, 14, 2);
    ctx.beginPath();
    ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = b.locked ? '#ffe060' : '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, 1.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawBox(ctx, side) {
    const s = this.sides[side];
    if (!s.mon || s.boxAlpha <= 0.01) return;
    const mon = s.mon;
    const isPlayer = side === 'player';
    const x = isPlayer ? 268 : 14, y = isPlayer ? 150 : 14, w = 198, h = isPlayer ? 62 : 46;
    ctx.globalAlpha = s.boxAlpha;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x + 3, y + 3, w, h);
    ctx.fillStyle = '#f8f8e8';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#404858';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);

    ctx.fillStyle = '#303030';
    ctx.font = '8px "Press Start 2P"';
    ctx.textBaseline = 'alphabetic';
    let name = mon.displayName;
    while (ctx.measureText(name).width > 118 && name.length > 3) name = name.slice(0, -1);
    ctx.fillText(name, x + 8, y + 15);
    ctx.textAlign = 'right';
    ctx.fillText(`Lv${isPlayer ? s.dispLevel : mon.level}`, x + w - 8, y + 15);
    ctx.textAlign = 'left';

    if (mon.status) {
      ctx.fillStyle = STATUS_COLOR[mon.status];
      ctx.fillRect(x + 8, y + 21, 26, 10);
      ctx.fillStyle = '#ffffff';
      ctx.font = '6px "Press Start 2P"';
      ctx.fillText(STATUS_TAG[mon.status], x + 10, y + 29);
    }
    const bx = x + 64, by = y + 23, bw = w - 74;
    ctx.fillStyle = '#e8a030';
    ctx.font = '6px "Press Start 2P"';
    ctx.fillText('HP', bx - 16, by + 6);
    ctx.fillStyle = '#404040';
    ctx.fillRect(bx - 1, by - 1, bw + 2, 8);
    ctx.fillStyle = '#606868';
    ctx.fillRect(bx, by, bw, 6);
    const frac = Utils.clamp(s.dispHp / mon.maxHp, 0, 1);
    ctx.fillStyle = Utils.hpColor(frac);
    ctx.fillRect(bx, by, Math.round(bw * frac), 6);

    if (isPlayer) {
      ctx.fillStyle = '#303030';
      ctx.font = '8px "Press Start 2P"';
      ctx.textAlign = 'right';
      ctx.fillText(`${Math.ceil(s.dispHp)}/${mon.maxHp}`, x + w - 8, y + 45);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#404040';
      ctx.fillRect(x + 30, y + 52, w - 40, 5);
      ctx.fillStyle = '#48a8f8';
      ctx.fillRect(x + 31, y + 53, Math.round((w - 42) * Utils.clamp(s.dispExp, 0, 1)), 3);
      ctx.fillStyle = '#4878c8';
      ctx.font = '6px "Press Start 2P"';
      ctx.fillText('EXP', x + 8, y + 57);
    }
    ctx.globalAlpha = 1;
  }
}
