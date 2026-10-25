# PokéAPI Nemesis: Code Reference

A 2D Pokémon-style RPG that runs in the browser. Every Pokémon, move, sprite, cry, type
matchup and evolution comes live from **PokéAPI**. The enemy AI, **NEMESIS**, predicts what you
will do, picks its counter-move, and learns your patterns across battles. A side panel
shows its thinking as it happens.

---

## 1. How to run

The game is plain HTML/CSS/JS with no build step and nothing to install.

| Option | How |
|---|---|
| Easiest (Windows) | Double-click `run.bat`. It starts a local server and opens `http://localhost:8000`. |
| macOS / Linux | Run `./run.sh`, then open `http://localhost:8000`. |
| Any OS | Run `python -m http.server 8000` in the project folder, then open `http://localhost:8000`. |
| Node | Run `npx http-server -p 8000` in the project folder. |

You need an internet connection for PokéAPI, sprites and fonts. Each resource downloads once and
is then cached in `localStorage`. If PokéAPI is unreachable, a small offline dex (`fallback.js`)
keeps the game playable.

**Controls:** Arrows/WASD to move · Z/Enter/Space to confirm or talk · X/Esc to go back · M for the menu. You can also click menus with the mouse.

---

## 2. The game in one minute

1. **Title → Prof. Cedar intro → pick a starter** (Bulbasaur, Charmander or Squirtle, all loaded from PokéAPI).
2. **Rootvale Town (south):** your house (free heal), Prof. Cedar's lab, a Poké Center, and an item on the ground.
3. **Route 1:** tall grass with wild Pokémon (catch them!), three trainers who spot you from a distance, a pond and hidden items.
4. **Rival Kai** blocks the gate north. Kai always picks the starter that beats yours.
5. **Ascend City (north):** Poké Center, Poké Mart, and the **AI Gym** of **NYX**, the boss powered by the NEMESIS core.
6. Beat NYX to earn the **ADAPT BADGE**. Rematch as often as you like: each rematch adds a Pokémon and a level, and NYX's memory of you keeps growing.

RPG systems: EXP and levels with real growth-rate curves, learning moves on level-up (with "forget a move"),
evolution by level (read from PokéAPI evolution chains), catching with shake checks, party of 6 + PC box,
bag and shop, money, blackout/respawn, status conditions, stat stages, critical hits, save/continue.

---

## 3. File map

```
pokemon-nemesis-ai/
├── index.html              Page shell: canvas, dialog, menu layer, brain panel; loads scripts in order
├── run.bat                 One-click local server
├── run.sh                  One-command local server (macOS / Linux)
├── README.md               Project overview
├── docs/ARCHITECTURE.md    This document (screenshots in docs/screenshots/)
├── css/style.css           All styling (game UI boxes + NEMESIS panel)
└── js/
    ├── config.js           CONFIG constants, ITEMS table, itemSprite()
    ├── utils.js            Utils: random, math, easing, softmax, formatting
    ├── typeChart.js        TYPES, TYPE_COLORS, TypeChart (built-in + loaded from PokéAPI)
    ├── fallback.js         Fallback: tiny offline dex
    ├── api.js              PokeAPI: fetch + trim + cache
    ├── sfx.js              SFX: synthesized sound effects + Pokémon cries
    ├── input.js            Input: keyboard mapping and routing
    ├── pokemon.js          Move and Pokemon models
    ├── ai/
    │   ├── patternLearner.js   PatternLearner: NEMESIS's memory of the player
    │   └── enemyAI.js          EnemyAI: decision-making per opponent tier
    ├── battle.js           Battle: turn engine
    ├── ui/
    │   ├── ui.js               UI: dialog, menus, party/bag/summary screens
    │   ├── battleScene.js      BattleScene: canvas battle renderer + animations
    │   └── brainPanel.js       BrainPanel: live AI visualization
    ├── world/
    │   ├── world.js            World: map, buildings, NPC data, tile/character drawing
    │   └── overworld.js        Overworld: movement, camera, interactions, encounters
    ├── game.js             Game: state machine, scripts, save/load
    └── main.js             Boot + window scaling
```

The scripts are classic `<script>` tags (not ES modules), so each file's top-level `const`/`class` is
global and **load order matters**. `index.html` lists them in dependency order.

---

## 4. Architecture

