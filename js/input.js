'use strict';

// Keyboard input. Keys are normalised to: up, down, left, right, confirm, cancel, menu.
// While the UI has an active dialog/menu, keys go to the UI instead of the overworld.
class Input {
  static KEYMAP = {
    ArrowUp: 'up', w: 'up', W: 'up',
    ArrowDown: 'down', s: 'down', S: 'down',
    ArrowLeft: 'left', a: 'left', A: 'left',
    ArrowRight: 'right', d: 'right', D: 'right',
    Enter: 'confirm', ' ': 'confirm', z: 'confirm', Z: 'confirm',
    Escape: 'cancel', x: 'cancel', X: 'cancel', Backspace: 'cancel',
    m: 'menu', M: 'menu',
  };
  static DIRS = ['up', 'down', 'left', 'right'];

  constructor(game) {
    this.game = game;
    this.held = [];          // held keys, most recent last
    this.pressed = new Set(); // edge-triggered presses for the overworld

    window.addEventListener('keydown', e => {
      const key = Input.KEYMAP[e.key];
      if (!key) return;
      e.preventDefault();
      game.sfx.audio(); // browsers only allow audio after a user gesture
      if (!this.held.includes(key)) this.held.push(key);
      if (game.ui.hasHandler()) {
        if (!e.repeat || Input.DIRS.includes(key)) game.ui.dispatch(key);
        return;
      }
      if (!e.repeat) this.pressed.add(key);
    });
    window.addEventListener('keyup', e => {
      const key = Input.KEYMAP[e.key];
      if (key) this.held = this.held.filter(k => k !== key);
    });
    window.addEventListener('blur', () => { this.held = []; this.pressed.clear(); });
  }

  consume(key) {
    if (!this.pressed.has(key)) return false;
    this.pressed.delete(key);
    return true;
  }

  heldDir() {
    for (let i = this.held.length - 1; i >= 0; i--) if (Input.DIRS.includes(this.held[i])) return this.held[i];
    return null;
  }

  clear() {
    this.pressed.clear();
  }
}
