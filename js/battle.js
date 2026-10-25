'use strict';

const AILMENT_TEXT = {
  paralysis: 'is paralyzed! It may be unable to move!',
  sleep: 'fell asleep!',
  freeze: 'was frozen solid!',
  burn: 'was burned!',
  poison: 'was poisoned!',
};

/**
 * Turn-based battle engine. One instance per battle.
 * Flow per turn: NEMESIS predicts -> player chooses -> AI decides (blind to the choice)
 * -> NEMESIS learns from the real choice -> actions resolve in priority/speed order
 * -> faint handling, EXP, end-of-turn status damage -> the AI's own choice is rewarded (Q-learning).
 */
class Battle {
  static CONFUSION_HIT = { name: 'confusion-hit', type: 'typeless', power: 40, damageClass: 'physical', critRate: 0, isDamaging: true };

  constructor(game, { type, enemyParty, trainer = null, bg = 'field' }) {
    this.game = game;
    this.ui = game.ui;
    this.scene = game.scene;
    this.brain = game.brain;
    this.learner = game.learner;
    this.sfx = game.sfx;

    this.type = type;            // 'wild' | 'trainer'
    this.trainer = trainer;      // { name, difficulty, items, reward, loseLine, winLine, leadReason }
    this.bg = bg;
    this.playerParty = game.party;
    this.enemyParty = enemyParty;
    this.pIdx = Math.max(0, this.playerParty.findIndex(m => !m.fainted));
    this.eIdx = 0;
    this.ai = new EnemyAI(this.learner, { difficulty: trainer ? trainer.difficulty : 'wild', name: trainer ? trainer.name : 'Wild' });
    this.enemyItems = { ...(trainer?.items || {}) };

    this.turn = 0;
    this.history = [];           // player's action kinds this battle (n-gram context)
    this.over = false;
    this.result = null;          // 'win' | 'lose' | 'run' | 'caught'
    this.participants = new Set();
    this.leveled = new Set();
    this.downed = new Set();
    this.runAttempts = 0;
  }

  get p() { return this.playerParty[this.pIdx]; }
  get e() { return this.enemyParty[this.eIdx]; }
  mon(side) { return side === 'player' ? this.p : this.e; }
  other(side) { return side === 'player' ? 'enemy' : 'player'; }

  label(side) {
    if (side === 'player') return this.p.displayName;
    return this.type === 'wild' ? `Wild ${this.e.displayName}` : `Foe ${this.e.displayName}`;
  }

  say(text) {
    return this.ui.say(text, { auto: true });
  }

  // ------------------------------------------------------------------ main loop

  async start() {
    this.learner.startBattle(this);
    this.brain.battleStart(this);
    this.ui.setBattleMode(true);
    this.ui.lastBattleChoice = 0;
    await this.scene.setup(this);
    this.participants.add(this.p.uid);

    if (this.type === 'wild') {
      await this.scene.intro({ showEnemy: true });
      this.sfx.cry(this.e.data.cry);
      await this.say(`A wild ${this.e.displayName} appeared!`);
    } else {
      await this.scene.intro({ showEnemy: false });
      await this.say(`${this.trainer.name} wants to battle!`);
      await this.say(`${this.trainer.name} sent out ${this.e.displayName}!`);
      await this.scene.sendOut('enemy', this.e);
      if (this.trainer.leadReason) this.brain.note(this.trainer.leadReason);
    }
    await this.say(`Go! ${this.p.displayName}!`);
    await this.scene.sendOut('player', this.p);

    while (!this.over) await this.playTurn();
    await this.finish();
    return this.result;
  }

