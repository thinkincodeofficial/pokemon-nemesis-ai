'use strict';

const ACTION_KINDS = ['attack', 'status', 'switch', 'heal', 'catch', 'run'];
const TRAINER_KINDS = ['attack', 'status', 'switch', 'heal'];
// Common-sense prior used before NEMESIS has seen any data.
const KIND_PRIOR = { attack: 0.55, status: 0.18, switch: 0.1, heal: 0.1, catch: 0.05, run: 0.02 };
const KIND_LABEL = { attack: 'Attack', status: 'Status move', switch: 'Switch', heal: 'Heal / cure', catch: 'Throw ball', run: 'Run' };
const KIND_VERB = { attack: 'attack', status: 'use a status move', switch: 'switch out', heal: 'use a healing item', catch: 'throw a ball', run: 'run away' };
const MATCHUP_LABEL = { A: 'you have the type edge', N: 'the matchup is even', D: 'you are at a type disadvantage' };

/**
 * NEMESIS's memory of the player. It learns:
 *  - an n-gram (Markov) model of the player's action sequence,
 *  - context habits: healing by HP bucket, switching by type matchup,
 *  - per-Pokémon move preferences and how often super-effective moves are chosen,
 *  - favourite leads,
 *  - a Q-table rating its OWN action kinds per battle state (reinforcement learning).
 * Everything persists in localStorage, so the AI keeps learning across sessions.
 */
class PatternLearner {
  constructor(storageKey) {
    this.key = storageKey;
    this.data = this.load();
    this.current = null;
    this.saveTimer = null;
  }

