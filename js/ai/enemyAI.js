'use strict';

// How strongly each opponent tier trusts NEMESIS's predictions and its learned Q-values.
//  temp:       softmax temperature (lower = greedier, more "decisive")
//  predWeight: 0 = ignore predictions, 1 = fully trust them
//  qWeight:    score points added per unit of learned Q-value
const AI_PROFILES = {
  wild:    { temp: 30, predWeight: 0,    qWeight: 0,  think: 0,   label: 'Wild instincts' },
  trainer: { temp: 14, predWeight: 0.55, qWeight: 15, think: 400, label: 'Trainer AI' },
  rival:   { temp: 9,  predWeight: 0.8,  qWeight: 25, think: 550, label: 'Rival AI' },
  boss:    { temp: 5,  predWeight: 1.0,  qWeight: 35, think: 750, label: 'NEMESIS core' },
};
const NEUTRAL_PRED = { attack: 0.6, status: 0.2, switch: 0.1, heal: 0.1 };
const AILMENT_VALUE = { sleep: 48, paralysis: 40, burn: 30, poison: 28, freeze: 30, confusion: 22 };

const AI_QUIPS = {
  boss: ['Predictable.', 'I saw that coming.', 'Pattern confirmed.', 'You always do that.', 'Calculated.', 'My model expected this.'],
  rival: ['Ha! Knew you would do that!', 'Same trick again?', 'I can read you like a book!'],
  trainer: ['Hah, called it!', 'I knew it!'],
};

/**
 * The enemy brain. Each turn it:
 *  1. takes NEMESIS's prediction of the player's next action/move,
 *  2. scores every option it has (each move, each switch, potions) using expected damage,
 *     KO chances, incoming-damage risk and the predicted player behaviour,
 *  3. adds a bias from the Q-table (what worked before in this situation),
 *  4. picks via softmax, and returns its full reasoning for the visualisation panel.
 * It never sees the player's actual choice for the turn.
 */
class EnemyAI {
  constructor(learner, { difficulty = 'trainer', name = 'Trainer' } = {}) {
    this.learner = learner;
    this.difficulty = difficulty;
    this.name = name;
    this.profile = AI_PROFILES[difficulty] || AI_PROFILES.trainer;
  }

  get thinkTime() { return this.profile.think; }

  static bestEff(att, def) {
    return Math.max(0, ...att.moves.filter(m => m.isDamaging).map(m => TypeChart.effectiveness(m.type, def.types)));
  }

  // A = AI has the type edge, D = AI is at a disadvantage, N = even.
  static matchup(me, foe) {
    const a = EnemyAI.bestEff(me, foe), b = EnemyAI.bestEff(foe, me);
    return a > b ? 'A' : a < b ? 'D' : 'N';
  }

  static stateKey(me, foe) {
    return `${Utils.hpBucket(me.hpFrac)}${Utils.hpBucket(foe.hpFrac)}${EnemyAI.matchup(me, foe)}`;
  }

  static describeState(key) {
    const [mine, theirs, m] = key;
    return `me ${Utils.bucketLabel(+mine)} · you ${Utils.bucketLabel(+theirs)} · ${{ A: 'my edge', N: 'even', D: 'your edge' }[m]}`;
  }

  // Best expected fraction of the defender's current HP that `att` can remove this turn.
  static bestOffense(att, def) {
    let best = 0;
    for (const m of att.moves) {
      if (!m.isDamaging || m.pp <= 0) continue;
      best = Math.max(best, Battle.expectedDamage(att, def, m) / Math.max(1, def.hp));
    }
    return Math.min(1, best);
  }

