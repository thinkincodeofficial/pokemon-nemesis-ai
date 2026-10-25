'use strict';

/**
 * DOM user interface: typewriter dialog box, keyboard/mouse menus, party/bag/summary screens,
 * toasts and the region banner. Every interaction is a Promise so game scripts read top-to-bottom.
 * A handler stack routes keys to whichever dialog/menu is on top.
 */
class UI {
  constructor(game) {
    this.game = game;
    this.wrap = document.getElementById('game-wrap');
    this.dialog = document.getElementById('dialog');
    this.textEl = document.getElementById('dialog-text');
    this.arrow = document.getElementById('dialog-arrow');
    this.layer = document.getElementById('menu-layer');
    this.toastLayer = document.getElementById('toast-layer');
    this.banner = document.getElementById('banner');
    this.handlers = [];
    this.bannerTimer = null;
    this.dialog.addEventListener('click', () => {
      const top = this.handlers[this.handlers.length - 1];
      if (top && top.isDialog) top('confirm');
    });
  }

  hasHandler() { return this.handlers.length > 0; }
  pushHandler(fn) { this.handlers.push(fn); }
  popHandler(fn) {
    const i = this.handlers.lastIndexOf(fn);
    if (i >= 0) this.handlers.splice(i, 1);
  }
  dispatch(key) {
    const top = this.handlers[this.handlers.length - 1];
    if (top) top(key);
  }

  setBattleMode(on) {
    this.wrap.classList.toggle('battle-mode', on);
  }

  // ---------------------------------------------------------------- dialog

  // Typewriter text. Resolves when the player confirms (or after `hold` ms when auto).
  say(text, { auto = false, hold = CONFIG.BATTLE_TEXT_HOLD } = {}) {
    return new Promise(resolve => {
      this.dialog.classList.remove('hidden', 'narrow');
      this.arrow.style.display = 'none';
      const full = String(text);
      let shown = 0, done = false, autoTimer = null;
      this.textEl.textContent = '';
      const complete = () => {
        if (done) return;
        done = true;
        clearInterval(timer);
        this.textEl.textContent = full;
        if (auto) autoTimer = setTimeout(finish, hold);
        else this.arrow.style.display = 'block';
      };
      const finish = () => {
        clearInterval(timer);
        clearTimeout(autoTimer);
        this.popHandler(handler);
        this.arrow.style.display = 'none';
        resolve();
      };
      const timer = setInterval(() => {
        shown += 2;
        this.textEl.textContent = full.slice(0, shown);
        if (shown >= full.length) complete();
      }, 2000 / CONFIG.TEXT_CPS);
      const handler = key => {
        if (key !== 'confirm' && key !== 'cancel') return;
        if (!done) complete();
        else finish();
      };
      handler.isDialog = true;
      this.pushHandler(handler);
    });
  }

  // Shows text instantly without waiting (e.g. "What will X do?").
  sayStatic(text) {
    this.dialog.classList.remove('hidden');
    this.arrow.style.display = 'none';
    this.textEl.textContent = text;
  }

  closeDialog() {
    this.dialog.classList.add('hidden');
    this.dialog.classList.remove('narrow');
    this.textEl.textContent = '';
  }

  // Question + choice menu. Resolves with the chosen index (-1 on cancel).
  async ask(question, options, { cancel = true } = {}) {
    await this.say(question, { auto: true, hold: 0 });
    return this.menu({ items: options.map(label => ({ label })), anchor: 'above', cancel });
  }

  async confirm(question) {
    return (await this.ask(question, ['YES', 'NO'])) === 0;
  }

  // ---------------------------------------------------------------- menus