  async playTurn() {
    this.turn++;
    const ctx = this.learner.buildContext(this);
    const prediction = this.learner.predict(ctx);
    this.brain.showPrediction(prediction, ctx, this);

    const pAction = await this.choosePlayerAction();

    // The AI decides from its prediction only. It never peeks at pAction.
    this.brain.showThinking(this.ai);
    const decision = this.ai.decide(this, prediction);
    if (this.ai.thinkTime) await Utils.sleep(this.ai.thinkTime);
    this.brain.showDecision(decision, this);

    const obs = this.observation(pAction);
    const correct = this.learner.observe(ctx, obs, prediction);
    this.history.push(obs.kind);
    this.brain.showOutcome(obs, prediction, correct);

    const line = this.ai.quip(correct, obs, prediction);
    if (line && this.trainer) await this.say(`${this.trainer.name}: "${line}"`);

    const before = this.teamHp();
    await this.resolveTurn(pAction, decision.action);
    if (decision.stateKey) {
      const after = this.teamHp();
      // + when the player's team lost more HP than NEMESIS's team did.
      decision.reward = Utils.clamp((before.p - after.p) - (before.e - after.e), -1, 1);
      decision.newQ = this.learner.updateQ(decision.stateKey, decision.kind, decision.reward);
      this.brain.showReward(decision);
    }
    this.brain.refreshStats();
  }

  async choosePlayerAction() {
    for (;;) {
      this.ui.sayStatic(`What will ${this.p.displayName} do?`);
      const choice = await this.ui.battleMenu(this.type === 'wild');
      if (choice === 0) {
        if (this.p.moves.every(m => m.pp <= 0)) {
          await this.say(`${this.p.displayName} has no moves left!`);
          return { kind: 'move', move: Move.struggle() };
        }
        const i = await this.ui.moveMenu(this.p, this.e);
        if (i < 0) continue;
        return { kind: 'move', move: this.p.moves[i] };
      }
      if (choice === 1) {
        const item = await this.ui.bagMenu(this.game.bag);
        if (!item) continue;
        const def = ITEMS[item];
        if (def.kind === 'ball') {
          if (this.type === 'trainer') { await this.say("You can't catch another trainer's Pokémon!"); continue; }
          return { kind: 'item', item };
        }
        const target = await this.ui.partyMenu(this.playerParty, { title: `Use ${def.name} on which Pokémon?` });
        if (target < 0) continue;
        const mon = this.playerParty[target];
        if (mon.fainted || (def.kind === 'heal' && mon.hp >= mon.maxHp) || (def.kind === 'cure' && !mon.status && !mon.volatile.confusion)) {
          await this.say("It won't have any effect.");
          continue;
        }
        return { kind: 'item', item, target };
      }
      if (choice === 2) {
        const i = await this.ui.partyMenu(this.playerParty, { title: 'Switch to which Pokémon?' });
        if (i < 0) continue;
        if (i === this.pIdx) { await this.say(`${this.p.displayName} is already in battle!`); continue; }
        if (this.playerParty[i].fainted) { await this.say(`${this.playerParty[i].displayName} has no energy left to battle!`); continue; }
        return { kind: 'switch', index: i };
      }
      if (choice === 3) {
        if (this.type === 'trainer') { await this.say("No! There's no running from a trainer battle!"); continue; }
        return { kind: 'run' };
      }
    }
  }

  // Converts a player action into what NEMESIS records.
  observation(a) {
    if (a.kind === 'move') {
      return {
        kind: a.move.isDamaging ? 'attack' : 'status', move: a.move.name, moveLabel: a.move.displayName, moveType: a.move.type,
        eff: a.move.isDamaging ? TypeChart.effectiveness(a.move.type, this.e.types) : null,
      };
    }
    if (a.kind === 'switch') return { kind: 'switch', target: this.playerParty[a.index].name, targetLabel: this.playerParty[a.index].displayName };
    if (a.kind === 'item') return { kind: ITEMS[a.item].kind === 'ball' ? 'catch' : 'heal', item: a.item };
    return { kind: 'run' };
  }

  teamHp() {
    const sum = party => party.reduce((s, m) => s + m.hp / m.maxHp, 0);
    return { p: sum(this.playerParty), e: sum(this.enemyParty) };
  }

  // Switches, items and running go first; then moves by priority, then speed.
  turnOrder(pA, eA) {
    const pri = a => (a.kind === 'move' ? a.move.priority : 6);
    const pp = pri(pA), ep = pri(eA);
    if (pp !== ep) return pp > ep ? ['player', 'enemy'] : ['enemy', 'player'];
    if (pp === 6) return ['player', 'enemy'];
    const ps = this.p.effectiveSpeed(), es = this.e.effectiveSpeed();
    if (ps !== es) return ps > es ? ['player', 'enemy'] : ['enemy', 'player'];
    return Utils.chance(0.5) ? ['player', 'enemy'] : ['enemy', 'player'];
  }