  // Mixes the learner's prediction with a neutral prior according to predWeight.
  blend(prediction, foe) {
    const w = this.profile.predWeight;
    const dist = {};
    for (const k of TRAINER_KINDS) {
      dist[k] = prediction.dist[k] === 0 ? 0 : w * (prediction.dist[k] || 0) + (1 - w) * NEUTRAL_PRED[k];
    }
    const dmg = foe.moves.filter(m => m.isDamaging && m.pp > 0);
    const moveDist = {};
    for (const m of dmg) moveDist[m.name] = w * (prediction.moveDist[m.name] || 0) + (1 - w) / dmg.length;
    return { dist: Utils.normalize(dist), moveDist: dmg.length ? Utils.normalize(moveDist) : {} };
  }

  // Expected fraction of `target`'s current HP the foe's predicted attack removes (can exceed 1).
  incomingFrac(target, foe, moveDist) {
    let expected = 0, total = 0;
    for (const m of foe.moves) {
      const p = moveDist[m.name];
      if (!m.isDamaging || m.pp <= 0 || p === undefined) continue;
      expected += p * Battle.expectedDamage(foe, target, m);
      total += p;
    }
    if (total === 0) return 0;
    return Math.min(1.5, expected / total / Math.max(1, target.hp));
  }

  decide(battle, prediction) {
    if (this.difficulty === 'wild') return this.decideWild(battle);
    const me = battle.e, foe = battle.p;
    const pred = this.blend(prediction, foe);
    const riskNow = this.incomingFrac(me, foe, pred.moveDist);
    const s = {
      pSw: pred.dist.switch, pHeal: pred.dist.heal, pAtk: pred.dist.attack,
      free: pred.dist.switch + pred.dist.heal + pred.dist.status * 0.5, // chance the foe won't hit me
      riskNow,
      faster: me.effectiveSpeed() >= foe.effectiveSpeed(),
    };

    const cands = [];
    const usable = me.moves.filter(m => m.pp > 0);
    for (const m of usable) cands.push(this.scoreMove(m, me, foe, s));
    if (!usable.length) {
      cands.push({ kind: 'attack', label: 'Struggle', type: 'typeless', action: { kind: 'move', move: Move.struggle() }, score: 10, parts: ['out of PP'] });
    }
    battle.enemyParty.forEach((b, i) => {
      if (i !== battle.eIdx && !b.fainted) cands.push(this.scoreSwitch(b, i, me, foe, pred, s));
    });
    for (const key of ['super-potion', 'potion']) {
      if ((battle.enemyItems[key] || 0) > 0 && me.hpFrac < 0.6) {
        cands.push(this.scoreHeal(key, me, s));
        break;
      }
    }

    // Reinforcement-learning bias: what has worked for NEMESIS in this situation before.
    const stateKey = EnemyAI.stateKey(me, foe);
    for (const c of cands) {
      c.q = this.learner.getQ(stateKey, c.kind);
      c.base = c.score;
      c.score += c.q * this.profile.qWeight;
    }

    const probs = Utils.softmax(cands.map(c => c.score), this.profile.temp);
    cands.forEach((c, i) => { c.prob = probs[i]; });
    const chosen = cands[Utils.weightedIndex(probs)];
    return {
      action: chosen.action, kind: chosen.kind, stateKey, chosen,
      candidates: cands.slice().sort((a, b) => b.score - a.score),
      reasons: this.explain(prediction, pred, chosen, riskNow, foe),
      blended: pred, profile: this.profile,
    };
  }

