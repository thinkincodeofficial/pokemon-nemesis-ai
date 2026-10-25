'use strict';

const STAT_KEYS = ['hp', 'attack', 'defense', 'special-attack', 'special-defense', 'speed'];
const STAGE_KEYS = ['attack', 'defense', 'special-attack', 'special-defense', 'speed', 'accuracy', 'evasion'];
const STAT_LABEL = {
  hp: 'HP', attack: 'Attack', defense: 'Defense', 'special-attack': 'Sp. Atk', 'special-defense': 'Sp. Def',
  speed: 'Speed', accuracy: 'accuracy', evasion: 'evasiveness',
};
const SUPPORTED_AILMENTS = ['paralysis', 'sleep', 'freeze', 'burn', 'poison', 'confusion'];
const STATUS_TAG = { paralysis: 'PAR', sleep: 'SLP', freeze: 'FRZ', burn: 'BRN', poison: 'PSN' };
const STATUS_COLOR = { paralysis: '#d8b020', sleep: '#8890a0', freeze: '#68c8e8', burn: '#e86030', poison: '#a040a0' };

// A move instance known by a Pokémon (static data from PokéAPI + current PP).
class Move {
  constructor(data, pp) {
    this.data = data;
    this.name = data.name;
    this.type = data.type;
    this.power = data.power || 0;
    this.accuracy = data.accuracy;           // null = never misses
    this.maxPp = data.pp || 10;
    this.pp = pp ?? this.maxPp;
    this.priority = data.priority || 0;
    this.damageClass = data.damageClass;
    this.target = data.target;
    this.ailment = data.ailment || 'none';
    this.ailmentChance = data.ailmentChance || 0;
    this.statChanges = data.statChanges || [];
    this.statChance = data.statChance || 0;
    this.healing = data.healing || 0;
    this.drain = data.drain || 0;
    this.critRate = data.critRate || 0;
    this.flinchChance = data.flinchChance || 0;
    this.minHits = data.minHits;
    this.maxHits = data.maxHits;
    this.category = data.category || '';
  }

  get displayName() { return this.data.displayName || Utils.pretty(this.name); }
  get isDamaging() { return this.power > 0 && this.damageClass !== 'status'; }

  // Only moves whose effect the battle engine can actually simulate are allowed.
  static isUsable(d) {
    if (!d) return false;
    if (d.damageClass !== 'status') return d.power > 0;
    return d.healing > 0 || d.statChanges?.length > 0 || SUPPORTED_AILMENTS.includes(d.ailment);
  }

  static async load(name, pp) {
    return new Move(await PokeAPI.getMove(name), pp);
  }

  // Used when every move is out of PP.
  static struggle() {
    return new Move({
      name: 'struggle', displayName: 'Struggle', type: 'typeless', power: 50, accuracy: null, pp: 1,
      damageClass: 'physical', target: 'selected-pokemon', drain: -25, statChanges: [],
    });
  }

  toJSON() {
    return { name: this.name, pp: this.pp };
  }
}

// One Pokémon: stats, level/EXP, moves, HP, status and in-battle state.
class Pokemon {
  constructor(data, species, level, opts = {}) {
    this.data = data;
    this.species = species || {};
    this.uid = opts.uid || Utils.uid();
    this.nickname = opts.nickname || null;
    this.level = level;
    this.ivs = opts.ivs || Object.fromEntries(STAT_KEYS.map(k => [k, Utils.randInt(0, 31)]));
    this.exp = opts.exp ?? Pokemon.expForLevel(level, this.growthRate);
    this.moves = opts.moves || [];
    this.calcStats();
    this.hp = Utils.clamp(opts.hp ?? this.stats.hp, 0, this.stats.hp);
    this.status = opts.status || null;
    this.sleepTurns = opts.sleepTurns || 0;
    this.resetBattleState();
  }

  get id() { return this.data.id; }
  get name() { return this.data.name; }
  get displayName() { return this.nickname || this.species.displayName || Utils.pretty(this.data.name); }
  get types() { return this.data.types; }
  get maxHp() { return this.stats.hp; }
  get hpFrac() { return this.stats.hp ? this.hp / this.stats.hp : 0; }
  get fainted() { return this.hp <= 0; }
  get growthRate() { return this.species.growthRate || 'medium'; }

  // 0..1 progress through the current level (for the EXP bar).
  get expProgress() {
    if (this.level >= CONFIG.MAX_LEVEL) return 1;
    const lo = Pokemon.expForLevel(this.level, this.growthRate);
    const hi = Pokemon.expForLevel(this.level + 1, this.growthRate);
    return Utils.clamp((this.exp - lo) / Math.max(1, hi - lo), 0, 1);
  }

  get expToNext() {
    if (this.level >= CONFIG.MAX_LEVEL) return 0;
    return Math.max(0, Pokemon.expForLevel(this.level + 1, this.growthRate) - this.exp);
  }

  // Main-series stat formula (EVs omitted, neutral nature).
  calcStats() {
    const b = this.data.baseStats;
    this.stats = {};
    for (const k of STAT_KEYS) {
      const core = Math.floor(((2 * (b[k] || 50) + this.ivs[k]) * this.level) / 100);
      this.stats[k] = k === 'hp' ? core + this.level + 10 : core + 5;
    }
  }

