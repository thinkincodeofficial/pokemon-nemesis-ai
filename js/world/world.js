'use strict';

// Tile legend:  . grass   , tall grass   = path   T tree   ~ water   f flowers   S sign
const SOLID_TILES = new Set(['T', '~', 'S']);

// Wild encounters: [pokemon id, weight]
const WILD_POOLS = {
  routeSouth: { min: 2, max: 5, mons: [[16, 30], [19, 30], [10, 15], [13, 15], [29, 8], [32, 8], [21, 10], [25, 2]] },
  routeNorth: {
    min: 4, max: 8,
    mons: [[16, 20], [19, 15], [43, 12], [69, 12], [39, 8], [52, 8], [56, 8], [60, 8], [37, 5], [58, 5], [63, 4], [92, 4], [74, 6], [25, 3], [133, 1]],
  },
};

// NYX's roster. The first `3 + rematch tier` are used; NEMESIS picks the lead.
const BOSS_ROSTER = [61, 58, 93, 64, 82, 123];

const CHAR_PALETTES = {
  player:    { hat: '#e83838', hatDark: '#a01818', hair: '#3a2418', skin: '#f8d0a8', shirt: '#3870e0', pants: '#283048', shoe: '#181818', eye: '#202020' },
  prof:      { hat: '#d0d0d0', hatDark: '#a0a0a0', hair: '#c8c8c8', skin: '#f0c8a0', shirt: '#f4f4f4', pants: '#685040', shoe: '#302018', eye: '#202020' },
  girl:      { hat: '#f878b8', hatDark: '#c04888', hair: '#c86030', skin: '#f8d0a8', shirt: '#f8f0a0', pants: '#5070c0', shoe: '#402020', eye: '#202020' },
  youngster: { hat: '#f8d030', hatDark: '#c09810', hair: '#503010', skin: '#f8d0a8', shirt: '#58a848', pants: '#3858a0', shoe: '#202020', eye: '#202020' },
  lass:      { hat: '#f8a050', hatDark: '#c07028', hair: '#e8c060', skin: '#f8d0a8', shirt: '#e85890', pants: '#384888', shoe: '#402020', eye: '#202020' },
  bug:       { hat: '#88c040', hatDark: '#5a8a20', hair: '#402818', skin: '#f0c8a0', shirt: '#c8a060', pants: '#507040', shoe: '#302018', eye: '#202020' },
  rival:     { hat: '#383838', hatDark: '#181818', hair: '#8858c8', skin: '#f8d0a8', shirt: '#a02828', pants: '#202838', shoe: '#101010', eye: '#202020' },
  scientist: { hat: '#58b8c8', hatDark: '#3888a0', hair: '#303030', skin: '#f0c8a0', shirt: '#e8f0f0', pants: '#404858', shoe: '#202020', eye: '#202020' },
  nyx:       { hat: '#7a2bd8', hatDark: '#40107a', hair: '#c0f0ff', skin: '#d8e8f8', shirt: '#151528', pants: '#101018', shoe: '#3ef0ff', eye: '#3ef0ff' },
};

const BUILDING_STYLES = {
  house:  { roof: '#c85040', roofDark: '#a03828', roofLight: '#e07060', wall: '#f0e0c0', trim: '#b89870' },
  lab:    { roof: '#5878a8', roofDark: '#405880', roofLight: '#7898c8', wall: '#e8e8e8', trim: '#a0a0a0' },
  center: { roof: '#e04848', roofDark: '#b02828', roofLight: '#f07878', wall: '#f8f0f0', trim: '#c0a0a0' },
  mart:   { roof: '#3878d0', roofDark: '#2858a8', roofLight: '#60a0f0', wall: '#f0f0e0', trim: '#a0a090' },
  gym:    { roof: '#4a2a80', roofDark: '#2e1658', roofLight: '#7a4ac0', wall: '#d8d0e8', trim: '#8070a0' },
};

