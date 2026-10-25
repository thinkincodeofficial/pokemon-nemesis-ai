'use strict';

const DIR_VEC = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const OPPOSITE_DIR = { up: 'down', down: 'up', left: 'right', right: 'left' };

/**
 * Overworld controller: grid movement, camera, collisions, NPC line-of-sight,
 * interactions (talk, signs, doors, items) and tall-grass encounters.
 */
class Overworld {
  constructor(game) {
    this.game = game;
    this.world = game.world;
    this.region = null;
    this.bumpTimer = 0;
  }

  static makePlayer(x, y, dir) {
    return { x, y, fx: x, fy: y, dir, moving: null, walkCycle: 0 };
  }

  get player() { return this.game.player; }

  npcVisible(npc) {
    return !(npc.hideAfterDefeat && this.game.flags[`beat_${npc.id}`]);
  }

  npcAt(x, y) {
    return this.world.npcs.find(n => n.x === x && n.y === y && this.npcVisible(n)) || null;
  }

  pickupAt(x, y) {
    return this.world.pickups.find(p => p.x === x && p.y === y && !this.game.flags[`item_${p.id}`]) || null;
  }

  isBlocked(x, y) {
    return this.world.isSolidTerrain(x, y) || !!this.npcAt(x, y) || !!this.pickupAt(x, y);
  }

  pixelPos(e) {
    if (!e.moving) return { x: e.x * 16, y: e.y * 16 };
    const t = e.moving.t;
    return { x: Utils.lerp(e.fx, e.x, t) * 16, y: Utils.lerp(e.fy, e.y, t) * 16 };
  }

  walkPhase(e) {
    if (!e.moving) return 0;
    return e.moving.t < 0.5 ? 1 + (e.walkCycle % 2) : 0;
  }

  // ---------------------------------------------------------------- update

  update(dt) {
    this.updateEntity(this.player, dt, () => this.onStep());
    for (const npc of this.world.npcs) this.updateEntity(npc, dt);
    this.wander(dt);
    this.bumpTimer = Math.max(0, this.bumpTimer - dt);
    if (this.game.state === 'overworld' && !this.game.busy) this.handleInput();
  }

  updateEntity(e, dt, onArrive) {
    if (!e.moving) return;
    e.moving.t += dt / CONFIG.WALK_TIME;
    if (e.moving.t >= 1) {
      const done = e.moving.done;
      e.moving = null;
      e.walkCycle++;
      if (done) done();
      if (onArrive) onArrive();
    }
  }

  wander(dt) {
    for (const npc of this.world.npcs) {
      if (!npc.wander || npc.moving) continue;
      npc.wanderT = (npc.wanderT ?? Utils.rand(1.5, 4)) - dt;
      if (npc.wanderT <= 0) {
        npc.dir = Utils.choice(Object.keys(DIR_VEC));
        npc.wanderT = Utils.rand(1.5, 4);
      }
    }
  }

  handleInput() {
    const g = this.game, inp = g.input, p = this.player;
    if (p.moving) return;
    if (inp.consume('menu') || inp.consume('cancel')) {
      g.run(() => g.pauseMenu());
      return;
    }
    if (inp.consume('confirm')) {
      const [dx, dy] = DIR_VEC[p.dir];
      g.run(() => this.interact(p.x + dx, p.y + dy));
      return;
    }
    const dir = inp.heldDir();
    if (!dir) return;
    p.dir = dir;
    const [dx, dy] = DIR_VEC[dir];
    const nx = p.x + dx, ny = p.y + dy;
    if (this.isBlocked(nx, ny)) {
      const door = this.world.doorAt(nx, ny);
      if (door && dir === 'up') {
        g.run(() => this.enterBuilding(door));
        return;
      }
      if (this.bumpTimer <= 0) {
        g.sfx.play('bump');
        this.bumpTimer = 0.3;
      }
      return;
    }
    p.fx = p.x;
    p.fy = p.y;
    p.x = nx;
    p.y = ny;
    p.moving = { t: 0 };
  }

  onStep() {
    const g = this.game, p = this.player;
    if (g.state !== 'overworld' || g.busy) return;
    this.updateRegion();
    const spotter = this.findSpotter();
    if (spotter) {
      g.run(() => this.trainerSpotted(spotter));
      return;
    }
    if (this.world.tileAt(p.x, p.y) === ',' && Utils.chance(CONFIG.ENCOUNTER_RATE)) {
      g.run(() => g.wildEncounter(this.world.poolAt(p.x, p.y)));
    }
  }

  updateRegion(force = false) {
    const name = this.world.regionAt(this.player.y);
    if (name !== this.region || force) {
      this.region = name;
      this.game.ui.showBanner(name);
    }
  }

  // Undefeated trainers see the player along their facing line.
  findSpotter() {
    const p = this.player;
    for (const npc of this.world.npcs) {
      if (!npc.trainer || !npc.sight || this.game.flags[`beat_${npc.id}`] || !this.npcVisible(npc)) continue;
      const [dx, dy] = DIR_VEC[npc.dir];
      for (let i = 1; i <= npc.sight; i++) {
        const x = npc.x + dx * i, y = npc.y + dy * i;
        if (x === p.x && y === p.y) return npc;
        if (this.world.isSolidTerrain(x, y) || this.npcAt(x, y)) break;
      }
    }
    return null;
  }