  async resolveTurn(pA, eA) {
    const acts = { player: pA, enemy: eA };
    const startUid = { player: this.p.uid, enemy: this.e.uid };
    let first = true;
    for (const side of this.turnOrder(pA, eA)) {
      if (this.over) break;
      const mon = this.mon(side);
      const act = acts[side];
      // A Pokémon that fainted or was replaced this turn doesn't get to use its move.
      if (act.kind === 'move' && (mon.uid !== startUid[side] || mon.fainted)) { first = false; continue; }
      await this.execute(side, act, first);
      first = false;
      await this.checkFaints();
    }
    if (!this.over) {
      await this.endOfTurn();
      await this.checkFaints();
    }
    this.p.volatile.flinch = false;
    this.e.volatile.flinch = false;
  }

  execute(side, action, isFirst) {
    switch (action.kind) {
      case 'move': return this.useMove(side, action.move, isFirst);
      case 'switch': return this.switchIn(side, action.index);
      case 'item': return side === 'player' ? this.usePlayerItem(action) : this.useEnemyItem(action);
      case 'run': return this.tryRun();
      default: return Promise.resolve();
    }
  }

  // ------------------------------------------------------------------ moves

  static isSelfTargeting(move) {
    return ['user', 'users-field', 'user-and-allies', 'user-or-ally', 'ally'].includes(move.target);
  }

  static statTargetsSelf(move) {
    return Battle.isSelfTargeting(move) || move.category === 'damage+raise';
  }

  static immuneTo(mon, ailment) {
    const t = mon.types;
    if (ailment === 'burn') return t.includes('fire');
    if (ailment === 'poison') return t.includes('poison') || t.includes('steel');
    if (ailment === 'paralysis') return t.includes('electric');
    if (ailment === 'freeze') return t.includes('ice');
    return false;
  }

  // Main-series damage formula. `expected` gives the average (no randomness) for the AI.
  static calcDamage(atk, def, move, { expected = false, noCrit = false } = {}) {
    const physical = move.damageClass === 'physical';
    const aKey = physical ? 'attack' : 'special-attack';
    const dKey = physical ? 'defense' : 'special-defense';
    const critP = [1 / 24, 1 / 8, 1 / 2, 1][Math.min(3, move.critRate || 0)];
    const crit = !expected && !noCrit && Math.random() < critP;
    // Crits ignore the attacker's drops and the defender's boosts.
    const aStage = crit ? Math.max(0, atk.stages[aKey]) : atk.stages[aKey];
    const dStage = crit ? Math.min(0, def.stages[dKey]) : def.stages[dKey];
    const A = atk.stats[aKey] * Utils.stageMultiplier(aStage);
    const D = Math.max(1, def.stats[dKey] * Utils.stageMultiplier(dStage));
    const base = Math.floor(Math.floor((Math.floor((2 * atk.level) / 5 + 2) * move.power * A) / D) / 50) + 2;
    const stab = atk.types.includes(move.type) ? 1.5 : 1;
    const eff = TypeChart.effectiveness(move.type, def.types);
    const burn = physical && atk.status === 'burn' ? 0.5 : 1;
    const rnd = expected ? 0.925 : Utils.rand(0.85, 1);
    const critMult = expected ? 1 + 0.5 * critP : crit ? 1.5 : 1;
    const damage = eff === 0 ? 0 : Math.max(1, Math.floor(base * stab * eff * burn * rnd * critMult));
    return { damage, crit, eff, stab: stab > 1 };
  }

  // Average damage including accuracy and multi-hit. Used by the AI to plan.
  static expectedDamage(atk, def, move) {
    if (!move.isDamaging) return 0;
    const r = Battle.calcDamage(atk, def, move, { expected: true });
    const hits = move.maxHits ? ((move.minHits || 2) + move.maxHits) / 2 : 1;
    const acc = move.accuracy ? (move.accuracy / 100) * Utils.accuracyMultiplier(atk.stages.accuracy - def.stages.evasion) : 1;
    return r.damage * hits * Math.min(1, acc);
  }