// Draws a 16x20 chibi character with its feet on the tile at (x, y) (screen pixels).
// walkPhase: 0 standing, 1/2 alternating steps.
function drawCharacter(ctx, x, y, dir, walkPhase, pal) {
  x = Math.round(x);
  y = Math.round(y) - 4;
  const r = (px, py, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x + px, y + py, w, h); };
  const bob = walkPhase ? 1 : 0;
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(x + 8, y + 19, 6, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();
  // legs
  r(4, 15 - (walkPhase === 1 ? 1 : 0), 3, 4, pal.pants);
  r(9, 15 - (walkPhase === 2 ? 1 : 0), 3, 4, pal.pants);
  r(4, 18 - (walkPhase === 1 ? 1 : 0), 3, 1, pal.shoe);
  r(9, 18 - (walkPhase === 2 ? 1 : 0), 3, 1, pal.shoe);
  // body + arms
  r(4, 9 - bob, 8, 7, pal.shirt);
  r(3, 10 - bob, 1, 4, pal.skin);
  r(12, 10 - bob, 1, 4, pal.skin);
  // head
  r(4, 2 - bob, 8, 7, pal.skin);
  r(3, 1 - bob, 10, 3, pal.hat);
  if (dir === 'down') {
    r(4, 4 - bob, 8, 1, pal.hatDark);
    r(4, 5 - bob, 1, 2, pal.hair);
    r(11, 5 - bob, 1, 2, pal.hair);
    r(6, 6 - bob, 1, 2, pal.eye);
    r(9, 6 - bob, 1, 2, pal.eye);
  } else if (dir === 'up') {
    r(4, 3 - bob, 8, 5, pal.hair);
    r(3, 1 - bob, 10, 3, pal.hat);
  } else if (dir === 'left') {
    r(1, 4 - bob, 6, 1, pal.hatDark);
    r(9, 4 - bob, 3, 4, pal.hair);
    r(5, 6 - bob, 1, 2, pal.eye);
  } else {
    r(9, 4 - bob, 6, 1, pal.hatDark);
    r(4, 4 - bob, 3, 4, pal.hair);
    r(10, 6 - bob, 1, 2, pal.eye);
  }
}

function drawPokeball(ctx, x, y, r = 4) {
  ctx.fillStyle = '#e03030';
  ctx.beginPath();
  ctx.arc(x, y, r, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = '#f8f8f8';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI);
  ctx.fill();
  ctx.fillStyle = '#202020';
  ctx.fillRect(x - r, y - 0.5, r * 2, 1);
  ctx.fillRect(x - 1, y - 1, 2, 2);
}

/**
 * The overworld map: three areas (Rootvale Town, Route 1, Ascend City) built from
 * rectangles, plus buildings, NPCs, signs and item pickups. Terrain is pre-rendered once.
 */
class World {
  constructor() {
    this.w = 40;
    this.h = 48;
    this.tiles = World.buildTiles(this.w, this.h);
    this.buildings = World.buildBuildings();
    this.signs = [
      { x: 17, y: 39, text: 'ROOTVALE TOWN\nA quiet town where every journey begins.' },
      { x: 21, y: 31, text: 'ROUTE 1\nNorth: Ascend City. Watch out for the tall grass!' },
      { x: 17, y: 11, text: 'ASCEND CITY - AI GYM\nLeader: NYX, the battle AI that learns from every trainer.' },
    ];
    for (const s of this.signs) this.tiles[s.y][s.x] = 'S';
    this.pickups = [
      { id: 'p1', x: 5, y: 23, item: 'potion', count: 2 },
      { id: 'p2', x: 35, y: 25, item: 'great-ball', count: 2 },
      { id: 'p3', x: 3, y: 44, item: 'super-potion', count: 1 },
    ];
    this.npcs = World.buildNpcs();
    this.canvas = null;
  }

  static buildTiles(W, H) {
    const t = Array.from({ length: H }, () => Array(W).fill('.'));
    const rect = (x, y, w, h, c) => {
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (t[yy] && xx >= 0 && xx < W) t[yy][xx] = c;
    };
    // Forest border and the two tree belts that separate the areas (gap at x 18-21).
    rect(0, 0, W, 2, 'T'); rect(0, H - 2, W, 2, 'T'); rect(0, 0, 2, H, 'T'); rect(W - 2, 0, 2, H, 'T');
    rect(2, 13, 16, 2, 'T'); rect(22, 13, 16, 2, 'T');
    rect(2, 33, 16, 2, 'T'); rect(22, 33, 16, 2, 'T');

    // Ascend City (north)
    rect(4, 10, 32, 1, '=');
    rect(11, 4, 3, 2, 'f'); rect(26, 4, 3, 2, 'f'); rect(4, 11, 4, 1, 'f'); rect(30, 11, 5, 1, 'f');

    // Route 1: tall grass, pond, trees
    rect(3, 16, 13, 5, ','); rect(24, 16, 12, 5, ',');
    rect(3, 26, 12, 5, ','); rect(25, 27, 11, 5, ',');
    rect(27, 22, 7, 3, '~');
    rect(9, 22, 2, 2, 'T'); rect(34, 22, 2, 2, 'T');

    // Rootvale Town (south)
    rect(5, 40, 30, 1, '=');
    rect(27, 42, 6, 3, '~');
    rect(22, 42, 3, 2, 'f'); rect(3, 42, 3, 3, 'f');

    // Main north-south road
    rect(19, 9, 2, 37, '=');
    return t;
  }

