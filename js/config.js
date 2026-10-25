'use strict';

// Global tunables. Anything a designer may want to tweak lives here.
const CONFIG = {
  WIDTH: 480,              // internal canvas resolution (CSS scales it x2)
  HEIGHT: 320,
  TILE: 16,

  API_BASE: 'https://pokeapi.co/api/v2',
  SPRITE_BASE: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites',
  CACHE_PREFIX: 'pkn:cache:v1:',
  SAVE_KEY: 'pkn:save:v1',
  MEMORY_KEY: 'pkn:memory:v1',
  SETTINGS_KEY: 'pkn:settings:v1',

  // Learnsets differ per game; the first version group that has level-up moves wins.
  VERSION_GROUPS: ['firered-leafgreen', 'red-blue', 'yellow', 'emerald', 'ruby-sapphire', 'heartgold-soulsilver',
    'platinum', 'black-white', 'x-y', 'ultra-sun-ultra-moon', 'sword-shield', 'scarlet-violet'],

  STARTERS: [1, 4, 7],
  RIVAL_COUNTER: { 1: 4, 4: 7, 7: 1 },   // rival always takes the starter that beats yours
  STARTER_LEVEL: 5,
  MAX_PARTY: 6,
  MAX_LEVEL: 100,

  WALK_TIME: 0.18,          // seconds per tile
  ENCOUNTER_RATE: 0.12,     // chance per step in tall grass
  TEXT_CPS: 60,             // typewriter characters per second
  BATTLE_TEXT_HOLD: 850,    // ms a battle message stays before auto-advancing

  STARTING_MONEY: 600,
  STARTING_BAG: { 'potion': 3, 'poke-ball': 5 },
};

// Item keys match PokéAPI item names so their sprites can be loaded directly.
const ITEMS = {
  'potion':       { name: 'Potion',       kind: 'heal', amount: 20, price: 200, desc: 'Restores 20 HP to one Pokémon.' },
  'super-potion': { name: 'Super Potion', kind: 'heal', amount: 50, price: 600, desc: 'Restores 50 HP to one Pokémon.' },
  'full-heal':    { name: 'Full Heal',    kind: 'cure', price: 400, desc: 'Cures any status problem.' },
  'poke-ball':    { name: 'Poké Ball',    kind: 'ball', ball: 1, price: 200, desc: 'A device for catching wild Pokémon.' },
  'great-ball':   { name: 'Great Ball',   kind: 'ball', ball: 1.5, price: 600, desc: 'A better ball with a higher catch rate.' },
};

function itemSprite(key) {
  return `${CONFIG.SPRITE_BASE}/items/${key}.png`;
}