  async useMove(side, move, isFirst) {
    const atk = this.mon(side), defSide = this.other(side), def = this.mon(defSide);
    const name = this.label(side);

    if (atk.status === 'sleep') {
      if (atk.sleepTurns > 0) {
        atk.sleepTurns--;
        await this.scene.statusFx(side, 'ailment');
        await this.say(`${name} is fast asleep.`);
        return;
      }
      atk.status = null;
      await this.say(`${name} woke up!`);
    }
    if (atk.status === 'freeze') {
      if (Utils.chance(0.2) || move.type === 'fire') {
        atk.status = null;
        await this.say(`${name} thawed out!`);
      } else {
        await this.say(`${name} is frozen solid!`);
        return;
      }
    }
    if (atk.volatile.flinch) {
      atk.volatile.flinch = false;
      await this.say(`${name} flinched and couldn't move!`);
      return;
    }
    if (atk.status === 'paralysis' && Utils.chance(0.25)) {
      await this.scene.statusFx(side, 'ailment');
      await this.say(`${name} is paralyzed! It can't move!`);
      return;
    }
    if (atk.volatile.confusion > 0) {
      atk.volatile.confusion--;
      if (atk.volatile.confusion === 0) await this.say(`${name} snapped out of its confusion!`);
      else {
        await this.say(`${name} is confused!`);
        if (Utils.chance(1 / 3)) {
          const dmg = Battle.calcDamage(atk, atk, Battle.CONFUSION_HIT, { noCrit: true }).damage;
          atk.hp = Math.max(0, atk.hp - dmg);
          this.sfx.play('hit');
          await this.scene.hit(side, 1);
          await this.scene.hp(side);
          await this.say('It hurt itself in its confusion!');
          return;
        }
      }
    }

    if (move.name !== 'struggle') move.pp = Math.max(0, move.pp - 1);
    await this.say(`${name} used ${move.displayName}!`);

    const selfTarget = !move.isDamaging && Battle.isSelfTargeting(move);
    if (!selfTarget && move.accuracy != null) {
      const acc = (move.accuracy / 100) * Utils.accuracyMultiplier(atk.stages.accuracy - def.stages.evasion);
      if (!Utils.chance(acc)) {
        await this.say(`${name}'s attack missed!`);
        return;
      }
    }
    if (move.isDamaging) await this.doDamage(side, move, isFirst);
    else await this.doStatusMove(side, move);
  }

  async doDamage(side, move, isFirst) {
    const atk = this.mon(side), defSide = this.other(side), def = this.mon(defSide);
    const eff = TypeChart.effectiveness(move.type, def.types);
    if (eff === 0) {
      await this.say(`It doesn't affect ${this.label(defSide)}...`);
      return;
    }
    await this.scene.attack(side, move);
    const hits = move.maxHits ? Utils.randInt(move.minHits || 2, move.maxHits) : 1;
    let total = 0, landed = 0;
    for (let i = 0; i < hits && !def.fainted; i++) {
      const r = Battle.calcDamage(atk, def, move);
      const dmg = Math.min(def.hp, r.damage);
      def.hp -= dmg;
      total += dmg;
      landed++;
      this.sfx.play(eff > 1 ? 'super' : eff < 1 ? 'weak' : 'hit');
      await this.scene.hit(defSide, eff);
      await this.scene.hp(defSide);
      if (r.crit) await this.say('A critical hit!');
    }
    if (hits > 1) await this.say(`Hit ${landed} time${landed > 1 ? 's' : ''}!`);
    if (eff > 1) await this.say("It's super effective!");
    else if (eff < 1) await this.say("It's not very effective...");

    if (move.drain > 0 && total > 0 && !atk.fainted) {
      const healed = atk.heal(Math.max(1, Math.floor((total * move.drain) / 100)));
      if (healed > 0) {
        await this.scene.hp(side);
        await this.say(`${this.label(defSide)} had its energy drained!`);
      }
    } else if (move.drain < 0 && total > 0) {
      atk.hp = Math.max(0, atk.hp - Math.max(1, Math.floor((total * -move.drain) / 100)));
      await this.scene.hp(side);
      await this.say(`${this.label(side)} is damaged by recoil!`);
    }

    if (!def.fainted) {
      if (SUPPORTED_AILMENTS.includes(move.ailment) && move.ailmentChance > 0 && Utils.chance(move.ailmentChance / 100)) {
        await this.applyAilment(defSide, move.ailment);
      }
      if (isFirst && move.flinchChance > 0 && Utils.chance(move.flinchChance / 100)) def.volatile.flinch = true;
    }
    if (move.statChanges.length && (!move.statChance || Utils.chance(move.statChance / 100))) {
      const target = Battle.statTargetsSelf(move) ? side : defSide;
      if (!this.mon(target).fainted) await this.applyStatChanges(target, move.statChanges);
    }
  }

