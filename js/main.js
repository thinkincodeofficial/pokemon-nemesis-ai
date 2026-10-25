'use strict';

// Scales the fixed-size layout (game + brain panel) to fit the browser window.
function fitApp() {
  const app = document.getElementById('app');
  const w = 960 + 16 + 400 + 32, h = 640 + 70;
  const scale = Math.min(window.innerWidth / w, window.innerHeight / h, 1.5);
  app.style.setProperty('--scale', scale.toFixed(3));
}

window.addEventListener('resize', fitApp);
window.addEventListener('load', () => {
  fitApp();
  window.game = new Game();
  window.game.boot();
});
