'use strict';

// A tiny offline dex so the game still boots when PokéAPI can't be reached.
// Output matches the trimmed shapes produced by PokeAPI.trim*().
const Fallback = {
  // name: [type, power, accuracy, pp, damageClass, extra]
  moves: {
    'tackle':        ['normal', 40, 100, 35, 'physical'],
    'scratch':       ['normal', 40, 100, 35, 'physical'],
    'quick-attack':  ['normal', 40, 100, 30, 'physical', { priority: 1 }],
    'bite':          ['dark', 60, 100, 25, 'physical', { flinchChance: 30 }],
    'ember':         ['fire', 40, 100, 25, 'special', { ailment: 'burn', ailmentChance: 10 }],
    'water-gun':     ['water', 40, 100, 25, 'special'],
    'bubble':        ['water', 40, 100, 30, 'special', { statChanges: [{ stat: 'speed', change: -1 }], statChance: 10, category: 'damage+lower' }],
    'vine-whip':     ['grass', 45, 100, 25, 'physical'],
    'gust':          ['flying', 40, 100, 35, 'special'],
    'thunder-shock': ['electric', 40, 100, 30, 'special', { ailment: 'paralysis', ailmentChance: 10 }],
    'poison-sting':  ['poison', 15, 100, 35, 'physical', { ailment: 'poison', ailmentChance: 30 }],
    'growl':         ['normal', 0, 100, 40, 'status', { statChanges: [{ stat: 'attack', change: -1 }], target: 'all-opponents', category: 'net-good-stats' }],
    'tail-whip':     ['normal', 0, 100, 30, 'status', { statChanges: [{ stat: 'defense', change: -1 }], target: 'all-opponents', category: 'net-good-stats' }],
    'string-shot':   ['bug', 0, 95, 40, 'status', { statChanges: [{ stat: 'speed', change: -2 }], target: 'all-opponents', category: 'net-good-stats' }],
    'sand-attack':   ['ground', 0, 100, 15, 'status', { statChanges: [{ stat: 'accuracy', change: -1 }], category: 'net-good-stats' }],
    'thunder-wave':  ['electric', 0, 90, 20, 'status', { ailment: 'paralysis', category: 'ailment' }],
  },

  // id: [name, types, [hp, atk, def, spa, spd, spe], baseExp, captureRate, learnset]
  dex: {
    1:  ['bulbasaur', ['grass', 'poison'], [45, 49, 49, 65, 65, 45], 64, 45, [['tackle', 1], ['growl', 1], ['vine-whip', 7]]],
    4:  ['charmander', ['fire'], [39, 52, 43, 60, 50, 65], 62, 45, [['scratch', 1], ['growl', 1], ['ember', 7]]],
    7:  ['squirtle', ['water'], [44, 48, 65, 50, 64, 43], 63, 45, [['tackle', 1], ['tail-whip', 1], ['bubble', 7], ['water-gun', 13]]],
    10: ['caterpie', ['bug'], [45, 30, 35, 20, 20, 45], 39, 255, [['tackle', 1], ['string-shot', 1]]],
    13: ['weedle', ['bug', 'poison'], [40, 35, 30, 20, 20, 50], 39, 255, [['poison-sting', 1], ['string-shot', 1]]],
    16: ['pidgey', ['normal', 'flying'], [40, 45, 40, 35, 35, 56], 50, 255, [['tackle', 1], ['sand-attack', 5], ['gust', 9], ['quick-attack', 13]]],
    19: ['rattata', ['normal'], [30, 56, 35, 25, 35, 72], 51, 255, [['tackle', 1], ['tail-whip', 1], ['quick-attack', 7], ['bite', 13]]],
    25: ['pikachu', ['electric'], [35, 55, 40, 50, 50, 90], 112, 190, [['thunder-shock', 1], ['growl', 1], ['tail-whip', 6], ['thunder-wave', 8], ['quick-attack', 11]]],
  },

  resolveId(id) {
    if (this.dex[id]) return Number(id);
    const keys = Object.keys(this.dex);
    return Number(keys[Math.abs(Number(id) || 0) % keys.length]);
  },

  move(name) {
    const m = this.moves[name];
    if (!m) return null;
    const [type, power, accuracy, pp, damageClass, extra = {}] = m;
    return {
      name, displayName: Utils.pretty(name), type, power, accuracy, pp, priority: 0, damageClass,
      target: 'selected-pokemon', ailment: 'none', ailmentChance: 0, category: power ? 'damage' : '',
      critRate: 0, drain: 0, healing: 0, flinchChance: 0, minHits: null, maxHits: null, statChance: 0,
      statChanges: [], effect: '', effectChance: null, ...extra,
    };
  },

  pokemon(rawId) {
    const id = this.resolveId(rawId);
    const [name, types, s, baseExp, , learn] = this.dex[id];
    return {
      id, name, speciesName: name, types,
      baseStats: { hp: s[0], attack: s[1], defense: s[2], 'special-attack': s[3], 'special-defense': s[4], speed: s[5] },
      baseExp,
      sprites: {
        front: `${CONFIG.SPRITE_BASE}/pokemon/${id}.png`,
        back: `${CONFIG.SPRITE_BASE}/pokemon/back/${id}.png`,
        icon: null,
      },
      cry: null,
      learnset: learn.map(([n, level]) => ({ name: n, level })),
      versionGroup: 'offline',
    };
  },

  species(rawId) {
    const id = this.resolveId(rawId);
    const [name, , , , captureRate] = this.dex[id];
    return { id, name, displayName: Utils.pretty(name), captureRate, growthRate: 'medium-slow', evolutionChainUrl: null, genus: 'Pokémon', flavor: '' };
  },
};