  async doStatusMove(side, move) {
    const atk = this.mon(side), defSide = this.other(side), def = this.mon(defSide);
    await this.scene.statusFx(Battle.isSelfTargeting(move) ? side : defSide, 'cast');
    let acted = false;
    if (move.healing > 0) {
      const healed = atk.heal(Math.floor((atk.maxHp * move.healing) / 100));
      if (healed > 0) {
        this.sfx.play('heal');
        await this.scene.statusFx(side, 'heal');
        await this.scene.hp(side);
        await this.say(`${this.label(side)} regained health!`);
      } else await this.say(`${this.label(side)}'s HP is already full!`);
      acted = true;
    }
    if (move.statChanges.length) {
      await this.applyStatChanges(Battle.statTargetsSelf(move) ? side : defSide, move.statChanges);
      acted = true;
    }
    if (SUPPORTED_AILMENTS.includes(move.ailment)) {
      if (move.type === 'electric' && def.types.includes('ground')) await this.say(`It doesn't affect ${this.label(defSide)}...`);
      else await this.applyAilment(defSide, move.ailment, true);
      acted = true;
    }
    if (!acted) await this.say('But nothing happened!');
  }

  async applyStatChanges(side, changes) {
    const mon = this.mon(side);
    let any = false;
    for (const { stat, change } of changes) {
      if (!(stat in mon.stages)) continue;
      const before = mon.stages[stat];
      mon.stages[stat] = Utils.clamp(before + change, -6, 6);
      const who = `${this.label(side)}'s ${STAT_LABEL[stat] || Utils.pretty(stat)}`;
      if (mon.stages[stat] === before) {
        await this.say(`${who} won't go any ${change > 0 ? 'higher' : 'lower'}!`);
        continue;
      }
      any = true;
      this.sfx.play(change > 0 ? 'statup' : 'statdown');
      await this.scene.statusFx(side, change > 0 ? 'up' : 'down');
      const size = Math.abs(change) >= 3 ? 'drastically ' : Math.abs(change) === 2 ? (change > 0 ? 'sharply ' : 'harshly ') : '';
      await this.say(`${who} ${size}${change > 0 ? 'rose' : 'fell'}!`);
    }
    return any;
  }

  async applyAilment(side, ailment, fromStatusMove = false) {
    const mon = this.mon(side), name = this.label(side);
    if (ailment === 'confusion') {
      if (mon.volatile.confusion > 0) {
        if (fromStatusMove) await this.say(`${name} is already confused!`);
        return false;
      }
      mon.volatile.confusion = Utils.randInt(2, 5);
      this.sfx.play('status');
      await this.scene.statusFx(side, 'ailment');
      await this.say(`${name} became confused!`);
      return true;
    }
    if (mon.status || Battle.immuneTo(mon, ailment)) {
      if (fromStatusMove) await this.say('But it failed!');
      return false;
    }
    mon.status = ailment;
    if (ailment === 'sleep') mon.sleepTurns = Utils.randInt(1, 3);
    this.sfx.play('status');
    await this.scene.statusFx(side, 'ailment');
    await this.say(`${name} ${AILMENT_TEXT[ailment]}`);
    return true;
  }

