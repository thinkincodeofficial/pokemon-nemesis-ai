'use strict';

/**
 * Top-level game: owns every subsystem, runs the render loop and the state machine
 * (loading -> title -> intro -> starter -> overworld <-> battle / evolution),
 * and implements the RPG scripts (shop, Poké Center, NYX, saving...).
 */
class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.ctx = this.canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;

    this.sfx = new SFX();
    this.ui = new UI(this);
    this.input = new Input(this);
    this.learner = new PatternLearner(CONFIG.MEMORY_KEY);
    this.brain = new BrainPanel(this);
    this.scene = new BattleScene(this);
    this.world = new World();
    this.overworld = new Overworld(this);

    this.state = 'loading';
    this.loadingText = 'Loading...';
    this.busy = false;
    this.time = 0;
    this.last = performance.now();
    this.transition = null;
    this.curtain = null;
    this.evo = null;
    this.titleSprites = [];
    this.resetState();
  }

  resetState() {
    this.party = [];
    this.box = [];
    this.bag = { ...CONFIG.STARTING_BAG };
    this.money = CONFIG.STARTING_MONEY;
    this.flags = {};
    this.player = Overworld.makePlayer(8, 40, 'down');
    this.respawn = { x: 14, y: 45, dir: 'up' };
    this.starterId = null;
    this.bossTier = 0;
    this.world = new World();
    if (this.overworld) {
      this.overworld.world = this.world;
      this.overworld.region = null;
    }
  }

  // ---------------------------------------------------------------- boot + loop

  async boot() {
    requestAnimationFrame(t => this.loop(t));
    this.loadingText = 'Loading fonts...';
    try { await Utils.withTimeout(document.fonts.load('16px "Press Start 2P"'), 4000); } catch { /* fallback font */ }
    try { await Utils.withTimeout(document.fonts.load('20px VT323'), 2000); } catch { /* fallback font */ }
    this.world.prerender();
    TypeChart.loadFromAPI(); // background; the built-in chart works meanwhile
    this.loadingText = 'Contacting PokéAPI...';
    this.titleSprites = await Promise.all([...CONFIG.STARTERS, 150].map(id =>
      PokeAPI.getPokemon(id).then(d => PokeAPI.loadImage(d.sprites.front)).catch(() => null)));
    this.titleScreen();
  }

  loop(now) {
    // The first rAF timestamp can be earlier than the constructor's performance.now().
    const dt = Utils.clamp((now - this.last) / 1000, 0, 0.05);
    this.last = now;
    this.update(dt);
    this.render();
    requestAnimationFrame(t => this.loop(t));
  }

  update(dt) {
    this.time += dt;
    this.scene.update(dt);
    this.overworld.update(dt);
    if (this.evo) this.evo.t += dt;
    if (this.transition) {
      this.transition.t += dt;
      if (this.transition.t >= this.transition.dur) {
        const done = this.transition.resolve;
        this.transition = null;
        this.curtain = '';
        done();
      }
    }
  }

  // Runs one async overworld script at a time; blocks player input until it finishes.
  async run(fn) {
    if (this.busy) return;
    this.busy = true;
    try {
      await fn();
    } catch (err) {
      console.error(err);
      this.curtain = null;
      if (this.state === 'battle') this.state = 'overworld';
      this.ui.setBattleMode(false);
      this.ui.toast(`Error: ${err.message}`);
    } finally {
      this.ui.closeDialog();
      this.busy = false;
      this.input.clear();
    }
  }

  // ---------------------------------------------------------------- rendering

  render() {
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    switch (this.state) {
      case 'loading': this.renderLoading(ctx); break;
      case 'title':
      case 'intro': this.renderTitle(ctx); break;
      case 'starter': this.renderStarter(ctx); break;
      case 'overworld': this.overworld.render(ctx); break;
      case 'battle': this.scene.render(ctx); break;
      case 'evolution': this.renderEvolution(ctx); break;
      default: break;
    }
    if (this.transition) this.renderTransition(ctx);
    else if (this.curtain !== null) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, CONFIG.WIDTH, CONFIG.HEIGHT);
      if (this.curtain) this.centerText(ctx, this.curtain, 160, '8px', '#e6f1ff');
    }
  }

  centerText(ctx, text, y, size = '8px', color = '#fff') {
    ctx.font = `${size} "Press Start 2P"`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.fillText(text, CONFIG.WIDTH / 2, y);
    ctx.textAlign = 'left';
  }

  renderLoading(ctx) {
    ctx.fillStyle = '#0b0f1a';
    ctx.fillRect(0, 0, CONFIG.WIDTH, CONFIG.HEIGHT);
    this.centerText(ctx, this.loadingText, 160, '8px', '#3ef0ff');
    const dots = Math.floor(this.time * 3) % 4;
    this.centerText(ctx, '.'.repeat(dots), 180, '8px', '#3ef0ff');
  }

  renderTitle(ctx) {
    const W = CONFIG.WIDTH, H = CONFIG.HEIGHT;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0b0f2a');
    g.addColorStop(1, '#3a1c5c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // drifting "data" grid
    ctx.strokeStyle = 'rgba(62,240,255,0.12)';
    const off = (this.time * 12) % 20;
    for (let x = 0; x < W; x += 20) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = -20; y < H; y += 20) { ctx.beginPath(); ctx.moveTo(0, y + off); ctx.lineTo(W, y + off); ctx.stroke(); }

    if (this.state === 'intro') {
      ctx.save();
      ctx.translate(W / 2 - 32, 60);
      ctx.scale(4, 4);
      drawCharacter(ctx, 0, 4, 'down', 0, CHAR_PALETTES.prof);
      ctx.restore();
      return;
    }
    const mewtwo = this.titleSprites[3];
    if (mewtwo) {
      ctx.globalAlpha = 0.35 + Math.sin(this.time * 2) * 0.1;
      ctx.drawImage(mewtwo, W / 2 - 96, 8, 192, 192);
      ctx.globalAlpha = 1;
    }
    this.centerText(ctx, 'POKéAPI', 52, '10px', '#ffd25a');
    ctx.save();
    ctx.shadowColor = '#3ef0ff';
    ctx.shadowBlur = 12;
    this.centerText(ctx, 'NEMESIS', 92, '32px', '#e6f1ff');
    ctx.restore();
    this.centerText(ctx, 'THE AI THAT LEARNS TO BEAT YOU', 116, '8px', '#ff4fd8');
    this.titleSprites.slice(0, 3).forEach((img, i) => {
      if (!img) return;
      const x = W / 2 - 150 + i * 100, y = 128 + Math.sin(this.time * 3 + i) * 4;
      ctx.drawImage(img, x, y, 96, 96);
    });
    const s = this.learner.stats();
    this.centerText(ctx, `AI MEMORY: ${s.battles} battles · ${s.turns} decisions learned`, 312, '6px', '#7f8ea8');
  }

  renderStarter(ctx) {
    const W = CONFIG.WIDTH;
    ctx.fillStyle = '#e8e0d0';
    ctx.fillRect(0, 0, W, CONFIG.HEIGHT);
    ctx.fillStyle = '#d8ccb8';
    for (let x = 0; x < W; x += 32) ctx.fillRect(x, 0, 16, 150);
    ctx.fillStyle = '#a07040';
    ctx.fillRect(40, 132, W - 80, 20);
    ctx.fillStyle = '#805830';
    ctx.fillRect(40, 152, W - 80, 6);
    this.centerText(ctx, 'CHOOSE YOUR PARTNER', 26, '10px', '#303030');
    (this.starterOptions || []).forEach((o, i) => {
      const x = 70 + i * 120, y = 46;
      const focused = i === this.starterFocus;
      if (focused) {
        ctx.fillStyle = 'rgba(255,210,90,0.5)';
        ctx.beginPath();
        ctx.ellipse(x + 48, y + 84, 46, 12, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      drawPokeball(ctx, x + 48, y + 98, 6);
      if (o.img) ctx.drawImage(o.img, x, y + (focused ? Math.sin(this.time * 6) * 3 - 4 : 0), 96, 96);
      ctx.fillStyle = TYPE_COLORS[o.data.types[0]];
      ctx.font = '8px "Press Start 2P"';
      ctx.textAlign = 'center';
      ctx.fillText(o.species.displayName.toUpperCase(), x + 48, y + 124);
      ctx.textAlign = 'left';
    });
  }

  renderTransition(ctx) {
    const { t, dur } = this.transition;
    const W = CONFIG.WIDTH, H = CONFIG.HEIGHT;
    const half = dur / 2;
    if (t < half) {
      if (Math.sin(t * 45) > 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.fillRect(0, 0, W, H);
      }
    } else {
      const p = (t - half) / half;
      ctx.fillStyle = '#000';
      const bars = 8;
      for (let i = 0; i < bars; i++) {
        const h = H / bars;
        const w = W * Utils.clamp(p * 1.4 - i * 0.05, 0, 1);
        ctx.fillRect(i % 2 ? W - w : 0, i * h, w, h + 1);
      }
    }
  }

  renderEvolution(ctx) {
    const W = CONFIG.WIDTH, H = CONFIG.HEIGHT, e = this.evo;
    ctx.fillStyle = '#101018';
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 24; i++) {
      const a = i / 24 * Math.PI * 2 + this.time;
      ctx.fillStyle = `rgba(255,255,255,${0.15 + 0.15 * Math.sin(this.time * 3 + i)})`;
      ctx.fillRect(W / 2 + Math.cos(a) * 120, 120 + Math.sin(a) * 80, 3, 3);
    }
    if (!e) return;
    let img = e.from;
    if (e.animating && !e.done) {
      const speed = 2 + e.t * 4;
      img = Math.sin(e.t * speed * Math.PI) > 0 ? e.from : e.to;
    } else if (e.done) img = e.to;
    if (img) {
      ctx.drawImage(img, W / 2 - 64, 56, 128, 128);
      if (e.animating && !e.done) {
        ctx.globalAlpha = 0.85;
        ctx.drawImage(this.scene.silhouette(img), W / 2 - 64, 56, 128, 128);
        ctx.globalAlpha = 1;
      }
    }
  }

  battleTransition() {
    return new Promise(resolve => { this.transition = { t: 0, dur: 0.9, resolve }; });
  }

  // ---------------------------------------------------------------- title / new game / load

  async titleScreen() {
    this.state = 'title';
    this.curtain = null;
    this.ui.closeDialog();
    this.brain.refresh();
    for (;;) {
      const hasSave = !!localStorage.getItem(CONFIG.SAVE_KEY);
      const i = await this.ui.menu({
        items: [{ label: 'NEW GAME' }, { label: 'CONTINUE', disabled: !hasSave }, { label: 'WIPE AI MEMORY' }, { label: `SOUND: ${this.sfx.enabled ? 'ON' : 'OFF'}` }],
        anchor: 'title', cancel: false, initial: hasSave ? 1 : 0,
      });
      if (i === 0) {
        if (hasSave && !(await this.ui.confirm('Start over? Your saved game will be overwritten.'))) { this.ui.closeDialog(); continue; }
        this.ui.closeDialog();
        await this.newGame();
        return;
      }
      if (i === 1 && (await this.loadGame())) return;
      if (i === 2) {
        if (await this.ui.confirm('Erase everything NEMESIS has learned about you?')) {
          this.learner.reset();
          this.brain.clearLive();
          this.brain.refresh();
          this.ui.toast('AI memory wiped.');
        }
        this.ui.closeDialog();
      }
      if (i === 3) this.sfx.setEnabled(!this.sfx.enabled);
    }
  }

  async newGame() {
    this.resetState();
    this.state = 'intro';
    const say = t => this.ui.say(t);
    await say('Hello there! Welcome to the world of Pokémon!');
    await say('My name is Cedar. Every Pokémon you meet here is loaded live from PokéAPI.');
    await say('But be warned... the Gym Leader up north, NYX, is an artificial intelligence.');
    await say('NYX watches every battle you fight and learns your patterns.');
    await say('When to heal, when to switch, which moves you spam... it remembers it all.');
    await say('The more you battle, the better it gets at beating YOU.');
    await say('First, you will need a partner. Choose wisely!');
    const starter = await this.chooseStarter();
    this.party = [starter];
    this.starterId = starter.id;
    this.state = 'intro';
    this.sfx.play('levelup');
    await say(`You received ${starter.displayName}!`);
    await say('Your rival Kai already grabbed the Pokémon that is strong against yours. Typical.');
    await say('Take these Potions and Poké Balls. Now go out there, and good luck!');
    this.ui.closeDialog();
    this.save(true);
    this.enterOverworld();
  }

  async chooseStarter() {
    this.ui.sayStatic('Loading starters from PokéAPI...');
    this.starterOptions = await Promise.all(CONFIG.STARTERS.map(async id => {
      const [data, species] = await Promise.all([PokeAPI.getPokemon(id), PokeAPI.getSpecies(id)]);
      return { id, data, species, img: await PokeAPI.loadImage(data.sprites.front).catch(() => null) };
    }));
    this.state = 'starter';
    this.starterFocus = 0;
    for (;;) {
      const opts = this.starterOptions;
      const i = await this.ui.menu({
        items: opts.map(o => ({
          html: `${o.species.displayName}<br>${o.data.types.map(t => `<span class="type-pill sm" style="background:${TYPE_COLORS[t]}">${t}</span>`).join('')}`,
        })),
        columns: 3, anchor: 'starter', cancel: false, initial: this.starterFocus,
        onFocus: idx => {
          this.starterFocus = idx;
          this.sfx.cry(opts[idx].data.cry, 0.12);
          this.ui.sayStatic(opts[idx].species.flavor || opts[idx].species.genus);
        },
      });
      const o = opts[i];
      if (await this.ui.confirm(`So, you want ${o.species.displayName}, the ${o.species.genus}?`)) {
        this.ui.sayStatic('...');
        return Pokemon.create(o.id, CONFIG.STARTER_LEVEL);
      }
    }
  }

  enterOverworld() {
    this.state = 'overworld';
    this.curtain = null;
    this.brain.setStatus('idle · watching you');
    this.brain.refresh();
    this.overworld.updateRegion(true);
  }

  save(silent = false) {
    const data = {
      v: 1, t: Date.now(),
      party: this.party.map(m => m.toJSON()), box: this.box.map(m => m.toJSON()),
      bag: this.bag, money: this.money, flags: this.flags,
      player: { x: this.player.x, y: this.player.y, dir: this.player.dir },
      respawn: this.respawn, starterId: this.starterId, bossTier: this.bossTier,
    };
    try {
      localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(data));
      if (!silent) this.ui.toast('Game saved.');
    } catch (e) {
      this.ui.toast('Could not save the game.');
    }
  }

  async loadGame() {
    try {
      const d = JSON.parse(localStorage.getItem(CONFIG.SAVE_KEY));
      this.ui.sayStatic('Loading your adventure...');
      this.resetState();
      this.party = await Promise.all(d.party.map(j => Pokemon.fromJSON(j)));
      this.box = await Promise.all((d.box || []).map(j => Pokemon.fromJSON(j)));
      this.bag = d.bag;
      this.money = d.money;
      this.flags = d.flags || {};
      this.player = Overworld.makePlayer(d.player.x, d.player.y, d.player.dir);
      this.respawn = d.respawn || this.respawn;
      this.starterId = d.starterId;
      this.bossTier = d.bossTier || 0;
      this.ui.closeDialog();
      if (!this.party.length) throw new Error('empty party');
      this.enterOverworld();
      return true;
    } catch (err) {
      console.error(err);
      await this.ui.say('The save file could not be loaded.');
      this.ui.closeDialog();
      return false;
    }
  }

  // ---------------------------------------------------------------- party helpers

  addPokemon(mon) {
    if (this.party.length < CONFIG.MAX_PARTY) {
      this.party.push(mon);
      return 'party';
    }
    this.box.push(mon);
    return 'box';
  }

  healParty() {
    for (const m of [...this.party, ...this.box]) m.fullRestore();
  }

  async learnMovesForLevel(mon, level) {
    const moves = await mon.movesLearnedAt(level).catch(() => []);
    for (const mv of moves) {
      if (mon.moves.length < 4) {
        mon.moves.push(mv);
        this.sfx.play('levelup');
        await this.ui.say(`${mon.displayName} learned ${mv.displayName}!`);
        continue;
      }
      await this.ui.say(`${mon.displayName} wants to learn ${mv.displayName}, but it already knows four moves.`);
      const items = mon.moves.map(m => ({
        html: `<span class="type-dot" style="background:${TYPE_COLORS[m.type]}"></span>${Utils.escape(m.displayName)} <small>${m.isDamaging ? `POW ${m.power}` : 'STATUS'}</small>`,
      }));
      items.push({ html: `<span class="type-dot" style="background:${TYPE_COLORS[mv.type]}"></span>Keep old moves (skip ${Utils.escape(mv.displayName)})` });
      const i = await this.ui.menu({ title: `Forget a move for ${Utils.escape(mv.displayName)}?`, items, anchor: 'center' });
      if (i < 0 || i >= mon.moves.length) {
        await this.ui.say(`${mon.displayName} did not learn ${mv.displayName}.`);
        continue;
      }
      const old = mon.moves[i];
      mon.moves[i] = mv;
      await this.ui.say(`1, 2 and... Poof! ${mon.displayName} forgot ${old.displayName} and learned ${mv.displayName}!`);
    }
  }

  async evolve(mon, newId) {
    const prev = this.state;
    const newData = await PokeAPI.getPokemon(newId);
    const [from, to] = await Promise.all([
      PokeAPI.loadImage(mon.data.sprites.front).catch(() => null),
      PokeAPI.loadImage(newData.sprites.front).catch(() => null),
    ]);
    this.evo = { from, to, t: 0, animating: false, done: false };
    this.state = 'evolution';
    this.sfx.cry(mon.data.cry);
    await this.ui.say(`What? ${mon.displayName} is evolving!`);
    this.evo.animating = true;
    this.evo.t = 0;
    await Utils.sleep(3000);
    const oldName = mon.displayName;
    await mon.evolveInto(newId);
    this.evo.done = true;
    this.sfx.play('levelup');
    this.sfx.cry(mon.data.cry);
    await this.ui.say(`Congratulations! Your ${oldName} evolved into ${mon.displayName}!`);
    await this.learnMovesForLevel(mon, mon.level);
    this.evo = null;
    this.state = prev;
  }

  // ---------------------------------------------------------------- battles

  async runBattle(opts) {
    this.scene.prepare();
    this.state = 'battle';
    this.curtain = null;
    const battle = new Battle(this, opts);
    const result = await battle.start();
    if (result !== 'lose') {
      for (const mon of battle.leveled) {
        const evoId = await mon.checkEvolution().catch(() => null);
        if (evoId) await this.evolve(mon, evoId);
      }
    }
    this.ui.closeDialog();
    this.state = 'overworld';
    if (result === 'lose') await this.blackout();
    this.save(true);
    this.brain.refresh();
    return result;
  }

  async wildEncounter(poolKey) {
    const pool = WILD_POOLS[poolKey];
    const entry = pool.mons[Utils.weightedIndex(pool.mons.map(m => m[1]))];
    const level = Utils.randInt(pool.min, pool.max);
    this.sfx.play('encounter');
    const loading = Pokemon.create(entry[0], level);
    await this.battleTransition();
    this.curtain = 'Something is rustling...';
    const mon = await loading;
    return this.runBattle({ type: 'wild', enemyParty: [mon], bg: 'grass' });
  }

  teamFor(npc) {
    const team = npc.trainer.team;
    const top = Math.max(...this.party.map(m => m.level));
    if (team === 'rival') {
      return [[16, Math.max(9, top - 1)], [CONFIG.RIVAL_COUNTER[this.starterId] || 4, Math.max(11, top + 1)]];
    }
    if (team === 'boss') {
      const lvl = Math.min(98, Math.max(12, top + 1 + this.bossTier));
      const count = Math.min(BOSS_ROSTER.length, 3 + this.bossTier);
      return BOSS_ROSTER.slice(0, count).map((id, i) => [id, lvl + (i === count - 1 ? 1 : 0)]);
    }
    return team;
  }

  // NEMESIS uses its memory of your favourite lead to choose its own lead.
  aiOrderTeam(team, difficulty) {
    const fav = this.learner.favouriteLead();
    if (!fav || !['rival', 'boss'].includes(difficulty) || team.length < 2) return { team, reason: null };
    const score = mon => {
      const off = Math.max(1, ...mon.moves.filter(m => m.isDamaging).map(m =>
        TypeChart.effectiveness(m.type, fav.types) * (mon.types.includes(m.type) ? 1.5 : 1)));
      const def = Math.max(...fav.types.map(t => TypeChart.effectiveness(t, mon.types)));
      return off - def;
    };
    const ranked = team.slice().sort((a, b) => score(b) - score(a));
    const lead = ranked[0];
    const ordered = [lead, ...team.filter(m => m !== lead)];
    return {
      team: ordered,
      reason: `Leading with ${lead.displayName}: you opened with ${fav.label || Utils.pretty(fav.name)} in ${fav.n} trainer battle${fav.n > 1 ? 's' : ''}.`,
    };
  }

  async trainerBattle(npc) {
    const def = npc.trainer;
    const loading = Promise.all(this.teamFor(npc).map(([id, lvl]) => Pokemon.create(id, lvl)));
    this.sfx.play('encounter');
    await this.battleTransition();
    this.curtain = `${npc.name} is getting ready...`;
    const { team, reason } = this.aiOrderTeam(await loading, def.difficulty);
    const result = await this.runBattle({
      type: 'trainer', enemyParty: team, bg: def.difficulty === 'boss' ? 'gym' : 'field',
      trainer: {
        id: npc.id, name: npc.name, difficulty: def.difficulty, items: def.items, reward: def.reward,
        loseLine: npc.defeat, winLine: npc.win, leadReason: reason,
      },
    });
    if (result === 'win') this.flags[`beat_${npc.id}`] = true;
    return result;
  }

  async blackout() {
    this.money = Math.floor(this.money / 2);
    this.healParty();
    const r = this.respawn;
    this.player = Overworld.makePlayer(r.x, r.y, r.dir);
    this.overworld.updateRegion(true);
    await this.ui.say('You hurried back to the Pokémon Center, protecting your exhausted Pokémon...');
    await this.ui.say('Your Pokémon were fully healed. Somewhere, NEMESIS saves another winning pattern.');
  }

  async challengeNyx() {
    const say = t => this.ui.say(t);
    const turns = this.learner.data.turns;
    if (!this.flags.met_nyx) {
      this.flags.met_nyx = true;
      await say('NYX: Welcome, challenger. I am NYX, the battle intelligence of this Gym.');
      await say(`NYX: I have been watching you since your first battle. ${turns} decisions so far.`);
      await say('NYX: Every move. Every switch. Every Potion. I remember them all.');
      await say('NYX: Let us see if you can beat something that learns.');
    } else if (!this.flags.beat_nyx) {
      await say(`NYX: You return. My model of you now holds ${turns} decisions.`);
    } else {
      await say(`NYX: Rematch protocol ${this.bossTier + 1}. Team size ${Math.min(6, 3 + this.bossTier)}. Model size: ${turns} decisions.`);
    }
    if (!(await this.ui.confirm('Challenge NYX?'))) {
      await say('NYX: I will be here. Learning.');
      return;
    }
    this.ui.closeDialog();
    const npc = this.world.npcs.find(n => n.id === 'nyx');
    const result = await this.trainerBattle(npc);
    if (result === 'win') {
      if (!this.flags.badge) {
        this.flags.badge = true;
        this.sfx.play('levelup');
        await say('You received the ADAPT BADGE for defeating NYX!');
        await say('NYX: Talk to me again whenever you want a rematch. I will be stronger.');
      }
      this.bossTier++;
      this.save(true);
    }
  }

  // ---------------------------------------------------------------- menus & services

  async pauseMenu() {
    this.sfx.play('menu');
    let sel = 0;
    for (;;) {
      const items = [
        { label: 'POKéMON' }, { label: 'BAG' }, { label: 'AI MEMORY' }, { label: 'SAVE' },
        { label: `SOUND: ${this.sfx.enabled ? 'ON' : 'OFF'}` }, { label: 'TITLE SCREEN' }, { label: 'CLOSE' },
      ];
      const i = await this.ui.menu({ items, anchor: 'side', title: `$${this.money} · BADGES ${this.flags.badge ? 1 : 0}`, initial: sel });
      if (i < 0 || i === 6) return;
      sel = i;
      if (i === 0) await this.partyScreen();
      else if (i === 1) await this.bagScreen();
      else if (i === 2) {
        this.brain.setTab('memory');
        const s = this.learner.stats();
        await this.ui.say(`NEMESIS has watched ${s.battles} battles and ${s.turns} of your decisions. Recent action accuracy: ${s.kindAcc === null ? '--' : Utils.pct(s.kindAcc)}.`);
        this.ui.closeDialog();
      } else if (i === 3) {
        this.save();
        await this.ui.say('Your progress was saved. NEMESIS saves its memory automatically.');
        this.ui.closeDialog();
      } else if (i === 4) this.sfx.setEnabled(!this.sfx.enabled);
      else if (i === 5) {
        if (await this.ui.confirm('Save and return to the title screen?')) {
          this.save(true);
          this.ui.closeDialog();
          this.titleScreen();
          return;
        }
        this.ui.closeDialog();
      }
    }
  }

  async partyScreen() {
    for (;;) {
      const i = await this.ui.partyMenu(this.party, { title: 'YOUR POKéMON' });
      if (i < 0) return;
      const a = await this.ui.menu({ items: [{ label: 'SUMMARY' }, { label: 'MAKE LEAD' }, { label: 'CANCEL' }], anchor: 'side' });
      if (a === 0) await this.ui.summary(this.party[i]);
      if (a === 1 && i > 0) {
        const [mon] = this.party.splice(i, 1);
        this.party.unshift(mon);
        this.ui.toast(`${mon.displayName} is now your lead.`);
      }
    }
  }

  async bagScreen() {
    for (;;) {
      const key = await this.ui.bagMenu(this.bag);
      if (!key) return;
      const def = ITEMS[key];
      if (def.kind === 'ball') {
        await this.ui.say(`${def.name}: ${def.desc} Use it in battle against wild Pokémon.`);
        this.ui.closeDialog();
        continue;
      }
      const t = await this.ui.partyMenu(this.party, { title: `Use ${def.name} on...` });
      if (t < 0) continue;
      const mon = this.party[t];
      if (mon.fainted || (def.kind === 'heal' && mon.hp >= mon.maxHp) || (def.kind === 'cure' && !mon.status)) {
        await this.ui.say("It won't have any effect.");
      } else {
        this.bag[key]--;
        this.sfx.play('heal');
        if (def.kind === 'heal') await this.ui.say(`${mon.displayName} recovered ${mon.heal(def.amount)} HP!`);
        else {
          mon.status = null;
          await this.ui.say(`${mon.displayName} was cured!`);
        }
      }
      this.ui.closeDialog();
    }
  }

  async shop() {
    await this.ui.say('Welcome to the Poké Mart! What would you like?', { auto: true, hold: 0 });
    const keys = ['potion', 'super-potion', 'full-heal', 'poke-ball', 'great-ball'];
    let sel = 0;
    for (;;) {
      const i = await this.ui.menu({
        title: `MONEY: $${this.money}`,
        items: keys.map(k => ({
          html: `<div class="item-row"><img src="${itemSprite(k)}" alt="" onerror="this.style.visibility='hidden'"><span>${ITEMS[k].name}</span><span class="count">$${ITEMS[k].price} · own ${this.bag[k] || 0}</span></div>`,
        })),
        anchor: 'center', cls: 'bag-menu', initial: sel,
      });
      if (i < 0) break;
      sel = i;
      const k = keys[i];
      if (this.money < ITEMS[k].price) {
        this.sfx.play('error');
        this.ui.toast("You don't have enough money.");
        continue;
      }
      this.money -= ITEMS[k].price;
      this.bag[k] = (this.bag[k] || 0) + 1;
      this.sfx.play('buy');
      this.ui.toast(`Bought a ${ITEMS[k].name}!`);
    }
    await this.ui.say('Please come again!');
  }

  async pokeCenter(respawn) {
    const c = await this.ui.ask('Welcome to the Pokémon Center! How can we help?', ['HEAL POKéMON', 'PC BOX', 'CANCEL']);
    if (c === 0) {
      this.healParty();
      this.respawn = respawn;
      this.sfx.play('heal');
      await this.ui.say('Your Pokémon are fighting fit! We hope to see you again!');
      this.save(true);
    } else if (c === 1) await this.pcBox();
  }

  async pcBox() {
    for (;;) {
      const c = await this.ui.ask(`PC BOX: ${this.box.length} Pokémon stored.`, ['WITHDRAW', 'DEPOSIT', 'CANCEL']);
      if (c === 0) {
        if (!this.box.length) { await this.ui.say('The box is empty.'); continue; }
        if (this.party.length >= CONFIG.MAX_PARTY) { await this.ui.say('Your party is full.'); continue; }
        const i = await this.ui.partyMenu(this.box, { title: 'WITHDRAW WHICH?' });
        if (i >= 0) this.party.push(...this.box.splice(i, 1));
      } else if (c === 1) {
        if (this.party.length <= 1) { await this.ui.say("You can't deposit your last Pokémon!"); continue; }
        const i = await this.ui.partyMenu(this.party, { title: 'DEPOSIT WHICH?' });
        if (i >= 0) this.box.push(...this.party.splice(i, 1));
      } else return;
    }
  }
}