  stepEntity(e, dir) {
    return new Promise(resolve => {
      const [dx, dy] = DIR_VEC[dir];
      e.dir = dir;
      e.fx = e.x;
      e.fy = e.y;
      e.x += dx;
      e.y += dy;
      e.moving = { t: 0, done: resolve };
    });
  }

  // ---------------------------------------------------------------- interactions

  async trainerSpotted(npc) {
    const p = this.player;
    this.game.sfx.play('spotted');
    npc.emote = '!';
    await Utils.sleep(750);
    npc.emote = null;
    while (Math.abs(npc.x - p.x) + Math.abs(npc.y - p.y) > 1) await this.stepEntity(npc, npc.dir);
    p.dir = OPPOSITE_DIR[npc.dir];
    await this.trainerEncounter(npc);
  }

  async trainerEncounter(npc) {
    await this.game.ui.say(`${npc.name.toUpperCase()}: ${npc.intro}`);
    this.game.ui.closeDialog();
    const result = await this.game.trainerBattle(npc);
    if (result === 'win' && npc.hideAfterDefeat) {
      await this.game.ui.say(`${npc.name.toUpperCase()}: I'll report this to NYX. It'll be ready for you. See ya!`);
    }
  }

  async talkTo(npc) {
    const ui = this.game.ui;
    npc.dir = OPPOSITE_DIR[this.player.dir];
    if (npc.id === 'nyx') return this.game.challengeNyx();
    if (npc.trainer && !this.game.flags[`beat_${npc.id}`]) return this.trainerEncounter(npc);
    if (npc.trainer) {
      await ui.say(`${npc.name.toUpperCase()}: ${npc.after || 'Good battle!'}`);
      return;
    }
    for (const line of npc.lines) await ui.say(line);
  }

  async interact(x, y) {
    const g = this.game, ui = g.ui;
    const npc = this.npcAt(x, y);
    if (npc) return this.talkTo(npc);
    const pick = this.pickupAt(x, y);
    if (pick) {
      g.flags[`item_${pick.id}`] = true;
      g.bag[pick.item] = (g.bag[pick.item] || 0) + pick.count;
      g.sfx.play('buy');
      await ui.say(`You found ${pick.count}x ${ITEMS[pick.item].name}!`);
      return;
    }
    const sign = this.world.signAt(x, y);
    if (sign) {
      await ui.say(sign.text);
      return;
    }
    const door = this.world.doorAt(x, y);
    if (door) return this.enterBuilding(door);
    if (this.world.tileAt(x, y) === '~') await ui.say('The water is crystal clear. Something might be swimming in there...');
  }

  async enterBuilding(b) {
    const g = this.game, ui = g.ui;
    switch (b.kind) {
      case 'house':
        await ui.say('MOM: You look exhausted, sweetie. Take a little rest.');
        g.healParty();
        g.sfx.play('heal');
        await ui.say('Your Pokémon were fully healed!');
        break;
      case 'center':
        await g.pokeCenter({ x: b.door.x, y: b.door.y + 1, dir: 'up' });
        break;
      case 'mart':
        await g.shop();
        break;
      case 'gym':
        await g.challengeNyx();
        break;
      case 'lab':
        await ui.say("The lab is full of monitors streaming NYX's battle logs...");
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- rendering

  camera() {
    const pp = this.pixelPos(this.player);
    return {
      x: Math.round(Utils.clamp(pp.x + 8 - CONFIG.WIDTH / 2, 0, this.world.w * 16 - CONFIG.WIDTH)),
      y: Math.round(Utils.clamp(pp.y + 8 - CONFIG.HEIGHT / 2, 0, this.world.h * 16 - CONFIG.HEIGHT)),
    };
  }

  render(ctx) {
    const cam = this.camera();
    this.world.render(ctx, cam.x, cam.y, this.game.time);

    const ents = [];
    for (const pk of this.world.pickups) {
      if (this.game.flags[`item_${pk.id}`]) continue;
      ents.push({ y: pk.y * 16, draw: () => drawPokeball(ctx, pk.x * 16 - cam.x + 8, pk.y * 16 - cam.y + 9, 4) });
    }
    const chars = [...this.world.npcs.filter(n => this.npcVisible(n)), this.player];
    for (const e of chars) {
      const pos = this.pixelPos(e);
      const pal = CHAR_PALETTES[e.pal || 'player'];
      ents.push({
        y: pos.y,
        draw: () => {
          drawCharacter(ctx, pos.x - cam.x, pos.y - cam.y, e.dir, this.walkPhase(e), pal);
          if (!e.moving && this.world.tileAt(e.x, e.y) === ',') this.world.drawGrassOverlay(ctx, e.x, e.y, cam.x, cam.y);
          if (e.emote) {
            const bx = pos.x - cam.x + 3, by = pos.y - cam.y - 18;
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(bx, by, 10, 12);
            ctx.strokeStyle = '#202020';
            ctx.strokeRect(bx + 0.5, by + 0.5, 9, 11);
            ctx.fillStyle = '#e03030';
            ctx.fillRect(bx + 4, by + 2, 2, 5);
            ctx.fillRect(bx + 4, by + 8, 2, 2);
          }
        },
      });
    }
    ents.sort((a, b) => a.y - b.y);
    for (const e of ents) e.draw();
  }
}