  // ------------------------------------------------------------------ other actions

  async switchIn(side, index, forced = false) {
    if (side === 'player') {
      if (!forced) {
        await this.say(`${this.p.displayName}, come back!`);
        await this.scene.recall('player');
      }
      this.p.resetBattleState();
      this.pIdx = index;
      this.participants.add(this.p.uid);
      await this.say(`Go! ${this.p.displayName}!`);
      await this.scene.sendOut('player', this.p);
    } else {
      const who = this.trainer?.name || 'The foe';
      if (!forced) {
        await this.say(`${who} withdrew ${this.e.displayName}!`);
        await this.scene.recall('enemy');
      }
      this.e.resetBattleState();
      this.eIdx = index;
      await this.say(`${who} sent out ${this.e.displayName}!`);
      await this.scene.sendOut('enemy', this.e);
    }
  }

  async usePlayerItem(action) {
    const def = ITEMS[action.item];
    if (def.kind === 'ball') return this.throwBall(action.item);
    const mon = this.playerParty[action.target];
    this.game.bag[action.item]--;
    if (def.kind === 'heal') {
      const healed = mon.heal(def.amount);
      this.sfx.play('heal');
      if (mon === this.p) {
        await this.scene.statusFx('player', 'heal');
        await this.scene.hp('player');
      }
      await this.say(`You used a ${def.name}! ${mon.displayName} recovered ${healed} HP!`);
    } else if (def.kind === 'cure') {
      mon.status = null;
      mon.volatile.confusion = 0;
      this.sfx.play('heal');
      await this.say(`You used a ${def.name}! ${mon.displayName} is cured!`);
    }
  }

  async useEnemyItem(action) {
    const def = ITEMS[action.item];
    this.enemyItems[action.item]--;
    const healed = this.e.heal(def.amount);
    this.sfx.play('heal');
    await this.say(`${this.trainer.name} used a ${def.name}!`);
    await this.scene.statusFx('enemy', 'heal');
    await this.scene.hp('enemy');
    await this.say(`${this.label('enemy')} recovered ${healed} HP!`);
  }

  async throwBall(key) {
    const def = ITEMS[key];
    this.game.bag[key]--;
    const e = this.e;
    this.sfx.play('throw');
    await this.say(`You threw a ${def.name}!`);
    // Gen-3 style catch formula with four shake checks.
    const rate = e.species.captureRate ?? 45;
    const statusBonus = ['sleep', 'freeze'].includes(e.status) ? 2 : e.status ? 1.5 : 1;
    const a = (((3 * e.maxHp - 2 * e.hp) * rate * def.ball) / (3 * e.maxHp)) * statusBonus;
    const shakeP = Math.pow(Math.min(1, a / 255), 0.25);
    let shakes = 0;
    while (shakes < 4 && Math.random() < shakeP) shakes++;
    const caught = shakes >= 4;
    await this.scene.ball(Math.min(3, shakes), caught);
    if (!caught) {
      await this.say(['Oh no! The Pokémon broke free!', 'Aww! It appeared to be caught!', 'Aargh! Almost had it!', 'Shoot! It was so close, too!'][Math.min(3, shakes)]);
      return;
    }
    this.sfx.play('catch');
    await this.say(`Gotcha! ${e.displayName} was caught!`);
    await this.awardExp(e);
    e.resetBattleState();
    const where = this.game.addPokemon(e);
    if (where === 'box') await this.say(`Your party is full, so ${e.displayName} was sent to the PC box.`);
    this.over = true;
    this.result = 'caught';
  }

  async tryRun() {
    this.runAttempts++;
    const ps = this.p.effectiveSpeed(), es = Math.max(1, this.e.effectiveSpeed());
    const odds = ((ps * 128) / es + 30 * this.runAttempts) / 256;
    if (ps >= es || Utils.chance(odds)) {
      this.sfx.play('run');
      await this.say('Got away safely!');
      this.over = true;
      this.result = 'run';
    } else {
      await this.say("Can't escape!");
    }
  }