```
            ┌──────────── Game (state machine, render loop) ────────────┐
            │                                                            │
  Input ──► UI (dialog/menus)        Overworld ◄── World (map data)      │
            │                            │                               │
            │                    trainer / wild encounter                │
            │                            ▼                               │
            │   PatternLearner ◄──── Battle ────► BattleScene (canvas)   │
            │        ▲   │              │                                │
            │        │   └─prediction──►EnemyAI                          │
            │        └──── observe / Q-reward                            │
            │                            │                               │
            └──────────── BrainPanel ◄───┘ (visualizes everything)       │
                                                                         │
  PokeAPI (fetch/cache) ◄── Pokemon / Move / TypeChart / evolution ──────┘
```

**One battle turn:**

1. `PatternLearner.buildContext()` takes a snapshot: your HP bucket, type matchup, last actions, your moves.
2. `PatternLearner.predict()` estimates the probability of each action (attack/status/switch/heal/catch/run) and which move you'll use.
3. You choose your action in the menus.
4. `EnemyAI.decide()` scores every option **using only the prediction**. It never sees your real choice.
5. `PatternLearner.observe()` records what you actually did and whether the prediction was right.
6. The actions resolve in priority/speed order, with animations.
7. Team-HP swing becomes a reward, and `PatternLearner.updateQ()` updates the AI's opinion of the tactic it used.
8. `BrainPanel` shows each step: prediction bars, scored options, reasoning, outcome, reward and the accuracy chart.

---

## 5. How NEMESIS learns (the AI)

NEMESIS is one shared memory (`localStorage` key `pkn:memory:v1`). **Every** trainer uses it: Rick,
Mira, Joey, Kai and NYX. Wild battles are also observed. It persists across sessions until you wipe it.

### 5.1 Pattern learning (predicting you), in `PatternLearner`

| What it learns | Data structure | Used for |
|---|---|---|
| Action sequences | `unigram`, `bigram[prev]`, `trigram[prev2>prev]` counts | Hierarchical n-gram (Markov) prediction of your next action kind |
| Heal habit | `healByHp[bucket] = [healed, chances]` | "You heal at 20-40% HP 3 of 4 times" |
| Switch habit | `switchByMatchup[A/N/D] = [switched, chances]` | "When at a type disadvantage you switch 60%" |
| Move preference | `moveUsage[species][move]` | Which attack you'll pick with each Pokémon |
| Super-effective bias | `sePick = [picked, available]` | How strongly you go for type advantage |
| Favourite lead | `leads[species]` | NYX/Kai choose a lead that counters it |
| Prediction log | `predLog` | Accuracy stats and chart |

**Prediction math (`predict`)**
- Each n-gram level is Dirichlet-smoothed toward the level below:
  `P = (count + k·prior) / (total + k)`. Unigram → bigram → trigram, starting from a common-sense prior.
  This starts out "dumb" and sharpens as data comes in.
- Context experts (heal by HP, switch by matchup) are blended in with weight `n/(n+3)`, so they gain
  influence as evidence grows. Hard constraints apply: no potions means P(heal)=0, no healthy bench means P(switch)=0.
- Move distribution: weight = `1 + power/80`, + super-effective bonus × your learned SE rate, + 1.5 × times used.

### 5.2 Decision making (beating you), in `EnemyAI.decide`

Every option gets a score in points:
- **Attack moves:** expected damage % of your HP (real damage formula, average roll, accuracy, multi-hit),
  + KO bonus (bigger when faster), × `(1 − 0.45·P(switch))` because damage is wasted if you switch,
  + a "punish heal" bonus when you're predicted to heal, − recoil.
- **Status moves:** value of the ailment (sleep > paralysis > burn ≈ freeze > poison > confusion) unless blocked,
  stat boosts when safe, recovery when hurt, **+ "free turn" bonus** when you're predicted to switch or heal.
- **Switching:** compares the predicted incoming damage on the current Pokémon vs. the bench Pokémon
  (based on your *predicted move*), plus offensive improvement, minus a tempo cost.
- **Potions:** valuable when low on HP, unless it would still faint.
- **Experience bias:** `+ Q(state, kind) × qWeight` (see 5.3).
- Final choice: **softmax** over scores with a per-tier temperature. Lower temperature means more ruthless.