  static buildBuildings() {
    const list = [
      { id: 'gym', kind: 'gym', x: 15, y: 3, w: 10, h: 6, label: 'AI GYM' },
      { id: 'center-n', kind: 'center', x: 4, y: 5, w: 6, h: 5, label: 'P.C' },
      { id: 'mart', kind: 'mart', x: 30, y: 5, w: 6, h: 5, label: 'MART' },
      { id: 'home', kind: 'house', x: 5, y: 36, w: 6, h: 4 },
      { id: 'lab', kind: 'lab', x: 26, y: 36, w: 8, h: 4, label: 'LAB' },
      { id: 'center-s', kind: 'center', x: 12, y: 41, w: 5, h: 4, label: 'P.C' },
    ];
    for (const b of list) b.door = { x: b.x + Math.floor(b.w / 2), y: b.y + b.h - 1 };
    return list;
  }

  static buildNpcs() {
    const npc = o => ({ moving: null, walkCycle: 0, emote: null, fx: o.x, fy: o.y, ...o });
    return [
      npc({ id: 'prof', x: 24, y: 39, dir: 'down', name: 'Prof. Cedar', pal: 'prof', lines: [
        'PROF. CEDAR: NYX is no ordinary Gym Leader. It is a learning AI.',
        'It remembers your habits: when you heal, when you switch, which moves you love.',
        'Watch the NEMESIS panel on the right. That is NYX thinking, live!',
        'To beat it... try being unpredictable.'] }),
      npc({ id: 'kid', x: 9, y: 43, dir: 'right', name: 'Mila', pal: 'girl', wander: true, lines: [
        'MILA: Every trainer on Route 1 shares their battle data with NYX.',
        'So even the small fights teach it about you!'] }),
      npc({ id: 'rick', x: 17, y: 28, dir: 'right', sight: 3, name: 'Bug Catcher Rick', pal: 'bug',
        trainer: { team: [[10, 4], [13, 4]], difficulty: 'trainer', reward: 120, items: {} },
        intro: 'Bugs are the best! Let me show you!', defeat: 'Bugs... squashed...', after: "I'll catch stronger bugs next time." }),
      npc({ id: 'mira', x: 22, y: 23, dir: 'left', sight: 3, name: 'Lass Mira', pal: 'lass',
        trainer: { team: [[39, 7], [43, 6]], difficulty: 'trainer', reward: 200, items: { potion: 1 } },
        intro: "You look like you'd be fun to battle!", defeat: 'Aww, that was over so fast!', after: 'NYX told me you like to attack a lot...' }),
      npc({ id: 'joey', x: 17, y: 18, dir: 'right', sight: 3, name: 'Youngster Joey', pal: 'youngster',
        trainer: { team: [[19, 8], [16, 8], [21, 9]], difficulty: 'trainer', reward: 260, items: { potion: 1 } },
        intro: 'My Rattata is in the top percentage of Rattata!', defeat: 'My Rattata... it was top percentage...', after: 'Rattata is still the best, you know.' }),
      npc({ id: 'rival', x: 21, y: 14, dir: 'left', sight: 3, name: 'Rival Kai', pal: 'rival', hideAfterDefeat: true,
        trainer: { team: 'rival', difficulty: 'rival', reward: 500, items: { potion: 2 } },
        intro: "Took you long enough! I've been studying NYX's data on you. Let's see if it's right!",
        defeat: "Tch... NYX's numbers said I'd win! Fine, go ahead.", win: 'Just like the data predicted!' }),
      npc({ id: 'sci', x: 12, y: 9, dir: 'down', name: 'Scientist', pal: 'scientist', lines: [
        'SCIENTIST: NYX uses n-gram models to predict what action you take next.',
        'And Q-learning to rate its own tactics. It literally gets rewarded for hurting you!',
        'If you keep doing the same thing... it WILL notice.'] }),
      npc({ id: 'nyx', x: 22, y: 9, dir: 'down', name: 'NYX', pal: 'nyx',
        trainer: { team: 'boss', difficulty: 'boss', reward: 1500, items: { 'super-potion': 2 } },
        defeat: 'Impossible... Recalibrating. I will remember this.', win: 'Your patterns are now my data.' }),
    ];
  }

  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  tileAt(x, y) { return this.inBounds(x, y) ? this.tiles[y][x] : 'T'; }
  buildingAt(x, y) { return this.buildings.find(b => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h); }
  doorAt(x, y) { return this.buildings.find(b => b.door.x === x && b.door.y === y) || null; }
  signAt(x, y) { return this.signs.find(s => s.x === x && s.y === y) || null; }

