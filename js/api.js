'use strict';

/**
 * PokéAPI client. Fetches resources, trims the large JSON payloads down to what the
 * game needs, and caches them in memory + localStorage so each one downloads once.
 */
class PokeAPI {
  static memory = new Map();
  static inflight = new Map();
  static images = new Map();
  static offline = false;

  static async fetchJSON(path) {
    const url = path.startsWith('http') ? path : `${CONFIG.API_BASE}/${path}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`PokéAPI ${res.status} for ${url}`);
    return res.json();
  }

  static readCache(key) {
    try {
      const raw = localStorage.getItem(CONFIG.CACHE_PREFIX + key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  static writeCache(key, value) {
    const raw = JSON.stringify(value);
    try {
      localStorage.setItem(CONFIG.CACHE_PREFIX + key, raw);
    } catch {
      // Storage full: drop the API cache (never the save or AI memory) and retry once.
      this.clearCache();
      try { localStorage.setItem(CONFIG.CACHE_PREFIX + key, raw); } catch { /* memory cache still works */ }
    }
  }

  static clearCache() {
    try {
      Object.keys(localStorage).filter(k => k.startsWith(CONFIG.CACHE_PREFIX)).forEach(k => localStorage.removeItem(k));
    } catch { /* ignore */ }
  }

  // Memory -> localStorage -> network, with an optional offline fallback.
  static cached(key, loader, fallback) {
    if (this.memory.has(key)) return Promise.resolve(this.memory.get(key));
    if (this.inflight.has(key)) return this.inflight.get(key);
    const stored = this.readCache(key);
    if (stored) {
      this.memory.set(key, stored);
      return Promise.resolve(stored);
    }
    const job = (async () => {
      try {
        const value = await loader();
        this.memory.set(key, value);
        this.writeCache(key, value);
        return value;
      } catch (err) {
        const fb = fallback ? fallback() : null;
        if (fb) {
          this.offline = true;
          console.warn(`PokéAPI unavailable for ${key}, using offline data`, err);
          this.memory.set(key, fb);
          return fb;
        }
        throw err;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, job);
    return job;
  }

  static getPokemon(id) {
    return this.cached(`pokemon:${id}`, async () => this.trimPokemon(await this.fetchJSON(`pokemon/${id}`)), () => Fallback.pokemon(id));
  }

  static getSpecies(id) {
    return this.cached(`species:${id}`, async () => this.trimSpecies(await this.fetchJSON(`pokemon-species/${id}`)), () => Fallback.species(id));
  }

  static getMove(name) {
    return this.cached(`move:${name}`, async () => this.trimMove(await this.fetchJSON(`move/${name}`)), () => Fallback.move(name));
  }

  static getEvolutionChain(url) {
    const id = Utils.idFromUrl(url);
    return this.cached(`evo:${id}`, async () => this.trimEvolution((await this.fetchJSON(url)).chain));
  }

  static getType(name) {
    return this.cached(`type:${name}`, async () => {
      const j = await this.fetchJSON(`type/${name}`);
      const r = j.damage_relations;
      return {
        name: j.name,
        double: r.double_damage_to.map(t => t.name),
        half: r.half_damage_to.map(t => t.name),
        none: r.no_damage_to.map(t => t.name),
      };
    });
  }

  static loadImage(url) {
    if (!url) return Promise.reject(new Error('no sprite url'));
    if (this.images.has(url)) return this.images.get(url);
    const job = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => { this.images.delete(url); reject(new Error(`image failed: ${url}`)); };
      img.src = url;
    });
    this.images.set(url, job);
    return job;
  }

  // ---- trimming: keep only the fields the game uses ----

  static trimPokemon(j) {
    const stats = {};
    for (const s of j.stats) stats[s.stat.name] = s.base_stat;
    // Pick the first preferred version group that has level-up moves for this Pokémon.
    const byGroup = {};
    for (const m of j.moves) {
      for (const d of m.version_group_details) {
        if (d.move_learn_method.name !== 'level-up') continue;
        (byGroup[d.version_group.name] ||= []).push({ name: m.move.name, level: d.level_learned_at });
      }
    }
    const group = CONFIG.VERSION_GROUPS.find(g => byGroup[g]?.length) || Object.keys(byGroup)[0];
    const learnset = (byGroup[group] || []).sort((a, b) => a.level - b.level);
    const v = j.sprites.versions || {};
    return {
      id: j.id,
      name: j.name,
      speciesName: j.species?.name || j.name,
      types: j.types.slice().sort((a, b) => a.slot - b.slot).map(t => t.type.name),
      baseStats: stats,
      baseExp: j.base_experience || 60,
      sprites: {
        front: j.sprites.front_default,
        back: j.sprites.back_default,
        icon: v['generation-vii']?.icons?.front_default || null,
      },
      cry: j.cries?.legacy || j.cries?.latest || null,
      learnset,
      versionGroup: group || 'none',
    };
  }

  static trimSpecies(j) {
    const en = list => list?.find(e => e.language.name === 'en');
    const flavor = (j.flavor_text_entries || []).filter(e => e.language.name === 'en').pop();
    return {
      id: j.id,
      name: j.name,
      displayName: en(j.names)?.name || Utils.pretty(j.name),
      captureRate: j.capture_rate ?? 45,
      growthRate: j.growth_rate?.name || 'medium',
      evolutionChainUrl: j.evolution_chain?.url || null,
      genus: en(j.genera)?.genus || 'Pokémon',
      flavor: flavor ? flavor.flavor_text.replace(/[\f\n\r]+/g, ' ') : '',
    };
  }

  static trimMove(j) {
    const meta = j.meta || {};
    const en = (j.names || []).find(n => n.language.name === 'en');
    const effect = (j.effect_entries || []).find(e => e.language.name === 'en');
    return {
      name: j.name,
      displayName: en?.name || Utils.pretty(j.name),
      type: j.type?.name || 'normal',
      power: j.power || 0,
      accuracy: j.accuracy ?? null,
      pp: j.pp || 10,
      priority: j.priority || 0,
      damageClass: j.damage_class?.name || 'physical',
      target: j.target?.name || 'selected-pokemon',
      ailment: meta.ailment?.name || 'none',
      ailmentChance: meta.ailment_chance || 0,
      category: meta.category?.name || '',
      critRate: meta.crit_rate || 0,
      drain: meta.drain || 0,
      healing: meta.healing || 0,
      flinchChance: meta.flinch_chance || 0,
      minHits: meta.min_hits || null,
      maxHits: meta.max_hits || null,
      statChance: meta.stat_chance || 0,
      statChanges: (j.stat_changes || []).map(s => ({ stat: s.stat.name, change: s.change })),
      effect: effect ? effect.short_effect.replace(/\$effect_chance/g, j.effect_chance ?? '') : '',
      effectChance: j.effect_chance ?? null,
    };
  }

  static trimEvolution(node) {
    return {
      name: node.species.name,
      id: Utils.idFromUrl(node.species.url),
      details: (node.evolution_details || []).map(d => ({
        trigger: d.trigger?.name,
        minLevel: d.min_level,
        // Anything beyond a plain level requirement (items, trades, friendship...) is unsupported.
        extra: !!(d.item || d.held_item || d.known_move || d.known_move_type || d.location || d.min_happiness ||
          d.min_beauty || d.min_affection || d.time_of_day || d.party_species || d.party_type || d.trade_species ||
          d.needs_overworld_rain || d.turn_upside_down || d.gender != null || d.relative_physical_stats != null),
      })),
      evolvesTo: (node.evolves_to || []).map(n => this.trimEvolution(n)),
    };
  }
}