  resetBattleState() {
    this.stages = Object.fromEntries(STAGE_KEYS.map(k => [k, 0]));
    this.volatile = { confusion: 0, flinch: false };
  }

  effectiveSpeed() {
    let s = this.stats.speed * Utils.stageMultiplier(this.stages.speed);
    if (this.status === 'paralysis') s *= 0.5;
    return s;
  }

  heal(amount) {
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    return this.hp - before;
  }

  fullRestore() {
    this.hp = this.maxHp;
    this.status = null;
    this.sleepTurns = 0;
    for (const m of this.moves) m.pp = m.maxPp;
    this.resetBattleState();
  }

  // Total EXP needed to reach level n for a PokéAPI growth rate.
  static expForLevel(n, rate) {
    if (n <= 1) return 0;
    let v;
    switch (rate) {
      case 'fast': v = (4 * n ** 3) / 5; break;
      case 'medium-slow': v = (6 / 5) * n ** 3 - 15 * n ** 2 + 100 * n - 140; break;
      case 'slow': v = (5 * n ** 3) / 4; break;
      default: v = n ** 3; // medium / medium-fast / erratic / fluctuating
    }
    return Math.max(0, Math.floor(v));
  }

  // Adds EXP and returns the list of levels reached.
  gainExp(amount) {
    const levels = [];
    this.exp += amount;
    while (this.level < CONFIG.MAX_LEVEL && this.exp >= Pokemon.expForLevel(this.level + 1, this.growthRate)) {
      const oldMax = this.maxHp;
      this.level++;
      this.calcStats();
      if (this.hp > 0) this.hp += this.maxHp - oldMax;
      levels.push(this.level);
    }
    return levels;
  }

  // Moves this species learns exactly at `level` that it doesn't already know.
  async movesLearnedAt(level) {
    const names = [...new Set(this.data.learnset.filter(l => l.level === level).map(l => l.name))]
      .filter(n => !this.moves.some(m => m.name === n));
    const datas = await Promise.all(names.map(n => PokeAPI.getMove(n).catch(() => null)));
    return datas.filter(Move.isUsable).map(d => new Move(d));
  }

  // Returns the Pokémon id this one should evolve into at its current level, or null.
  async checkEvolution() {
    if (!this.species.evolutionChainUrl) return null;
    const chain = await PokeAPI.getEvolutionChain(this.species.evolutionChainUrl);
    const find = node => (node.name === (this.data.speciesName || this.name) ? node : node.evolvesTo.map(find).find(Boolean));
    const node = find(chain);
    for (const next of node?.evolvesTo || []) {
      const rule = next.details.find(d => d.trigger === 'level-up' && d.minLevel && !d.extra);
      if (rule && this.level >= rule.minLevel) return next.id;
    }
    return null;
  }

  async evolveInto(id) {
    const [data, species] = await Promise.all([PokeAPI.getPokemon(id), PokeAPI.getSpecies(id)]);
    const lost = this.maxHp - this.hp;
    this.data = data;
    this.species = species;
    this.calcStats();
    this.hp = Math.max(1, this.maxHp - lost);
  }

  toJSON() {
    return {
      id: this.id, level: this.level, exp: this.exp, ivs: this.ivs, hp: this.hp, status: this.status,
      sleepTurns: this.sleepTurns, nickname: this.nickname, uid: this.uid, moves: this.moves.map(m => m.toJSON()),
    };
  }

  static async create(id, level, opts = {}) {
    const [data, species] = await Promise.all([PokeAPI.getPokemon(id), PokeAPI.getSpecies(id)]);
    const moves = opts.moves || await Pokemon.pickMoves(data, level);
    return new Pokemon(data, species, level, { ...opts, moves });
  }

  // Chooses up to four moves from the learnset: newest damaging moves + one status move.
  static async pickMoves(data, level) {
    const known = data.learnset.filter(m => m.level <= level).sort((a, b) => b.level - a.level);
    const names = [...new Set(known.map(m => m.name))].slice(0, 10);
    const loaded = (await Promise.all(names.map(n => PokeAPI.getMove(n).catch(() => null)))).filter(Move.isUsable);
    const damaging = loaded.filter(d => d.power > 0 && d.damageClass !== 'status');
    const status = loaded.filter(d => !damaging.includes(d));
    let picks = [...damaging.slice(0, 3), ...status.slice(0, 1)];
    for (const d of loaded) if (picks.length < 4 && !picks.includes(d)) picks.push(d);
    if (!picks.some(d => d.power > 0)) {
      const tackle = await PokeAPI.getMove('tackle').catch(() => Fallback.move('tackle'));
      picks.unshift(tackle);
    }
    return picks.slice(0, 4).map(d => new Move(d));
  }

  static async fromJSON(j) {
    const [data, species] = await Promise.all([PokeAPI.getPokemon(j.id), PokeAPI.getSpecies(j.id)]);
    const moves = (await Promise.all(j.moves.map(m => Move.load(m.name, m.pp).catch(() => null)))).filter(Boolean);
    return new Pokemon(data, species, j.level, { ...j, moves });
  }
}