  menu({ items, title = null, columns = 1, cancel = true, anchor = 'above', cls = '', initial = 0, onFocus = null, extra = null }) {
    return new Promise(resolve => {
      const box = document.createElement('div');
      box.className = `menu anchor-${anchor} ${cls}`;
      if (title) {
        const t = document.createElement('div');
        t.className = 'menu-title';
        t.innerHTML = title;
        box.appendChild(t);
      }
      const grid = document.createElement('div');
      grid.className = 'menu-grid';
      grid.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
      box.appendChild(grid);
      if (extra) box.appendChild(extra);

      let sel = Utils.clamp(initial, 0, items.length - 1);
      const nodes = items.map((it, i) => {
        const n = document.createElement('div');
        n.className = 'menu-item' + (it.disabled ? ' disabled' : '');
        if (it.html !== undefined) n.innerHTML = it.html;
        else n.textContent = it.label;
        n.addEventListener('mouseenter', () => focus(i, true));
        n.addEventListener('click', e => { e.stopPropagation(); focus(i, true); pick(); });
        grid.appendChild(n);
        return n;
      });
      const focus = (i, quiet = false) => {
        if (i === sel && nodes[i].classList.contains('selected')) return;
        sel = i;
        nodes.forEach((n, j) => n.classList.toggle('selected', j === i));
        nodes[i].scrollIntoView({ block: 'nearest' });
        if (!quiet) this.game.sfx.play('cursor');
        if (onFocus) onFocus(i, items[i]);
      };
      const finish = v => {
        this.popHandler(handler);
        box.remove();
        resolve(v);
      };
      const pick = () => {
        if (items[sel].disabled) { this.game.sfx.play('error'); return; }
        this.game.sfx.play('select');
        finish(sel);
      };
      const handler = key => {
        const n = items.length;
        if (key === 'up') {
          if (sel - columns >= 0) focus(sel - columns);
          else if (columns === 1) focus(n - 1);
        } else if (key === 'down') {
          if (sel + columns < n) focus(sel + columns);
          else if (columns === 1) focus(0);
        } else if (key === 'left') {
          if (columns > 1 && sel % columns > 0) focus(sel - 1);
        } else if (key === 'right') {
          if (columns > 1 && sel % columns < columns - 1 && sel + 1 < n) focus(sel + 1);
        } else if (key === 'confirm') pick();
        else if (key === 'cancel' && cancel) {
          this.game.sfx.play('cancel');
          finish(-1);
        }
      };
      this.pushHandler(handler);
      this.layer.appendChild(box);
      nodes.forEach((n, j) => n.classList.toggle('selected', j === sel));
      if (onFocus) onFocus(sel, items[sel]);
    });
  }

  battleMenu(canRun) {
    this.dialog.classList.add('narrow');
    return this.menu({
      items: [{ label: 'FIGHT' }, { label: 'BAG' }, { label: 'POKéMON' }, { label: 'RUN', disabled: !canRun }],
      columns: 2, cancel: false, anchor: 'battle', cls: 'battle-menu', initial: this.lastBattleChoice || 0,
    }).then(i => {
      this.lastBattleChoice = i;
      this.dialog.classList.remove('narrow');
      return i;
    });
  }

  moveMenu(mon, foe) {
    const info = document.createElement('div');
    info.className = 'move-info';
    const items = mon.moves.map(m => ({
      html: `<span class="type-dot" style="background:${TYPE_COLORS[m.type]}"></span>${Utils.escape(m.displayName)}`,
      disabled: m.pp <= 0,
    }));
    while (items.length < 4) items.push({ label: '-', disabled: true });
    return this.menu({
      items, columns: 2, anchor: 'moves', cls: 'move-menu', extra: info,
      onFocus: i => {
        const m = mon.moves[i];
        if (!m) { info.innerHTML = ''; return; }
        const eff = m.isDamaging ? TypeChart.effectiveness(m.type, foe.types) : null;
        const effCls = eff === null ? '' : eff === 0 ? 'none' : eff > 1 ? 'super' : eff < 1 ? 'weak' : 'normal';
        info.innerHTML = `
          <div class="mi-row"><span class="type-pill" style="background:${TYPE_COLORS[m.type]}">${m.type.toUpperCase()}</span><span>PP ${m.pp}/${m.maxPp}</span></div>
          <div class="mi-row"><span>${m.isDamaging ? `POW ${m.power}` : 'STATUS'}</span><span>ACC ${m.accuracy ?? '--'}</span></div>
          ${eff !== null ? `<div class="mi-eff ${effCls}">${TypeChart.label(eff)}</div>` : '<div class="mi-eff">&nbsp;</div>'}`;
      },
    });
  }