| Tier (`AI_PROFILES`) | temp | trusts predictions | Q weight | used by |
|---|---|---|---|---|
| `wild` | 30 | 0% | 0 | wild Pokémon (instinct only) |
| `trainer` | 14 | 55% | 15 | Rick, Mira, Joey |
| `rival` | 9 | 80% | 25 | Kai |
| `boss` | 5 | 100% | 35 | NYX |

### 5.3 Reinforcement learning (rating its own tactics)

- **State key** = `enemyHpBucket + playerHpBucket + matchup`, e.g. `42A`.
- **Action kind** = attack / status / switch / heal.
- **Reward** after each turn = (HP fraction your team lost) − (HP fraction its team lost), clamped to [−1, 1].
- **Update:** `Q += α(reward − Q)` with `α = max(0.15, 1/n)`.
- The Q-values show up in the MEMORY tab ("Learned tactics") and as a reasoning line when they sway a decision.

### 5.4 Visible "learning" moments (good for the video)
- The **accuracy chart** climbs as you repeat habits. Cyan is action-type accuracy, magenta is exact-move accuracy.
- NYX **taunts** ("Predictable.", "Pattern confirmed.") when it read you correctly with confidence.
- NYX's **lead Pokémon** changes to counter the starter you usually lead with (shown as a gold reasoning line).
- The **MEMORY tab** heatmap shows your action habits as P(next | previous).
- **How to beat it:** be unpredictable. Vary moves, heal at different HP levels, switch unexpectedly.

---

## 6. Module reference

### `config.js`
| Name | What it is |
|---|---|
| `CONFIG` | All tunables: resolution, API URLs, storage keys, preferred version groups for learnsets, starters, rival counter-pick, walk speed, encounter rate, text speed, starting money and bag. |
| `ITEMS` | Item table keyed by PokéAPI item name (`potion`, `super-potion`, `full-heal`, `poke-ball`, `great-ball`): `kind` (heal/cure/ball), amount, ball multiplier, price. |
| `itemSprite(key)` | URL of the item's PokéAPI sprite. |

### `utils.js` → `Utils`
| Function | Purpose |
|---|---|
| `rand`, `randInt`, `chance`, `choice` | Random helpers. |
| `clamp`, `lerp`, `sleep(ms)`, `uid()` | Basic math and async helpers. |
| `pretty(s)`, `pct(v)`, `escape(s)`, `idFromUrl(url)` | Formatting, HTML escaping, extract an id from a PokéAPI URL. |
| `linear`, `easeOutQuad`, `easeInOutQuad`, `easeOutBack` | Easing curves for tweens. |
| `hpBucket(frac)`, `bucketLabel(b)` | HP fraction → 0-4 bucket (learning context). |
| `stageMultiplier(s)`, `accuracyMultiplier(s)` | Stat-stage math (−6…+6). |
| `softmax(scores, temp)`, `weightedIndex(weights)` | AI choice sampling. |
| `normalize(obj)`, `argmax(obj)` | Probability helpers. |
| `hpColor(frac)` | Green/yellow/red HP bar color. |
| `hash(x, y)` | Deterministic noise for procedural tiles. |
| `withTimeout(promise, ms)` | Fails a promise after a timeout. |

### `typeChart.js`
| Name | Purpose |
|---|---|
| `TYPES`, `TYPE_COLORS` | The 18 types and their UI colors. |
| `TypeChart.chart` | Attacking type → defending type → multiplier. Built-in table at first. |
| `TypeChart.effectiveness(type, defTypes)` | Combined multiplier (e.g. 4×, 0.5×, 0). |
| `TypeChart.label(mult)` | "Super effective" / "Not very effective" / "No effect". |
| `TypeChart.loadFromAPI()` | Replaces the table with PokéAPI `/type/{name}` damage relations (cached). |

### `fallback.js` → `Fallback`
Offline data for 8 species and 16 moves. `pokemon(id)`, `species(id)` and `move(name)` return the same
trimmed shapes as `PokeAPI`. Unknown ids map to a known one.

