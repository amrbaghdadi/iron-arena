import { Game } from './game.js';

const params = new URLSearchParams(location.search);
const game = new Game(params);
window.game = game; // handy for debugging in the console

window.addEventListener('error', (e) => {
  const t = document.getElementById('loadtext'); if (t && game.state === 'loading') t.textContent = 'Error: ' + e.message;
});
game.init().catch((err) => {
  console.error(err);
  const t = document.getElementById('loadtext'); if (t) t.textContent = 'Failed to start: ' + err.message + '. Open the game through a local web server (see README) and check your internet connection (Three.js loads from a CDN).';
});