  scoreMove(m, me, foe, s) {
    const c = { kind: m.isDamaging ? 'attack' : 'status', label: m.displayName, type: m.type, action: { kind: 'move', move: m }, parts: [] };
    let score = 0;
    if (m.isDamaging) {
      const eff = TypeChart.effectiveness(m.type, foe.types);
      const dmg = Battle.expectedDamage(me, foe, m);
      const frac = Math.min(1, dmg / Math.max(1, foe.hp));
      score = frac * 100;
      c.parts.push(`~${Math.round(frac * 100)}% of your HP`);
      if (dmg >= foe.hp) {
        score += s.faster || m.priority > 0 ? 55 : 35;
        c.parts.push('likely KO');
      }
      if (eff > 1) c.parts.push('super effective');
      if (eff === 0) score = 0;
      // If you're predicted to switch, damage on the current target is less reliable.
      score *= 1 - 0.45 * s.pSw;
      // If you're predicted to heal, keep up the pressure.
      if (s.pHeal > 0.25) { score += 15 * s.pHeal; c.parts.push('punish heal'); }
      if (m.priority > 0 && !s.faster && dmg >= foe.hp) score += 15;
      if (m.drain < 0) score -= (Math.abs(m.drain) / 100) * (dmg / Math.max(1, me.hp)) * 40;
      if (m.drain > 0 && me.hpFrac < 0.7) score += 8;
    } else {
      if (SUPPORTED_AILMENTS.includes(m.ailment)) {
        const blocked = m.ailment === 'confusion' ? foe.volatile.confusion > 0 : !!foe.status || Battle.immuneTo(foe, m.ailment);
        if (!blocked) {
          score = Math.max(score, AILMENT_VALUE[m.ailment] * ((m.accuracy || 100) / 100) * foe.hpFrac);
          c.parts.push(m.ailment);
        } else c.parts.push('already statused');
      }
      if (m.statChanges.length) {
        const self = Battle.statTargetsSelf(m);
        const total = m.statChanges.reduce((sum, sc) => sum + sc.change, 0);
        if (self && total > 0) {
          const stage = Math.max(...m.statChanges.map(sc => me.stages[sc.stat] || 0));
          score += total * 14 * me.hpFrac * (1 - Math.min(1, s.riskNow)) * (stage >= 2 ? 0.25 : 1);
          c.parts.push('boost');
        } else if (!self && total < 0) {
          const stage = Math.min(...m.statChanges.map(sc => foe.stages[sc.stat] || 0));
          score += -total * 9 * foe.hpFrac * (stage <= -2 ? 0.25 : 1);
          c.parts.push('debuff');
        }
      }
      if (m.healing > 0) {
        score += (1 - me.hpFrac) * 95 * (s.riskNow < 0.9 ? 1 : 0.4);
        c.parts.push('recover');
      }
      // A predicted "free" turn (you switch or heal) is the perfect moment for set-up.
      if (score > 0 && s.free > 0.2) { score += 30 * s.free; c.parts.push('free turn'); }
    }
    c.score = score;
    return c;
  }

  scoreSwitch(b, i, me, foe, pred, s) {
    const riskB = this.incomingFrac(b, foe, pred.moveDist);
    const offB = EnemyAI.bestOffense(b, foe), offNow = EnemyAI.bestOffense(me, foe);
    let score = (s.riskNow - riskB) * 60 * (pred.dist.attack + 0.2) + (offB - offNow) * 45 - 20;
    const parts = [`takes ~${Math.round(Math.min(1, riskB) * 100)}% vs ${Math.round(Math.min(1, s.riskNow) * 100)}%`];
    if (s.riskNow >= 1 && !s.faster) { score += 25; parts.push('avoid KO'); }
    if (b.hpFrac < 0.35) score -= 25;
    return { kind: 'switch', label: `Switch to ${b.displayName}`, action: { kind: 'switch', index: i }, score, parts };
  }

  scoreHeal(key, me, s) {
    const amount = Math.min(ITEMS[key].amount, me.maxHp - me.hp);
    let score = (amount / me.maxHp) * 120 * (1 - me.hpFrac);
    const parts = [`+${amount} HP`];
    if (s.riskNow * me.hp >= me.hp + amount) { score *= 0.3; parts.push('would still faint'); }
    return { kind: 'heal', label: `Use ${ITEMS[key].name}`, action: { kind: 'item', item: key }, score, parts };
  }