### `api.js` → `PokeAPI` (all static)
| Method | Purpose |
|---|---|
| `fetchJSON(path)` | GET from PokéAPI. |
| `cached(key, loader, fallback)` | Memory → localStorage → network, de-duplicates in-flight requests, uses the offline fallback on failure. |
| `getPokemon(id)` | `/pokemon/{id}` trimmed to: types, base stats, base EXP, sprites (front/back/icon), cry URL, level-up learnset for the first matching version group. |
| `getSpecies(id)` | `/pokemon-species/{id}`: English name, capture rate, growth rate, evolution-chain URL, genus, flavor text. |
| `getMove(name)` | `/move/{name}`: type, power, accuracy, PP, priority, damage class, target, ailment and chance, stat changes, drain, healing, crit rate, flinch, multi-hit. |
| `getEvolutionChain(url)` | Evolution tree with level requirements. Unsupported conditions (items, trades…) are flagged `extra`. |
| `getType(name)` | Damage relations for the type chart. |
| `loadImage(url)` | Cached `Image` loader (returns a Promise). |
| `readCache`, `writeCache`, `clearCache` | localStorage cache handling. If storage is full, only the API cache is cleared (never your save or AI memory). |
| `trimPokemon`, `trimSpecies`, `trimMove`, `trimEvolution` | Reduce the raw JSON to small objects. |

### `sfx.js` → `SFX`
| Method | Purpose |
|---|---|
| `play(name)` | Synthesized retro effects with WebAudio: cursor, select, hit, super, faint, heal, levelup, encounter, catch, think… |
| `cry(url, volume)` | Plays a Pokémon's real cry from PokéAPI. |
| `tone()`, `noise()` | Low-level oscillator and noise bursts. |
| `setEnabled(on)` | Sound toggle (saved in settings). |

### `input.js` → `Input`
| Member | Purpose |
|---|---|
| `KEYMAP` | Raw keys → `up/down/left/right/confirm/cancel/menu`. |
| constructor | If a dialog or menu is open, keys go to `UI.dispatch`. Otherwise they're stored for the overworld. |
| `consume(key)` | Edge-triggered press check (true once). |
| `heldDir()` | The most recently held direction (smooth walking). |
| `clear()` | Drops pending presses after a script ends. |

### `pokemon.js`
**Constants:** `STAT_KEYS`, `STAGE_KEYS`, `STAT_LABEL`, `SUPPORTED_AILMENTS`, `STATUS_TAG`, `STATUS_COLOR`.

**`Move`**: a move instance with current PP.
| Member | Purpose |
|---|---|
| constructor(data, pp) | Copies the trimmed PokéAPI move data. |
| `displayName`, `isDamaging` | Getters. |
| `Move.isUsable(data)` | Only moves the engine can simulate (damaging, healing, stat-changing or a supported ailment). |
| `Move.load(name, pp)` | Fetch and build. |
| `Move.struggle()` | Fallback move when all PP is gone (25% recoil). |
| `toJSON()` | `{ name, pp }` for saving. |

**`Pokemon`**
| Member | Purpose |
|---|---|
| constructor(data, species, level, opts) | IVs (random 0-31), EXP, moves, HP, status. |
| getters | `displayName`, `types`, `maxHp`, `hpFrac`, `fainted`, `growthRate`, `expProgress`, `expToNext`. |
| `calcStats()` | Main-series stat formula. |
| `resetBattleState()` | Clears stat stages, confusion and flinch (on switch-out and after battle). |
| `effectiveSpeed()` | Speed with stages and paralysis. |
| `heal(n)`, `fullRestore()` | Healing helpers. |
| `Pokemon.expForLevel(n, rate)` | EXP curves: fast, medium, medium-slow, slow. |
| `gainExp(n)` | Adds EXP and returns the levels reached (HP grows with level). |
| `movesLearnedAt(level)` | New learnable moves exactly at that level. |
| `checkEvolution()` | Reads the evolution chain and returns the next species id if the level requirement is met. |
| `evolveInto(id)` | Swaps species data and keeps damage taken. |
| `Pokemon.create(id, level)` | Fetches data and auto-picks up to 4 moves. |
| `Pokemon.pickMoves(data, level)` | Newest damaging moves + one status move; guarantees an attack. |
| `toJSON()` / `Pokemon.fromJSON(j)` | Save and load. |

