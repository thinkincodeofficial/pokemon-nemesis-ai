'use strict';

/**
 * The "AI brain" side panel: visualises NEMESIS's live predictions, the options it
 * scored, its reasoning, prediction accuracy over time, and everything it has learned.
 */
class BrainPanel {
  constructor(game) {
    this.game = game;
    this.el = document.getElementById('brain');
    this.tab = 'live';
    this.el.innerHTML = `
      <header class="brain-head">
        <div class="brain-logo"><span class="pulse"></span>NEMESIS <small>adaptive battle AI</small></div>
        <div class="brain-status" id="b-status">idle · watching you</div>
      </header>
      <div class="brain-stats" id="b-stats"></div>
      <nav class="brain-tabs">
        <button data-tab="live" class="on">LIVE THINKING</button>
        <button data-tab="memory">MEMORY</button>
      </nav>
      <div class="brain-body" id="b-live">
        <section><h3>What will you do next?</h3><div id="b-pred" class="bars"></div><div id="b-predmove" class="note"></div></section>
        <section><h3>Options considered</h3><div id="b-cands" class="bars"></div></section>
        <section><h3>Reasoning</h3><ul id="b-reasons" class="reasons"></ul></section>
        <section><h3>Last turn</h3><div id="b-outcome" class="note">No battle yet.</div></section>
        <section><h3>Prediction accuracy</h3><canvas id="b-acc" class="chart" width="720" height="160"></canvas>
          <div class="legend"><span class="lg-cyan">action type</span><span class="lg-mag">exact move</span><span class="lg-dim">50% line</span></div></section>
      </div>
      <div class="brain-body hidden" id="b-memory">
        <section><h3>Action transitions <small>P(next | previous)</small></h3><canvas id="b-heat" class="chart" width="720" height="330"></canvas></section>
        <section><h3>Heal habit by HP</h3><canvas id="b-heal" class="chart" width="720" height="180"></canvas></section>
        <section><h3>Favourite moves</h3><div id="b-moves" class="bars"></div></section>
        <section><h3>Attack types you use</h3><div id="b-types" class="bars"></div></section>
        <section><h3>Learned tactics <small>Q-values</small></h3><div id="b-q" class="qlist"></div></section>
        <section><h3>Battle history</h3><div id="b-history" class="history"></div></section>
        <button id="b-reset" class="danger">WIPE AI MEMORY</button>
      </div>`;
    this.el.querySelectorAll('.brain-tabs button').forEach(b => b.addEventListener('click', () => this.setTab(b.dataset.tab)));
    this.el.querySelector('#b-reset').addEventListener('click', () => {
      if (window.confirm('Erase everything NEMESIS has learned about you?')) {
        this.game.learner.reset();
        this.clearLive();
        this.refresh();
      }
    });
    this.$ = id => this.el.querySelector(id);
    this.refresh();
  }

