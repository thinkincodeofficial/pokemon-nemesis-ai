'use strict';

const TYPES = ['normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting', 'poison', 'ground',
  'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy'];

const TYPE_COLORS = {
  normal: '#A8A77A', fire: '#EE8130', water: '#6390F0', electric: '#F7D02C', grass: '#7AC74C', ice: '#96D9D6',
  fighting: '#C22E28', poison: '#A33EA1', ground: '#E2BF65', flying: '#A98FF3', psychic: '#F95587', bug: '#A6B91A',
  rock: '#B6A136', ghost: '#735797', dragon: '#6F35FC', dark: '#705746', steel: '#B7B7CE', fairy: '#D685AD',
  typeless: '#888888',
};

// Attacking type -> { defending type: multiplier }. Only non-1x entries are listed.
// The built-in table is replaced by PokéAPI's /type data once it has loaded.
const TypeChart = {
  source: 'built-in',
  chart: {
    normal: { rock: 0.5, ghost: 0, steel: 0.5 },
    fire: { fire: 0.5, water: 0.5, grass: 2, ice: 2, bug: 2, rock: 0.5, dragon: 0.5, steel: 2 },
    water: { fire: 2, water: 0.5, grass: 0.5, ground: 2, rock: 2, dragon: 0.5 },
    electric: { water: 2, electric: 0.5, grass: 0.5, ground: 0, flying: 2, dragon: 0.5 },
    grass: { fire: 0.5, water: 2, grass: 0.5, poison: 0.5, ground: 2, flying: 0.5, bug: 0.5, rock: 2, dragon: 0.5, steel: 0.5 },
    ice: { fire: 0.5, water: 0.5, grass: 2, ice: 0.5, ground: 2, flying: 2, dragon: 2, steel: 0.5 },
    fighting: { normal: 2, ice: 2, poison: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5, rock: 2, ghost: 0, dark: 2, steel: 2, fairy: 0.5 },
    poison: { grass: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0, fairy: 2 },
    ground: { fire: 2, electric: 2, grass: 0.5, poison: 2, flying: 0, bug: 0.5, rock: 2, steel: 2 },
    flying: { electric: 0.5, grass: 2, fighting: 2, bug: 2, rock: 0.5, steel: 0.5 },
    psychic: { fighting: 2, poison: 2, psychic: 0.5, dark: 0, steel: 0.5 },
    bug: { fire: 0.5, grass: 2, fighting: 0.5, poison: 0.5, flying: 0.5, psychic: 2, ghost: 0.5, dark: 2, steel: 0.5, fairy: 0.5 },
    rock: { fire: 2, ice: 2, fighting: 0.5, ground: 0.5, flying: 2, bug: 2, steel: 0.5 },
    ghost: { normal: 0, psychic: 2, ghost: 2, dark: 0.5 },
    dragon: { dragon: 2, steel: 0.5, fairy: 0 },
    dark: { fighting: 0.5, psychic: 2, ghost: 2, dark: 0.5, fairy: 0.5 },
    steel: { fire: 0.5, water: 0.5, electric: 0.5, ice: 2, rock: 2, steel: 0.5, fairy: 2 },
    fairy: { fire: 0.5, fighting: 2, poison: 0.5, dragon: 2, dark: 2, steel: 0.5 },
  },

  // Combined multiplier of an attacking type against one or two defending types.
  effectiveness(attackType, defenderTypes) {
    const row = this.chart[attackType];
    if (!row) return 1;
    let m = 1;
    for (const t of defenderTypes) if (row[t] !== undefined) m *= row[t];
    return m;
  },

  label(mult) {
    if (mult === 0) return 'No effect';
    if (mult >= 2) return 'Super effective';
    if (mult < 1) return 'Not very effective';
    return 'Effective';
  },

  // Rebuilds the chart from PokéAPI damage relations (cached after the first run).
  async loadFromAPI() {
    try {
      const types = await Promise.all(TYPES.map(t => PokeAPI.getType(t)));
      const chart = {};
      for (const t of types) {
        const row = {};
        for (const d of t.double) row[d] = 2;
        for (const d of t.half) row[d] = 0.5;
        for (const d of t.none) row[d] = 0;
        chart[t.name] = row;
      }
      if (Object.keys(chart).length === TYPES.length) {
        this.chart = chart;
        this.source = 'PokéAPI';
      }
    } catch (err) {
      console.warn('Type chart: using built-in table', err);
    }
  },
};