### `ai/patternLearner.js` → `PatternLearner`
**Constants:** `ACTION_KINDS`, `TRAINER_KINDS`, `KIND_PRIOR`, `KIND_LABEL`, `KIND_VERB`, `MATCHUP_LABEL`.
| Method | Purpose |
|---|---|
| `PatternLearner.blank()` | Empty memory structure (see 5.1). |
| `load()` / `save()` / `reset()` | Persistence (debounced save). |
| `buildContext(battle)` | Situation snapshot from the player's side. |
| `PatternLearner.smooth(counts, kinds, prior, k)` | Dirichlet smoothing. |
| `predict(ctx)` | Returns `{ dist, top, confidence, moveDist, topMove, reasons[] }`. |
| `moveDistribution(species, moves)` | P(move given you attack). |
| `observe(ctx, obs, pred)` | Learns from your real action; returns `{ kind: bool, move: bool/null }` correctness. |
| `startBattle(b)` / `endBattle(result, b)` | Battle counters, lead tracking, history and AI win/loss record. |
| `getQ(state, kind)` / `updateQ(state, kind, reward)` | Q-table for NEMESIS's own tactics. |
| `favouriteLead()` | Your most-used lead (for counter-picking). |
| `stats()`, `accuracySeries()`, `topMoves()` | Data for the brain panel. |

### `ai/enemyAI.js` → `EnemyAI`
**Constants:** `AI_PROFILES` (per-tier settings), `NEUTRAL_PRED`, `AILMENT_VALUE`, `AI_QUIPS`.
| Method | Purpose |
|---|---|
| `decide(battle, prediction)` | Scores all options and samples one. Returns `{ action, kind, stateKey, chosen, candidates, reasons }`. |
| `blend(prediction, foe)` | Mixes the prediction with a neutral prior by the tier's trust level. |
| `scoreMove`, `scoreSwitch`, `scoreHeal` | Option scoring (see 5.2). |
| `incomingFrac(target, foe, moveDist)` | Expected % of `target`'s HP lost to your predicted attack. |
| `EnemyAI.bestOffense(att, def)` | Best expected damage % available. |
| `EnemyAI.matchup`, `bestEff`, `stateKey`, `describeState` | Situation encoding for Q-learning. |
| `decideWild(battle)` | Instinctive move choice for wild Pokémon. |
| `chooseReplacement(battle)` | Best next Pokémon after a faint (offense − predicted risk + HP + speed). |
| `explain(...)` | Plain-English reasoning lines for the panel. |
| `quip(correct, obs, pred)` | Taunt line when a confident prediction was right. |

### `battle.js` → `Battle`
| Method | Purpose |
|---|---|
| constructor(game, { type, enemyParty, trainer, bg }) | Sets up one battle (`type` is `wild` or `trainer`). |
| `start()` | Intro, send-outs, turn loop, `finish()`. Resolves to `win` / `lose` / `run` / `caught`. |
| `playTurn()` | The 8-step turn described in section 4. |
| `choosePlayerAction()` | FIGHT/BAG/POKéMON/RUN menus with validation. |
| `observation(action)` | Converts your action into a learner record. |
| `turnOrder(pA, eA)` | Switch/item/run first, then priority, then speed, then coin flip. |
| `resolveTurn(pA, eA)` | Executes both actions, checks faints, end-of-turn effects. |
| `useMove(side, move, isFirst)` | Sleep/freeze/flinch/paralysis/confusion checks, PP, accuracy, then damage or status. |
| `doDamage(...)` | Multi-hit, crits, effectiveness text, drain/recoil, secondary ailments, flinch, stat changes. |
| `doStatusMove(...)` | Healing, stat stages, ailments (with immunities). |
| `applyStatChanges(side, changes)`, `applyAilment(side, ailment)` | Effect application and messages. |
| `Battle.calcDamage(atk, def, move, opts)` | Main-series damage formula (STAB, types, burn, crit, random roll). `expected: true` gives the average for the AI. |
| `Battle.expectedDamage(atk, def, move)` | Average damage × hits × accuracy. |
| `Battle.immuneTo`, `isSelfTargeting`, `statTargetsSelf` | Rules helpers. |
| `switchIn`, `usePlayerItem`, `useEnemyItem`, `throwBall`, `tryRun` | Non-move actions (catch uses a gen-3 style formula with 4 shake checks). |
| `checkFaints()` | Faint animations, EXP, AI replacement pick, forced switch, win/lose. |
| `awardExp(defeated)`, `giveExp(mon, n)` | EXP to participants + 1/3 Exp. Share, level-ups, new moves. |
| `endOfTurn()` | Burn and poison damage. |
| `finish()` | Prize money, learner/panel wrap-up, state cleanup. |