  setTab(tab) {
    this.tab = tab;
    this.el.querySelectorAll('.brain-tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    this.$('#b-live').classList.toggle('hidden', tab !== 'live');
    this.$('#b-memory').classList.toggle('hidden', tab !== 'memory');
    this.refresh();
  }

  setStatus(text) {
    this.$('#b-status').textContent = text;
  }

  bars(container, rows) {
    container.innerHTML = rows.map(r => `
      <div class="bar-row${r.highlight ? ' hi' : ''}">
        <span class="bar-label">${r.label}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${Utils.clamp(r.value, 0, 1) * 100}%;${r.color ? `background:${r.color}` : ''}"></div></div>
        <span class="bar-value">${r.text}</span>
      </div>`).join('');
  }

  clearLive() {
    this.$('#b-pred').innerHTML = '';
    this.$('#b-predmove').innerHTML = '';
    this.$('#b-cands').innerHTML = '';
    this.$('#b-reasons').innerHTML = '';
    this.$('#b-outcome').textContent = 'No battle yet.';
  }

  // ---------------------------------------------------------------- live battle hooks

  battleStart(battle) {
    const who = battle.trainer ? `${battle.trainer.name} · ${AI_PROFILES[battle.trainer.difficulty].label}` : 'wild battle · observing';
    this.setStatus(who);
    this.clearLive();
    this.$('#b-outcome').textContent = 'Battle started.';
    if (this.tab !== 'live') this.setTab('live');
  }

  showPrediction(pred, ctx) {
    this.bars(this.$('#b-pred'), ctx.allowed.map(k => ({
      label: KIND_LABEL[k], value: pred.dist[k], text: Utils.pct(pred.dist[k]), highlight: k === pred.top,
    })));
    const mv = pred.topMove ? ctx.playerMoves.find(m => m.name === pred.topMove) : null;
    this.$('#b-predmove').innerHTML = mv
      ? `If you attack: <b style="color:${TYPE_COLORS[mv.type]}">${Utils.escape(mv.label)}</b> (${Utils.pct(pred.moveDist[pred.topMove])})`
      : 'No attack prediction yet.';
    this.$('#b-reasons').innerHTML = pred.reasons.length
      ? pred.reasons.map(r => `<li>${Utils.escape(r)}</li>`).join('')
      : '<li class="dim">Not enough data yet. Every choice you make teaches me.</li>';
  }

  showThinking(ai) {
    this.el.classList.add('thinking');
    this.setStatus(`${ai.name} is thinking…`);
    if (ai.thinkTime) this.game.sfx.play('think');
  }

  showDecision(dec, battle) {
    this.el.classList.remove('thinking');
    const maxProb = Math.max(...dec.candidates.map(c => c.prob));
    this.bars(this.$('#b-cands'), dec.candidates.slice(0, 6).map(c => ({
      label: Utils.escape(c.label),
      value: c.prob / maxProb,
      text: `${Math.round(c.score)} pts · ${Utils.pct(c.prob)}`,
      highlight: c === dec.chosen,
      color: c.type ? TYPE_COLORS[c.type] : c.kind === 'switch' ? '#ffd25a' : c.kind === 'heal' ? '#60f080' : null,
    })));
    this.$('#b-reasons').innerHTML = dec.reasons.map(r => `<li>${Utils.escape(r)}</li>`).join('');
    this.setStatus(battle.trainer ? `${battle.trainer.name} · ${dec.profile.label}` : 'wild battle · observing');
  }

  showOutcome(obs, pred, correct) {
    const did = obs.kind === 'attack' ? `${KIND_LABEL.attack}: ${obs.moveLabel}` : obs.kind === 'switch' ? `Switch to ${obs.targetLabel}` : KIND_LABEL[obs.kind];
    const mark = ok => (ok ? '<span class="ok">✔</span>' : '<span class="bad">✘</span>');
    let html = `You chose <b>${Utils.escape(did)}</b><br>Predicted: ${KIND_LABEL[pred.top]} ${mark(correct.kind)}`;
    if (correct.move !== null) html += `<br>Exact move predicted ${mark(correct.move)}`;
    this.$('#b-outcome').innerHTML = html;
  }

  showReward(dec) {
    const r = dec.reward;
    this.$('#b-outcome').innerHTML += `<div class="reward ${r >= 0 ? 'pos' : 'neg'}">Turn reward ${r >= 0 ? '+' : ''}${r.toFixed(2)}: "${dec.kind}" in [${EnemyAI.describeState(dec.stateKey)}] is now Q ${dec.newQ.toFixed(2)}</div>`;
  }

  note(text) {
    if (!text) return;
    const li = document.createElement('li');
    li.className = 'note-line';
    li.textContent = text;
    this.$('#b-reasons').prepend(li);
  }

  battleEnd(result, battle) {
    const text = { win: 'You won. Recalibrating…', lose: 'NEMESIS side won. Pattern stored.', run: 'You ran. Noted.', caught: 'You caught it. Noted.' }[result] || '';
    this.setStatus(`${battle.trainer ? battle.trainer.name : 'Wild'}: ${text}`);
    this.refresh();
  }

  // ---------------------------------------------------------------- stats + charts

  refreshStats() {
    const s = this.game.learner.stats();
    const cell = (label, value) => `<div class="stat"><span>${label}</span><b>${value}</b></div>`;
    this.$('#b-stats').innerHTML =
      cell('BATTLES', s.battles) +
      cell('DECISIONS SEEN', s.turns) +
      cell('ACTION ACC', s.kindAcc === null ? '--' : Utils.pct(s.kindAcc)) +
      cell('MOVE ACC', s.moveAcc === null ? '--' : Utils.pct(s.moveAcc)) +
      cell('AI RECORD', `${s.aiWins}W-${s.aiLosses}L`);
    this.drawAccuracy();
  }

  refresh() {
    this.refreshStats();
    if (this.tab === 'memory') this.renderMemory();
  }

  chartCtx(id) {
    const c = this.$(id);
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    return { c, ctx };
  }

  drawAccuracy() {
    const { c, ctx } = this.chartCtx('#b-acc');
    const series = this.game.learner.accuracySeries();
    const W = c.width, H = c.height, pad = 14;
    ctx.strokeStyle = 'rgba(127,142,168,0.35)';
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(pad, H / 2);
    ctx.lineTo(W - pad, H / 2);
    ctx.stroke();
    ctx.setLineDash([]);
    if (series.kind.length < 2) {
      ctx.fillStyle = '#7f8ea8';
      ctx.font = '32px VT323';
      ctx.fillText('Accuracy appears after a few turns of battle.', pad, H / 2 - 14);
      return;
    }
    const line = (data, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      let started = false;
      data.forEach((v, i) => {
        if (v === null) return;
        const x = pad + (i / (data.length - 1)) * (W - pad * 2);
        const y = H - pad - v * (H - pad * 2);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      });
      ctx.stroke();
    };
    line(series.move, '#ff4fd8');
    line(series.kind, '#3ef0ff');
  }

  renderMemory() {
    const L = this.game.learner, d = L.data;

    // Transition heatmap: rows = previous action, columns = next action.
    {
      const { c, ctx } = this.chartCtx('#b-heat');
      const rows = ['^', ...ACTION_KINDS], cols = ACTION_KINDS;
      const short = { '^': 'start', attack: 'atk', status: 'stat', switch: 'swap', heal: 'heal', catch: 'ball', run: 'run' };
      const left = 96, top = 34, cw = (c.width - left - 8) / cols.length, ch = (c.height - top - 6) / rows.length;
      ctx.font = '22px VT323';
      ctx.fillStyle = '#7f8ea8';
      ctx.textAlign = 'center';
      cols.forEach((k, j) => ctx.fillText(short[k], left + cw * j + cw / 2, 24));
      rows.forEach((r, i) => {
        const counts = d.bigram[r] || {};
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        ctx.textAlign = 'right';
        ctx.fillStyle = '#7f8ea8';
        ctx.fillText(short[r], left - 10, top + ch * i + ch / 2 + 7);
        ctx.textAlign = 'center';
        cols.forEach((k, j) => {
          const p = total ? (counts[k] || 0) / total : 0;
          ctx.fillStyle = `rgba(62,240,255,${0.06 + p * 0.85})`;
          ctx.fillRect(left + cw * j + 2, top + ch * i + 2, cw - 4, ch - 4);
          if (total) {
            ctx.fillStyle = p > 0.5 ? '#04121a' : '#e6f1ff';
            ctx.fillText(Utils.pct(p), left + cw * j + cw / 2, top + ch * i + ch / 2 + 7);
          }
        });
      });
      ctx.textAlign = 'left';
    }

    // Heal rate by HP bucket.
    {
      const { c, ctx } = this.chartCtx('#b-heal');
      const n = 5, bw = (c.width - 20) / n, base = c.height - 30;
      ctx.font = '22px VT323';
      ctx.textAlign = 'center';
      d.healByHp.forEach(([h, o], i) => {
        const rate = o ? h / o : 0;
        const x = 10 + bw * i;
        ctx.fillStyle = 'rgba(96,240,128,0.15)';
        ctx.fillRect(x + 8, 10, bw - 16, base - 10);
        ctx.fillStyle = '#60f080';
        const bh = (base - 10) * rate;
        ctx.fillRect(x + 8, base - bh, bw - 16, bh);
        ctx.fillStyle = '#e6f1ff';
        ctx.fillText(o ? `${h}/${o}` : '-', x + bw / 2, Math.max(28, base - bh - 6));
        ctx.fillStyle = '#7f8ea8';
        ctx.fillText(Utils.bucketLabel(i), x + bw / 2, c.height - 6);
      });
      ctx.textAlign = 'left';
    }

    const moves = L.topMoves(6);
    const maxM = Math.max(1, ...moves.map(m => m.count));
    this.bars(this.$('#b-moves'), moves.length ? moves.map(m => ({
      label: `${Utils.pretty(m.move)} <small>${Utils.pretty(m.species)}</small>`, value: m.count / maxM, text: `${m.count}`,
    })) : [{ label: 'No attacks seen yet', value: 0, text: '' }]);

    const types = Object.entries(d.typeUsage).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const maxT = Math.max(1, ...types.map(t => t[1]));
    this.bars(this.$('#b-types'), types.length ? types.map(([t, n]) => ({
      label: Utils.pretty(t), value: n / maxT, text: `${n}`, color: TYPE_COLORS[t],
    })) : [{ label: 'No data yet', value: 0, text: '' }]);

    const qRows = [];
    for (const [state, kinds] of Object.entries(d.q)) {
      for (const [kind, cell] of Object.entries(kinds)) if (cell.n >= 2) qRows.push({ state, kind, ...cell });
    }
    qRows.sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
    this.$('#b-q').innerHTML = qRows.length ? qRows.slice(0, 8).map(r => `
      <div class="q-row"><span class="q-kind">${r.kind}</span><span class="q-state">${EnemyAI.describeState(r.state)}</span>
      <b class="${r.v >= 0 ? 'pos' : 'neg'}">${r.v >= 0 ? '+' : ''}${r.v.toFixed(2)}</b></div>`).join('')
      : '<div class="dim">NEMESIS learns which of its own tactics work after a few trainer battles.</div>';

    const fav = L.favouriteLead();
    const hist = d.battleLog.slice(-8).reverse().map(b => `
      <div class="h-row"><span>${Utils.escape(b.trainer)}</span><span class="h-${b.result}">${b.result.toUpperCase()}</span>
      <span>${b.acc === null ? '--' : Utils.pct(b.acc)} acc</span></div>`).join('');
    this.$('#b-history').innerHTML = (fav ? `<div class="dim">Favourite lead: <b>${Utils.escape(fav.label || Utils.pretty(fav.name))}</b> (${fav.n}x)</div>` : '') +
      (hist || '<div class="dim">No battles recorded.</div>');
  }
}