  // Terrain + buildings only (NPCs/pickups are checked by the Overworld).
  isSolidTerrain(x, y) {
    return !this.inBounds(x, y) || SOLID_TILES.has(this.tiles[y][x]) || !!this.buildingAt(x, y);
  }

  poolAt(x, y) { return y < 24 ? 'routeNorth' : 'routeSouth'; }
  regionAt(y) { return y <= 14 ? 'ASCEND CITY' : y <= 34 ? 'ROUTE 1' : 'ROOTVALE TOWN'; }

  // ---------------------------------------------------------------- rendering

  prerender() {
    const c = document.createElement('canvas');
    c.width = this.w * 16;
    c.height = this.h * 16;
    const ctx = c.getContext('2d');
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) this.drawTile(ctx, this.tiles[y][x], x, y);
    for (const b of this.buildings) this.drawBuilding(ctx, b);
    this.canvas = c;
  }

  drawGrass(ctx, X, Y, h) {
    ctx.fillStyle = '#88d070';
    ctx.fillRect(X, Y, 16, 16);
    if (h < 0.45) {
      ctx.fillStyle = '#70b858';
      const ox = Math.floor(h * 100) % 10, oy = Math.floor(h * 1000) % 10;
      ctx.fillRect(X + ox + 1, Y + oy + 2, 1, 2);
      ctx.fillRect(X + ox + 3, Y + oy + 1, 1, 3);
    }
  }

  drawTile(ctx, ch, x, y) {
    const X = x * 16, Y = y * 16, h = Utils.hash(x, y);
    const circle = (cx, cy, r) => { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); };
    switch (ch) {
      case ',':
        ctx.fillStyle = '#58a848';
        ctx.fillRect(X, Y, 16, 16);
        for (let i = 0; i < 4; i++) {
          const bx = X + (i % 2) * 8 + 1, by = Y + Math.floor(i / 2) * 8 + 1;
          ctx.fillStyle = '#3d8a34';
          ctx.fillRect(bx, by + 2, 2, 5);
          ctx.fillRect(bx + 4, by + 2, 2, 5);
          ctx.fillRect(bx + 2, by + 4, 2, 3);
          ctx.fillStyle = '#90e070';
          ctx.fillRect(bx, by + 1, 2, 1);
          ctx.fillRect(bx + 4, by + 1, 2, 1);
        }
        break;
      case '=':
        ctx.fillStyle = '#e8d4a0';
        ctx.fillRect(X, Y, 16, 16);
        ctx.fillStyle = '#d4bc84';
        if (h < 0.6) ctx.fillRect(X + Math.floor(h * 13), Y + Math.floor(h * 97) % 13, 2, 1);
        if (h > 0.3) ctx.fillRect(X + Math.floor(h * 71) % 14, Y + Math.floor(h * 37) % 14, 1, 1);
        break;
      case '~':
        ctx.fillStyle = '#3d8de0';
        ctx.fillRect(X, Y, 16, 16);
        ctx.fillStyle = '#5aa4ec';
        ctx.fillRect(X + 2, Y + 4, 5, 1);
        ctx.fillRect(X + 9, Y + 11, 5, 1);
        break;
      case 'f': {
        this.drawGrass(ctx, X, Y, 1);
        const cols = ['#f8f8f8', '#f85868', '#f8d848'];
        [[3, 3], [10, 5], [6, 11], [12, 12]].forEach(([fx, fy], i) => {
          ctx.fillStyle = cols[(i + Math.floor(h * 3)) % 3];
          ctx.fillRect(X + fx - 1, Y + fy, 3, 1);
          ctx.fillRect(X + fx, Y + fy - 1, 1, 3);
          ctx.fillStyle = '#e8a030';
          ctx.fillRect(X + fx, Y + fy, 1, 1);
        });
        break;
      }
      case 'T':
        this.drawGrass(ctx, X, Y, 1);
        ctx.fillStyle = '#5a3a1e';
        ctx.fillRect(X + 6, Y + 11, 4, 5);
        ctx.fillStyle = '#1f5e2c';
        circle(X + 8, Y + 7, 7.5);
        ctx.fillStyle = '#2f8040';
        circle(X + 7, Y + 6, 5.5);
        ctx.fillStyle = '#4aa858';
        circle(X + 5.5, Y + 4.5, 2.2);
        break;
      case 'S':
        this.drawGrass(ctx, X, Y, 1);
        ctx.fillStyle = '#7a5030';
        ctx.fillRect(X + 7, Y + 9, 2, 6);
        ctx.fillRect(X + 1, Y + 2, 14, 9);
        ctx.fillStyle = '#c89858';
        ctx.fillRect(X + 2, Y + 3, 12, 7);
        ctx.fillStyle = '#7a5030';
        ctx.fillRect(X + 4, Y + 5, 8, 1);
        ctx.fillRect(X + 4, Y + 7, 6, 1);
        break;
      default:
        this.drawGrass(ctx, X, Y, h);
    }
  }

  drawBuilding(ctx, b) {
    const X = b.x * 16, Y = b.y * 16, W = b.w * 16, H = b.h * 16;
    const st = BUILDING_STYLES[b.kind];
    const roofH = Math.round(H * 0.5);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(X + 4, Y + H - 2, W, 4);
    ctx.fillStyle = st.wall;
    ctx.fillRect(X, Y + roofH, W, H - roofH);
    ctx.fillStyle = st.trim;
    ctx.fillRect(X, Y + H - 3, W, 3);
    ctx.fillStyle = st.roof;
    ctx.fillRect(X - 2, Y + 2, W + 4, roofH);
    ctx.fillStyle = st.roofDark;
    for (let yy = Y + 7; yy < Y + roofH; yy += 5) ctx.fillRect(X - 2, yy, W + 4, 1);
    ctx.fillRect(X - 2, Y + roofH, W + 4, 2);
    ctx.fillStyle = st.roofLight;
    ctx.fillRect(X - 2, Y + 2, W + 4, 2);

    // windows (skip the door column)
    for (let tx = b.x; tx < b.x + b.w; tx++) {
      if (Math.abs(tx - b.door.x) < 1 || (tx - b.x) % 2 === 1) continue;
      const wx = tx * 16 + 3, wy = Y + roofH + 5;
      if (wy + 8 > Y + H - 4) continue;
      ctx.fillStyle = '#506070';
      ctx.fillRect(wx - 1, wy - 1, 12, 9);
      ctx.fillStyle = b.kind === 'gym' ? '#3ef0ff' : '#90c8f0';
      ctx.fillRect(wx, wy, 10, 7);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillRect(wx + 1, wy + 1, 3, 2);
    }

    const dx = b.door.x * 16, dy = b.door.y * 16;
    ctx.fillStyle = '#403028';
    ctx.fillRect(dx + 2, dy + 1, 12, 15);
    ctx.fillStyle = b.kind === 'center' || b.kind === 'mart' ? '#a8d8f8' : b.kind === 'gym' ? '#2a1850' : '#805830';
    ctx.fillRect(dx + 3, dy + 2, 10, 14);
    if (b.kind === 'gym') {
      ctx.fillStyle = '#3ef0ff';
      ctx.fillRect(dx + 3, dy + 2, 10, 1);
      ctx.fillRect(dx + 7, dy + 2, 2, 14);
    }

    if (b.label) {
      ctx.font = '8px "Press Start 2P"';
      const tw = ctx.measureText(b.label).width;
      const lx = X + W / 2 - tw / 2 - 4, ly = Y + roofH - 13;
      ctx.fillStyle = b.kind === 'gym' ? '#101020' : '#f8f8f8';
      ctx.fillRect(lx, ly, tw + 8, 12);
      ctx.fillStyle = b.kind === 'gym' ? '#3ef0ff' : b.kind === 'center' ? '#e04848' : '#3878d0';
      ctx.fillText(b.label, lx + 4, ly + 10);
    }
  }

  render(ctx, camX, camY, time) {
    const W = CONFIG.WIDTH, H = CONFIG.HEIGHT;
    if (!this.canvas) this.prerender();
    ctx.drawImage(this.canvas, camX, camY, W, H, 0, 0, W, H);
    // Animated water shimmer.
    const x0 = Math.floor(camX / 16), y0 = Math.floor(camY / 16);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    for (let y = y0; y <= y0 + H / 16 + 1; y++) {
      for (let x = x0; x <= x0 + W / 16 + 1; x++) {
        if (this.tileAt(x, y) !== '~') continue;
        const off = Math.floor(time * 5 + x * 3 + y * 5) % 12;
        ctx.fillRect(x * 16 - camX + off, y * 16 - camY + 7 + ((x + y) % 2) * 3, 3, 1);
      }
    }
  }

  // Re-draws the bottom half of tall grass over a character standing in it.
  drawGrassOverlay(ctx, tx, ty, camX, camY) {
    ctx.drawImage(this.canvas, tx * 16, ty * 16 + 9, 16, 7, tx * 16 - camX, ty * 16 - camY + 9, 16, 7);
  }
}