  // Wild Pokémon pick moves on instinct (lightly favouring damage).
  decideWild(battle) {
    const me = battle.e, foe = battle.p;
    const usable = me.moves.filter(m => m.pp > 0);
    const cands = usable.map(m => {
      const frac = m.isDamaging ? Math.min(1, Battle.expectedDamage(me, foe, m) / Math.max(1, foe.hp)) : 0;
      return {
        kind: m.isDamaging ? 'attack' : 'status', label: m.displayName, type: m.type, action: { kind: 'move', move: m },
        score: m.isDamaging ? 20 + frac * 40 : 18, parts: [m.isDamaging ? `~${Math.round(frac * 100)}% dmg` : 'status'], q: 0,
      };
    });
    if (!cands.length) cands.push({ kind: 'attack', label: 'Struggle', type: 'typeless', action: { kind: 'move', move: Move.struggle() }, score: 10, parts: [], q: 0 });
    const probs = Utils.softmax(cands.map(c => c.score), this.profile.temp);
    cands.forEach((c, i) => { c.prob = probs[i]; });
    const chosen = cands[Utils.weightedIndex(probs)];
    return {
      action: chosen.action, kind: chosen.kind, stateKey: null, chosen,
      candidates: cands.slice().sort((a, b) => b.score - a.score),
      reasons: ['Wild Pokémon act on instinct.', 'NEMESIS is still watching and recording your choices.'],
      profile: this.profile,
    };
  }

  explain(prediction, pred, chosen, riskNow, foe) {
    const r = [];
    const top = Utils.argmax(pred.dist);
    r.push(`I predict you will ${KIND_VERB[top]} (${Utils.pct(pred.dist[top])}).`);
    const topMove = Utils.argmax(pred.moveDist);
    if (topMove) {
      const mv = foe.moves.find(m => m.name === topMove);
      r.push(`Most likely attack: ${mv ? mv.displayName : topMove}, about ${Utils.pct(Math.min(1, riskNow))} of my HP.`);
    }
    for (const line of prediction.reasons.slice(0, 3)) r.push(line);
    r.push(`Decision: ${chosen.label}${chosen.parts.length ? ` (${chosen.parts.join(', ')})` : ''}.`);
    if (Math.abs(chosen.q || 0) > 0.05) {
      r.push(`Experience says "${chosen.kind}" here is ${chosen.q > 0 ? 'rewarding' : 'risky'} (Q ${chosen.q.toFixed(2)}).`);
    }
    return r;
  }

  // Picks the best Pokémon to send in after one faints.
  chooseReplacement(battle) {
    const foe = battle.p;
    const playerMoves = foe.moves.map(m => ({ name: m.name, label: m.displayName, type: m.type, power: m.power, pp: m.pp, damaging: m.isDamaging, eff: 1 }));
    let best = -1, bestScore = -Infinity, bestMon = null;
    battle.enemyParty.forEach((b, i) => {
      if (b.fainted) return;
      // Re-evaluate the player's likely move against this candidate.
      for (const pm of playerMoves) pm.eff = pm.damaging ? TypeChart.effectiveness(pm.type, b.types) : 1;
      const md = this.learner.moveDistribution(foe.name, playerMoves).dist;
      const score = EnemyAI.bestOffense(b, foe) * 60 - Math.min(1.5, this.incomingFrac(b, foe, md)) * 50 + b.hpFrac * 15 +
        (b.effectiveSpeed() >= foe.effectiveSpeed() ? 10 : 0);
      if (score > bestScore) { bestScore = score; best = i; bestMon = b; }
    });
    return { index: best, reason: `Sending ${bestMon?.displayName}: best matchup score (${bestScore.toFixed(0)}) against your ${foe.displayName}.` };
  }

  quip(correct, obs, prediction) {
    const lines = AI_QUIPS[this.difficulty];
    if (!lines || !correct.kind || prediction.confidence < 0.4) return null;
    if (obs.kind === 'attack' && !correct.move) return null;
    const odds = { boss: 0.45, rival: 0.3, trainer: 0.15 }[this.difficulty] || 0;
    return Utils.chance(odds) ? Utils.choice(lines) : null;
  }
}