  static blank() {
    return {
      version: 1, created: Date.now(),
      battles: 0, trainerBattles: 0, aiWins: 0, aiLosses: 0, turns: 0,
      unigram: {}, bigram: {}, trigram: {},
      healByHp: [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0]],       // [healed, opportunities] per HP bucket
      switchByMatchup: { A: [0, 0], N: [0, 0], D: [0, 0] },     // [switched, opportunities]
      moveUsage: {},     // species -> move -> count
      typeUsage: {},     // move type -> count
      sePick: [0, 0],    // [picked super-effective, had one available]
      leads: {},         // species -> { n, types }
      switchTargets: {}, // species -> count
      predLog: [],       // { k: kind correct 0/1, m: move correct 0/1/null }
      battleLog: [],
      q: {},             // stateKey -> kind -> { v, n }
    };
  }

  load() {
    try {
      const raw = localStorage.getItem(this.key);
      if (raw) {
        const d = JSON.parse(raw);
        if (d.version === 1) return Object.assign(PatternLearner.blank(), d);
      }
    } catch { /* corrupted memory -> start fresh */ }
    return PatternLearner.blank();
  }

  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try { localStorage.setItem(this.key, JSON.stringify(this.data)); } catch (e) { console.warn('AI memory not saved', e); }
    }, 200);
  }

  reset() {
    this.data = PatternLearner.blank();
    try { localStorage.setItem(this.key, JSON.stringify(this.data)); } catch { /* ignore */ }
  }

  // Snapshot of the battle from the player's point of view, used for predicting and learning.
  buildContext(battle) {
    const p = battle.p, e = battle.e;
    const playerMoves = p.moves.map(m => ({
      name: m.name, label: m.displayName, type: m.type, power: m.power, pp: m.pp, damaging: m.isDamaging,
      eff: m.isDamaging ? TypeChart.effectiveness(m.type, e.types) : 1,
    }));
    const bestEff = (att, def) => Math.max(0, ...att.moves.filter(m => m.isDamaging).map(m => TypeChart.effectiveness(m.type, def.types)));
    const mine = bestEff(p, e), theirs = bestEff(e, p);
    const bag = battle.game.bag;
    return {
      battleType: battle.type,
      history: battle.history.slice(),
      allowed: battle.type === 'wild' ? ACTION_KINDS : TRAINER_KINDS,
      hpBucket: Utils.hpBucket(p.hpFrac),
      species: p.name,
      speciesLabel: p.displayName,
      playerMoves,
      matchup: theirs > mine ? 'D' : theirs < mine ? 'A' : 'N',
      hasBench: battle.playerParty.some((m, i) => i !== battle.pIdx && !m.fainted),
      hasHealItems: Object.keys(bag).some(k => bag[k] > 0 && ITEMS[k] && ITEMS[k].kind !== 'ball'),
      hasBalls: Object.keys(bag).some(k => bag[k] > 0 && ITEMS[k]?.kind === 'ball'),
    };
  }

  // Dirichlet-smoothed distribution: (count + strength * prior) / (total + strength).
  static smooth(counts, kinds, prior, strength) {
    counts = counts || {};
    const n = kinds.reduce((s, k) => s + (counts[k] || 0), 0);
    const out = {};
    for (const k of kinds) out[k] = ((counts[k] || 0) + strength * prior[k]) / (n + strength);
    return { dist: out, n };
  }

  // Predicts the player's next action kind and (if attacking) which move.
  predict(ctx) {
    const d = this.data;
    const K = ctx.allowed;
    const reasons = [];
    const prior = Utils.normalize(Object.fromEntries(K.map(k => [k, KIND_PRIOR[k]])));

    // Hierarchical n-gram: unigram -> bigram -> trigram, each smoothed toward the previous level.
    const prev1 = ctx.history[ctx.history.length - 1] || '^';
    const prev2 = ctx.history[ctx.history.length - 2] || '^';
    const uni = PatternLearner.smooth(d.unigram, K, prior, 3);
    const bi = PatternLearner.smooth(d.bigram[prev1], K, uni.dist, 2);
    const tri = PatternLearner.smooth(d.trigram[`${prev2}>${prev1}`], K, bi.dist, 2);
    const dist = { ...tri.dist };
    if (bi.n >= 3) {
      const top = Utils.argmax(bi.dist);
      reasons.push(`After ${prev1 === '^' ? 'a battle starts' : `"${KIND_LABEL[prev1]}"`} you chose "${KIND_LABEL[top]}" ${Utils.pct(bi.dist[top])} of the time (${bi.n} samples).`);
    }

    // Context experts override the Markov estimate for heal / switch / catch.
    const fixed = {};
    if (K.includes('heal')) {
      if (!ctx.hasHealItems) fixed.heal = 0;
      else {
        const [h, o] = d.healByHp[ctx.hpBucket];
        if (o > 0) {
          const w = o / (o + 3);
          fixed.heal = (1 - w) * dist.heal + w * (h / o);
          if (o >= 2) reasons.push(`At ${Utils.bucketLabel(ctx.hpBucket)} HP you healed ${h} of ${o} times.`);
        }
      }
    }
    if (K.includes('switch')) {
      if (!ctx.hasBench) fixed.switch = 0;
      else {
        const [s, o] = d.switchByMatchup[ctx.matchup];
        if (o > 0) {
          const w = o / (o + 3);
          fixed.switch = (1 - w) * dist.switch + w * (s / o);
          if (o >= 2 && s > 0) reasons.push(`When ${MATCHUP_LABEL[ctx.matchup]}, you switched ${s} of ${o} times.`);
        }
      }
    }
    if (K.includes('catch') && !ctx.hasBalls) fixed.catch = 0;

    let fixedSum = Object.values(fixed).reduce((a, b) => a + b, 0);
    if (fixedSum > 0.95) {
      for (const k in fixed) fixed[k] *= 0.95 / fixedSum;
      fixedSum = 0.95;
    }
    const rest = K.filter(k => !(k in fixed));
    const restSum = rest.reduce((s, k) => s + dist[k], 0);
    for (const k of rest) dist[k] = restSum > 0 ? (dist[k] / restSum) * (1 - fixedSum) : (1 - fixedSum) / rest.length;
    Object.assign(dist, fixed);

    const moves = this.moveDistribution(ctx.species, ctx.playerMoves);
    if (moves.reason) reasons.push(moves.reason);
    const [se, seN] = d.sePick;
    if (seN >= 3) reasons.push(`You pick a super-effective move ${Utils.pct(se / seN)} of the time when you have one.`);

    const top = Utils.argmax(dist);
    return {
      dist, top, confidence: dist[top],
      moveDist: moves.dist, topMove: Utils.argmax(moves.dist),
      reasons, samples: uni.n,
    };
  }

  // P(move | player attacks) from this species' history + a learned "super-effective bias".
  moveDistribution(species, playerMoves) {
    const usage = this.data.moveUsage[species] || {};
    const [se, seN] = this.data.sePick;
    const seRate = seN > 0 ? se / seN : 0.5;
    const weights = {};
    for (const m of playerMoves) {
      if (!m.damaging || m.pp <= 0) continue;
      let w = 1 + m.power / 80;
      if (m.eff > 1) w += 4 * seRate;
      if (m.eff < 1) w *= m.eff === 0 ? 0.05 : 0.5;
      w += (usage[m.name] || 0) * 1.5;
      weights[m.name] = w;
    }
    const dist = Object.keys(weights).length ? Utils.normalize(weights) : {};
    const total = Object.values(usage).reduce((a, b) => a + b, 0);
    let reason = null;
    if (total >= 3) {
      const fav = Utils.argmax(usage);
      const label = playerMoves.find(m => m.name === fav)?.label || Utils.pretty(fav);
      reason = `With ${Utils.pretty(species)} you used ${label} ${usage[fav]} of ${total} attacks.`;
    }
    return { dist, reason };
  }

  // Records what the player actually did. Returns which predictions were correct.
  observe(ctx, obs, pred) {
    const d = this.data;
    const k = obs.kind;
    const prev1 = ctx.history[ctx.history.length - 1] || '^';
    const prev2 = ctx.history[ctx.history.length - 2] || '^';
    const inc = (obj, key) => { obj[key] = (obj[key] || 0) + 1; };

    inc(d.unigram, k);
    inc(d.bigram[prev1] ||= {}, k);
    inc(d.trigram[`${prev2}>${prev1}`] ||= {}, k);

    if (ctx.allowed.includes('heal') && ctx.hasHealItems) {
      d.healByHp[ctx.hpBucket][1]++;
      if (k === 'heal') d.healByHp[ctx.hpBucket][0]++;
    }
    if (ctx.hasBench) {
      d.switchByMatchup[ctx.matchup][1]++;
      if (k === 'switch') d.switchByMatchup[ctx.matchup][0]++;
    }
    if (k === 'attack' && obs.move) {
      inc(d.moveUsage[ctx.species] ||= {}, obs.move);
      inc(d.typeUsage, obs.moveType);
      if (ctx.playerMoves.some(m => m.damaging && m.eff > 1 && m.pp > 0)) {
        d.sePick[1]++;
        if (obs.eff > 1) d.sePick[0]++;
      }
    }
    if (k === 'switch' && obs.target) inc(d.switchTargets, obs.target);

    const correct = {
      kind: pred.top === k,
      move: k === 'attack' && pred.topMove ? pred.topMove === obs.move : null,
    };
    d.predLog.push({ k: correct.kind ? 1 : 0, m: correct.move === null ? null : correct.move ? 1 : 0 });
    if (d.predLog.length > 400) d.predLog.splice(0, d.predLog.length - 400);
    d.turns++;
    if (this.current) {
      this.current.total++;
      if (correct.kind) this.current.correct++;
    }
    this.save();
    return correct;
  }

  startBattle(battle) {
    this.data.battles++;
    this.current = { type: battle.type, correct: 0, total: 0, trainer: battle.trainer?.name || 'Wild' };
    if (battle.type === 'trainer') {
      this.data.trainerBattles++;
      const lead = this.data.leads[battle.p.name] ||= { n: 0, types: battle.p.types, label: battle.p.displayName };
      lead.n++;
    }
    this.save();
  }

  endBattle(result, battle) {
    const d = this.data;
    if (battle.type === 'trainer') {
      if (result === 'lose') d.aiWins++;
      if (result === 'win') d.aiLosses++;
    }
    const c = this.current || { correct: 0, total: 0 };
    d.battleLog.push({
      t: Date.now(), type: battle.type, trainer: c.trainer, result, turns: battle.turn,
      acc: c.total ? c.correct / c.total : null,
    });
    if (d.battleLog.length > 60) d.battleLog.shift();
    this.current = null;
    this.save();
  }

  getQ(state, kind) {
    return this.data.q[state]?.[kind]?.v ?? 0;
  }

  // Incremental-mean Q update (learning rate decays per state/action, floor 0.15).
  updateQ(state, kind, reward) {
    const row = this.data.q[state] ||= {};
    const cell = row[kind] ||= { v: 0, n: 0 };
    cell.n++;
    const alpha = Math.max(0.15, 1 / cell.n);
    cell.v += alpha * (reward - cell.v);
    this.save();
    return cell.v;
  }

  favouriteLead() {
    let best = null;
    for (const [name, l] of Object.entries(this.data.leads)) if (!best || l.n > best.n) best = { name, ...l };
    return best;
  }

  stats() {
    const d = this.data;
    const recent = d.predLog.slice(-30);
    const moves = d.predLog.filter(e => e.m !== null).slice(-30);
    const avg = arr => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null);
    return {
      battles: d.battles, turns: d.turns, aiWins: d.aiWins, aiLosses: d.aiLosses,
      kindAcc: avg(recent.map(e => e.k)), moveAcc: avg(moves.map(e => e.m)),
      qStates: Object.keys(d.q).length,
    };
  }

  // Rolling accuracy series for the chart.
  accuracySeries(win = 10, maxPoints = 120) {
    const log = this.data.predLog.slice(-maxPoints - win);
    const kind = [], move = [];
    for (let i = 0; i < log.length; i++) {
      const slice = log.slice(Math.max(0, i - win + 1), i + 1);
      kind.push(slice.reduce((s, e) => s + e.k, 0) / slice.length);
      const ms = slice.filter(e => e.m !== null);
      move.push(ms.length ? ms.reduce((s, e) => s + e.m, 0) / ms.length : null);
    }
    return { kind: kind.slice(-maxPoints), move: move.slice(-maxPoints) };
  }

  topMoves(n = 6) {
    const rows = [];
    for (const [species, moves] of Object.entries(this.data.moveUsage)) {
      for (const [move, count] of Object.entries(moves)) rows.push({ species, move, count });
    }
    return rows.sort((a, b) => b.count - a.count).slice(0, n);
  }
}
