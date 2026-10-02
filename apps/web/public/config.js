/* ============================================================
   SITE CONFIG — the only file you need to edit on the frontend.
   Token name / contract / economy live in the backend
   (worker/wrangler.toml) and are loaded from /api/config at runtime,
   so changing the token later does NOT require touching this file.
   ============================================================ */
window.ARCADE_CONFIG = {
  brand: 'PMT Arcade',

  // Where the API lives. '' = same site (pmtarcade.com/api/...), served by the same Worker.
  apiBase: '',

  // Firebase (Google) — used ONLY for sign-in. These keys are public by design.
  firebase: {
    apiKey: 'AIzaSyAOgqAHHRLTr_2f2GHOX1jempvveDj-Jnk',
    authDomain: 'pmt-arcade.firebaseapp.com',
    projectId: 'pmt-arcade',
    appId: '1:291853894238:web:b03d99ac1d4333c859eacf',
  },

  // Google AdSense. Game ads use the H5 Games Ads (Ad Placement API),
  // Pages use Auto ads (script in index.html / about.html). Games show ads between rounds.
  adsense: { client: 'ca-pub-1945002311764956', enabled: true },

  // Order here = order on the home page.
  games: [
    { id: 'neon-rush',     name: 'Neon Rush',     genre: 'Arcade',   emoji: '🚀', tag: 'Dodge & collect',  colors: ['#0ea5e9', '#7c3aed'], isNew: false },
    { id: 'fruit-rush',    name: 'Fruit Rush',    genre: 'Match-3',  emoji: '🍓', tag: 'Swap & match',     colors: ['#f43f5e', '#f59e0b'], isNew: false },
    { id: 'slide-puzzle',  name: 'Slide Puzzle',  genre: 'Puzzle',   emoji: '🧩', tag: 'Order the tiles',  colors: ['#14b8a6', '#0f766e'], isNew: false },
    { id: 'block-fit',     name: 'Block Fit',     genre: 'Puzzle',   emoji: '🟪', tag: 'Fill rows & cols', colors: ['#a855f7', '#6366f1'], isNew: true },
    { id: 'merge-2048',    name: '2048 Merge',    genre: 'Puzzle',   emoji: '🔢', tag: 'Slide & merge',    colors: ['#f59e0b', '#ea580c'], isNew: true },
    { id: 'tower-stack',   name: 'Tower Stack',   genre: 'One-tap',  emoji: '🏗️', tag: 'Tap to stack',     colors: ['#ec4899', '#8b5cf6'], isNew: true },
    { id: 'bubble-pop',    name: 'Bubble Pop',    genre: 'Shooter',  emoji: '🫧', tag: 'Aim & pop',        colors: ['#06b6d4', '#3b82f6'], isNew: true },
    { id: 'brick-breaker', name: 'Brick Breaker', genre: 'Arcade',   emoji: '🧱', tag: 'Bounce & break',   colors: ['#22c55e', '#0891b2'], isNew: true },
    { id: 'color-sort',    name: 'Color Sort',    genre: 'Puzzle',   emoji: '🧪', tag: 'Pour & sort',      colors: ['#f472b6', '#6366f1'], isNew: true },
    { id: 'sky-hop',       name: 'Sky Hop',       genre: 'One-tap',  emoji: '🐤', tag: 'Tap to fly',       colors: ['#38bdf8', '#16a34a'], isNew: true },
    { id: 'knife-throw',   name: 'Knife Throw',   genre: 'One-tap',  emoji: '🔪', tag: 'Hit the log',      colors: ['#b45309', '#7c2d12'], isNew: true },
    { id: 'fruit-slice',   name: 'Fruit Slice',   genre: 'Action',   emoji: '🍉', tag: 'Swipe to slice',   colors: ['#ef4444', '#16a34a'], isNew: true },
    { id: 'snake-arena',   name: 'Snake Arena',   genre: 'Arcade',   emoji: '🐍', tag: 'Eat & grow',       colors: ['#22c55e', '#14532d'], isNew: true },
    { id: 'bounce-up',     name: 'Bounce Up',     genre: 'Arcade',   emoji: '🦘', tag: 'Jump higher',      colors: ['#db2777', '#4c1d95'], isNew: true },
    { id: 'rhythm-tiles',  name: 'Rhythm Tiles',  genre: 'Music',    emoji: '🎹', tag: 'Tap the beat',     colors: ['#0f172a', '#6366f1'], isNew: true },
    { id: 'learn-english', name: 'Learn English', genre: 'Learning', emoji: '📚', tag: 'বাংলা → English',  colors: ['#14b8a6', '#0e7490'], isNew: true },
  ],
};