### `ui/ui.js` → `UI`
| Method | Purpose |
|---|---|
| `say(text, { auto, hold })` | Typewriter dialog. Resolves on confirm, or automatically in battles. |
| `sayStatic(text)`, `closeDialog()` | Instant text, hide the box. |
| `ask(question, options)`, `confirm(question)` | Question with a choice menu, and YES/NO. |
| `menu({ items, columns, anchor, onFocus, extra, … })` | Generic keyboard and mouse menu. Resolves to an index (−1 on cancel). |
| `battleMenu(canRun)`, `moveMenu(mon, foe)` | Battle command grid; move grid with type/PP/power/accuracy and effectiveness hint. |
| `partyMenu(party, opts)`, `bagMenu(bag)`, `summary(mon)` | Party list with HP bars, bag with item sprites, full stats screen. |
| `monRowHtml(mon)` | Party row markup. |
| `toast(text)`, `showBanner(text)` | Pop-up notices, area name banner. |
| `pushHandler`, `popHandler`, `dispatch`, `hasHandler` | Key-routing stack. |

### `ui/battleScene.js` → `BattleScene`
| Method | Purpose |
|---|---|
| `prepare()`, `setup(battle)`, `setMon(side, mon)` | Reset, load sprites (front for the enemy, back for the player). |
| `tween(target, props, ms, ease)` | Promise-based tweening used by every animation. |
| `update(dt)`, `render(ctx)` | Tweens, particles, screen shake and flash; draws backdrop, sprites, ball, particles and HP/EXP boxes. |
| `intro`, `sendOut`, `recall`, `faint` | Battle entrance and exit animations (with cries). |
| `attack(side, move)` | Physical lunge, or a special projectile in the move's type color. |
| `hit`, `hp`, `exp`, `statusFx` | Blink/shake, HP drain animation, EXP fill across level-ups, stat/heal/ailment particles. |
| `ball(shakes, caught)` | Throw arc, absorb, shake animation, break-out or catch stars. |
| `drawBackdrop`, `drawMon`, `drawBall`, `drawBox`, `silhouette` | Rendering helpers. Backdrops: `grass`, `field`, `gym` (NYX's neon grid). |

### `ui/brainPanel.js` → `BrainPanel`
| Method | Purpose |
|---|---|
| `battleStart`, `battleEnd` | Status line and reset. |
| `showPrediction(pred, ctx)` | Bars for each predicted action and the predicted move. |
| `showThinking(ai)` | Glow and "thinking…" while the AI decides. |
| `showDecision(dec)` | Scored options with points and softmax probability; reasoning list. |
| `showOutcome(obs, pred, correct)`, `showReward(dec)` | ✔/✘ prediction result and Q-learning reward line. |
| `note(text)` | Gold highlight line (lead choice, replacement choice). |
| `refreshStats()`, `drawAccuracy()` | Stat tiles and rolling accuracy chart. |
| `renderMemory()` | Transition heatmap, heal-by-HP chart, favourite moves, type usage, Q-values, battle history. |
| `setTab(tab)` | LIVE THINKING / MEMORY tabs. The "Wipe AI memory" button resets NEMESIS. |

### `world/world.js`
| Name | Purpose |
|---|---|
| `SOLID_TILES` | Tiles that block movement. Legend: `.` grass, `,` tall grass, `=` path, `T` tree, `~` water, `f` flowers, `S` sign. |
| `WILD_POOLS` | Encounter tables (`routeSouth`, `routeNorth`): `[pokemonId, weight]` and a level range. |
| `BOSS_ROSTER` | NYX's Pokémon (first `3 + rematch tier` are used). |
| `CHAR_PALETTES`, `BUILDING_STYLES` | Colors for characters and buildings. |
| `drawCharacter(ctx, x, y, dir, phase, pal)` | Procedural 16×20 pixel character with walk cycle. |
| `drawPokeball(ctx, x, y, r)` | Item ball on the map. |
| `World.buildTiles`, `buildBuildings`, `buildNpcs` | The map layout. Buildings get a door at the bottom center. NPCs and trainers are defined here (teams, lines, sight range). |
| `tileAt`, `buildingAt`, `doorAt`, `signAt`, `isSolidTerrain`, `poolAt`, `regionAt` | Map queries. |
| `prerender()`, `drawTile`, `drawBuilding`, `render`, `drawGrassOverlay` | Terrain is drawn once to an offscreen canvas; water shimmers; tall grass covers your feet. |

### `world/overworld.js` → `Overworld`
| Method | Purpose |
|---|---|
| `Overworld.makePlayer(x, y, dir)` | Player entity. |
| `update(dt)`, `updateEntity`, `handleInput` | Grid movement with smooth interpolation, bump sound, walking into doors. |
| `onStep()` | After each step: area banner, trainer line-of-sight, tall-grass encounter roll. |
| `findSpotter()` | Trainers see you within `sight` tiles in their facing direction. |
| `trainerSpotted(npc)`, `stepEntity` | "!" bubble, the trainer walks up to you, then the battle. |
| `interact(x, y)`, `talkTo(npc)`, `enterBuilding(b)` | Talking, signs, item pickups, house (heal), Poké Center, Mart, Gym, Lab. |
| `camera()`, `render(ctx)` | Camera clamped to the map; y-sorted characters and pickups; emotes. |

### `game.js` → `Game`
| Method | Purpose |
|---|---|
| constructor / `resetState()` | Creates all subsystems; new-game state (party, bag, money, flags, position). |
| `boot()`, `loop()`, `update(dt)`, `render()` | Startup (fonts, type chart, title sprites) and the requestAnimationFrame loop. |
| `run(fn)` | Runs one overworld script at a time, blocks movement, recovers from errors. |
| States | `loading`, `title`, `intro`, `starter`, `overworld`, `battle`, `evolution`. |
| `titleScreen()`, `newGame()`, `chooseStarter()`, `enterOverworld()` | Opening flow. |
| `save()`, `loadGame()` | localStorage save (`pkn:save:v1`). The game autosaves after battles and heals. |
| `runBattle(opts)` | Battle wrapper: evolutions afterwards, blackout on loss, autosave. |
| `wildEncounter(pool)`, `trainerBattle(npc)`, `teamFor(npc)` | Encounter setup (rival/boss teams scale with your level). |
| `aiOrderTeam(team, difficulty)` | NEMESIS picks the lead that counters your favourite lead. |
| `challengeNyx()` | Gym leader dialog, badge, rematch tiers. |
| `learnMovesForLevel(mon, lvl)`, `evolve(mon, id)` | Move learning with "forget a move" menu; evolution cutscene. |
| `pauseMenu()`, `partyScreen()`, `bagScreen()`, `shop()`, `pokeCenter()`, `pcBox()`, `blackout()` | RPG menus and services. |
| `addPokemon(mon)`, `healParty()` | Party/box management. |
| `renderTitle`, `renderStarter`, `renderTransition`, `renderEvolution`, `renderLoading` | Non-overworld screens. |

### `main.js`
`fitApp()` scales the fixed 960×640 game plus the 400 px panel to fit the window. On `load` it creates `window.game` and calls `boot()`.

---

## 7. Storage keys

| Key | Contents |
|---|---|
| `pkn:save:v1` | Your game save. |
| `pkn:memory:v1` | NEMESIS's memory of you (wipe it from the title screen or the MEMORY tab). |
| `pkn:settings:v1` | Sound on/off. |
| `pkn:cache:v1:*` | Cached PokéAPI responses (safe to delete). |

---

## 8. Extending the game

- **New wild Pokémon:** add `[id, weight]` to `WILD_POOLS` in `world.js`. Any PokéAPI id works.
- **New trainer:** add an entry in `World.buildNpcs()` with `trainer: { team: [[id, level], …], difficulty, reward, items }`, `sight`, `intro`, `defeat`, `after`.
- **Harder or easier AI:** tune `AI_PROFILES` in `enemyAI.js` (lower `temp` is greedier; higher `predWeight` and `qWeight` lean harder on learning).
- **More items:** add to `ITEMS` using the PokéAPI item name as the key, so the sprite loads automatically.
- **Bigger map:** change `World.buildTiles` (rectangles of tile characters) and `regionAt`.
- **New move effects:** extend `Move.isUsable` plus `Battle.doDamage` / `doStatusMove`.