  monRowHtml(m) {
    const icon = m.data.sprites.icon || m.data.sprites.front;
    const frac = m.hpFrac;
    const tag = m.fainted ? '<span class="status-tag fnt">FNT</span>'
      : m.status ? `<span class="status-tag" style="background:${STATUS_COLOR[m.status]}">${STATUS_TAG[m.status]}</span>` : '';
    const types = m.types.map(t => `<span class="type-pill sm" style="background:${TYPE_COLORS[t]}">${t}</span>`).join('');
    return `<div class="mon-row${m.fainted ? ' fainted' : ''}">
      <img class="mon-icon" src="${icon}" alt="" onerror="this.style.visibility='hidden'">
      <div class="mon-main">
        <div class="mon-name">${Utils.escape(m.displayName)} <span class="lv">Lv${m.level}</span> ${tag}</div>
        <div class="mon-types">${types}</div>
        <div class="hp-track"><div class="hp-fill" style="width:${frac * 100}%;background:${Utils.hpColor(frac)}"></div></div>
      </div>
      <div class="mon-hp">${m.hp}/${m.maxHp}</div>
    </div>`;
  }

  partyMenu(party, { title = 'Your Pokémon', forced = false } = {}) {
    return this.menu({ title, items: party.map(m => ({ html: this.monRowHtml(m) })), anchor: 'center', cls: 'party-menu', cancel: !forced });
  }

  async bagMenu(bag) {
    const keys = Object.keys(ITEMS).filter(k => (bag[k] || 0) > 0);
    if (!keys.length) {
      await this.say('Your bag is empty.', { auto: true });
      return null;
    }
    const i = await this.menu({
      title: 'BAG',
      items: keys.map(k => ({
        html: `<div class="item-row"><img src="${itemSprite(k)}" alt="" onerror="this.style.visibility='hidden'"><span>${ITEMS[k].name}</span><span class="count">x${bag[k]}</span></div>`,
      })),
      anchor: 'center', cls: 'bag-menu',
    });
    return i < 0 ? null : keys[i];
  }

  summary(mon) {
    return new Promise(resolve => {
      const box = document.createElement('div');
      box.className = 'menu anchor-center summary';
      const statRows = STAT_KEYS.map(k => {
        const v = mon.stats[k];
        return `<div class="st-row"><span>${STAT_LABEL[k]}</span><div class="st-track"><div style="width:${Math.min(100, (v / (mon.level * 3 + 20)) * 100)}%"></div></div><b>${v}</b></div>`;
      }).join('');
      const moves = mon.moves.map(m => `<div class="sm-move"><span class="type-pill sm" style="background:${TYPE_COLORS[m.type]}">${m.type}</span>${Utils.escape(m.displayName)}<span class="pp">${m.isDamaging ? `POW ${m.power} · ` : ''}PP ${m.pp}/${m.maxPp}</span></div>`).join('');
      box.innerHTML = `
        <div class="sum-head">
          <img src="${mon.data.sprites.front}" alt="" onerror="this.style.visibility='hidden'">
          <div>
            <div class="sum-name">${Utils.escape(mon.displayName)} <span class="lv">Lv${mon.level}</span></div>
            <div>${mon.types.map(t => `<span class="type-pill" style="background:${TYPE_COLORS[t]}">${t}</span>`).join(' ')}</div>
            <div class="sum-sub">${Utils.escape(mon.species.genus || '')}</div>
            <div class="sum-sub">HP ${mon.hp}/${mon.maxHp} · EXP to next: ${mon.expToNext}</div>
          </div>
        </div>
        <div class="sum-flavor">${Utils.escape(mon.species.flavor || '')}</div>
        <div class="sum-cols"><div class="sum-stats">${statRows}</div><div class="sum-moves">${moves}</div></div>
        <div class="sum-hint">Press Z / Enter to close</div>`;
      const handler = k => {
        if (k !== 'confirm' && k !== 'cancel') return;
        this.popHandler(handler);
        box.remove();
        resolve();
      };
      box.addEventListener('click', () => handler('confirm'));
      this.pushHandler(handler);
      this.layer.appendChild(box);
    });
  }

  // ---------------------------------------------------------------- misc

  toast(text) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    this.toastLayer.appendChild(t);
    setTimeout(() => t.classList.add('out'), 1900);
    setTimeout(() => t.remove(), 2400);
  }

  showBanner(text) {
    this.banner.textContent = text;
    this.banner.classList.remove('hidden');
    this.banner.classList.remove('show');
    void this.banner.offsetWidth; // restart CSS animation
    this.banner.classList.add('show');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => this.banner.classList.add('hidden'), 2600);
  }
}