  // ------------------------------------------------------------------ fainting, EXP, end of turn

  async checkFaints() {
    if (this.e.fainted && !this.downed.has(this.e.uid)) {
      this.downed.add(this.e.uid);
      this.sfx.play('faint');
      await this.scene.faint('enemy');
      await this.say(`${this.label('enemy')} fainted!`);
      await this.awardExp(this.e);
      if (!this.enemyParty.some(m => !m.fainted)) {
        this.over = true;
        this.result = 'win';
        return;
      }
      const pick = this.ai.chooseReplacement(this);
      this.brain.note(pick.reason);
      await this.switchIn('enemy', pick.index, true);
    }
    if (this.p.fainted && !this.downed.has(this.p.uid)) {
      this.downed.add(this.p.uid);
      this.sfx.play('faint');
      await this.scene.faint('player');
      await this.say(`${this.p.displayName} fainted!`);
      if (!this.playerParty.some(m => !m.fainted)) {
        await this.say('You have no more Pokémon that can fight!');
        if (this.trainer?.winLine) await this.say(`${this.trainer.name}: "${this.trainer.winLine}"`);
        await this.say('You blacked out!');
        this.over = true;
        this.result = 'lose';
        return;
      }
      let idx = -1;
      while (idx < 0) {
        this.ui.sayStatic('Choose your next Pokémon.');
        idx = await this.ui.partyMenu(this.playerParty, { title: 'Send out which Pokémon?', forced: true });
        if (idx >= 0 && this.playerParty[idx].fainted) {
          await this.say(`${this.playerParty[idx].displayName} has no energy left to battle!`);
          idx = -1;
        }
      }
      await this.switchIn('player', idx, true);
    }
  }

  async awardExp(defeated) {
    const base = Math.max(1, Math.floor(((defeated.data.baseExp || 60) * defeated.level) / 7 * (this.type === 'trainer' ? 1.5 : 1)));
    const alive = this.playerParty.filter(m => !m.fainted);
    for (const m of alive.filter(m => this.participants.has(m.uid))) {
      await this.say(`${m.displayName} gained ${base} EXP. Points!`);
      await this.giveExp(m, base);
    }
    const others = alive.filter(m => !this.participants.has(m.uid));
    if (others.length) {
      const share = Math.max(1, Math.floor(base / 3));
      await this.say(`The rest of your team gained ${share} EXP. Points from the Exp. Share!`);
      for (const m of others) await this.giveExp(m, share);
    }
  }

  async giveExp(mon, amount) {
    const levels = mon.gainExp(amount);
    const active = mon === this.p;
    if (active) await this.scene.exp();
    for (const lv of levels) {
      this.leveled.add(mon);
      this.sfx.play('levelup');
      if (active) await this.scene.hp('player');
      await this.say(`${mon.displayName} grew to Lv. ${lv}!`);
      await this.game.learnMovesForLevel(mon, lv);
    }
  }

  async endOfTurn() {
    for (const side of ['player', 'enemy']) {
      const m = this.mon(side);
      if (m.fainted || (m.status !== 'burn' && m.status !== 'poison')) continue;
      const burn = m.status === 'burn';
      m.hp = Math.max(0, m.hp - Math.max(1, Math.floor(m.maxHp / (burn ? 16 : 8))));
      await this.scene.statusFx(side, 'ailment');
      await this.scene.hp(side);
      await this.say(`${this.label(side)} is hurt by its ${burn ? 'burn' : 'poison'}!`);
    }
  }

  async finish() {
    const t = this.trainer;
    if (this.result === 'win' && t) {
      await this.say(`You defeated ${t.name}!`);
      if (t.loseLine) await this.say(`${t.name}: "${t.loseLine}"`);
      if (t.reward) {
        this.game.money += t.reward;
        await this.say(`You got $${t.reward} for winning!`);
      }
    }
    this.learner.endBattle(this.result, this);
    this.brain.battleEnd(this.result, this);
    for (const m of [...this.playerParty, ...this.enemyParty]) m.resetBattleState();
    this.ui.setBattleMode(false);
    this.ui.closeDialog();
  }
}
