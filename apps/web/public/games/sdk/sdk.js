/* ============================================================
   ARCADE GAME SDK
   Gives every game: top bar, start/pause/game-over screens, sounds,
   confetti, best score, canvas fitting, ads, and the secure link to
   the hub (the hub talks to the backend; games never touch balances).
   ============================================================ */
(function () {
  'use strict';
  const CFG = window.ARCADE_CONFIG || { games: [] };
  const inHub = window.parent !== window;
  const $ = (sel, root = document) => root.querySelector(sel);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } },
  };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // English / Bangla: follows the site's language switch (localStorage "lang", same origin as the app)
  const LANG = (() => {
    try { const l = localStorage.getItem('lang'); if (l === 'bn' || l === 'en') return l; } catch { /* storage blocked */ }
    return (navigator.language || '').toLowerCase().startsWith('bn') ? 'bn' : 'en';
  })();
  const L = (s) => (LANG === 'bn' && BN[s]) || s;
  if (LANG === 'bn') document.documentElement.lang = 'bn';
  /** Bangla for the SDK screens and every game's how-to text, titles and stat labels (keyed by the English text). */
  const BN = {
    "Back to menu": "মেনুতে ফিরুন",
    "Menu": "মেনু",
    "Score": "স্কোর",
    "Best": "সেরা",
    "Sound": "শব্দ",
    "Pause": "বিরতি",
    "Full screen": "পূর্ণ পর্দা",
    "Playing for fun.": "মজা করে খেলছেন।",
    "Open it on PMT Arcade": "PMT Arcade-এ খুলুন",
    "and sign in to earn PMT.": "আর PMT আয় করতে সাইন ইন করুন।",
    "Sign in on PMT Arcade to earn PMT for your scores.": "স্কোরের জন্য PMT পেতে PMT Arcade-এ সাইন ইন করুন।",
    "Play": "খেলুন",
    "Your best:": "আপনার সেরা:",
    "Paused": "বিরতি",
    "Resume": "আবার শুরু",
    "Restart": "নতুন করে শুরু",
    "Game Over": "খেলা শেষ",
    "NEW BEST": "নতুন রেকর্ড",
    "Saving your score…": "আপনার স্কোর সংরক্ষণ হচ্ছে…",
    "Play again": "আবার খেলুন",
    "PMT earned": "PMT পেয়েছেন",
    "No PMT this time. Score higher to earn!": "এবার PMT পাননি। আরও বেশি স্কোর করুন!",
    "Could not reach the server. Your score was not saved.": "সার্ভারে পৌঁছানো যায়নি। আপনার স্কোর সংরক্ষিত হয়নি।",
    "timeout": "সার্ভার সাড়া দিচ্ছে না। আপনার স্কোর সংরক্ষিত হয়নি।",
    "Drag any of the 3 blocks onto the 8×8 board.": "৩টি ব্লকের যেকোনোটি টেনে ৮×৮ বোর্ডে বসান।",
    "Fill a full <b>row</b> or <b>column</b> to clear it.": "পুরো একটি <b>সারি</b> বা <b>কলাম</b> পূরণ করলে তা মুছে যায়।",
    "Clear several lines in a row for a <b>combo</b> bonus.": "পরপর কয়েকটি লাইন মুছলে <b>কম্বো</b> বোনাস।",
    "The game ends when no block fits.": "কোনো ব্লক আর না বসলে খেলা শেষ।",
    "Drag blocks onto the board. Fill a row or column to clear it.": "ব্লক টেনে বোর্ডে বসান। সারি বা কলাম পূরণ করে মুছে ফেলুন।",
    "No more moves": "আর চাল নেই",
    "Lines": "লাইন",
    "Pieces": "টুকরো",
    "Combo": "কম্বো",
    "<b>Hold the left or right side</b> of the screen (or arrow keys) to move.": "সরতে স্ক্রিনের <b>বাম বা ডান পাশ চেপে ধরুন</b> (অথবা অ্যারো কী)।",
    "You bounce automatically. Land on platforms to keep climbing.": "আপনি নিজে থেকেই লাফাবেন। উপরে উঠতে প্ল্যাটফর্মে নামুন।",
    "<b>Blue</b> platforms move, <b>yellow</b> ones break, springs launch you high.": "<b>নীল</b> প্ল্যাটফর্ম নড়ে, <b>হলুদ</b>গুলো ভেঙে যায়, স্প্রিং আপনাকে অনেক উঁচুতে তোলে।",
    "Go off one side to appear on the other. Don’t fall!": "এক পাশ দিয়ে বের হলে অন্য পাশে আসবেন। পড়ে যাবেন না!",
    "Bounce from platform to platform. How high can you go?": "এক প্ল্যাটফর্ম থেকে আরেকটিতে লাফান। কত উঁচুতে যেতে পারেন?",
    "You fell!": "আপনি পড়ে গেছেন!",
    "Height": "উচ্চতা",
    "<b>Drag</b> (or arrow keys / mouse) to move the paddle.": "প্যাডেল সরাতে <b>টানুন</b> (অথবা অ্যারো কী / মাউস)।",
    "Where the ball hits the paddle sets its <b>angle</b>.": "বল প্যাডেলের কোথায় লাগে তার ওপর বলের <b>কোণ</b> নির্ভর করে।",
    "Catch power-ups: ↔ wide, ✦ multi-ball, ⏱ slow, ♥ life.": "পাওয়ার-আপ ধরুন: ↔ চওড়া, ✦ অনেক বল, ⏱ ধীর, ♥ জীবন।",
    "Grey steel bricks can’t be broken. You have 3 lives.": "ধূসর স্টিলের ইট ভাঙে না। আপনার ৩টি জীবন আছে।",
    "Bounce the ball, break every brick, catch power-ups.": "বল লাফান, সব ইট ভাঙুন, পাওয়ার-আপ ধরুন।",
    "Out of lives": "জীবন শেষ",
    "Level": "লেভেল",
    "Bricks": "ইট",
    "Lives": "জীবন",
    "<b>Drag</b> to aim, release to shoot. Bounce off the walls!": "নিশানা করতে <b>টানুন</b>, ছাড়লে ছুটবে। দেয়ালে লাগিয়ে বাঁকান!",
    "Connect <b>3+ bubbles</b> of the same colour to pop them.": "একই রঙের <b>৩+ বাবল</b> মেলালে ফেটে যায়।",
    "Bubbles cut off from the top <b>fall</b> for big points.": "উপর থেকে বিচ্ছিন্ন বাবল <b>পড়ে যায়</b> — অনেক পয়েন্ট।",
    "Every 5 misses a new row drops. Don’t let them reach the line.": "প্রতি ৫ বার মিস করলে নতুন সারি নামে। লাইনে পৌঁছাতে দেবেন না।",
    "Tap the <b>next</b> bubble to swap it.": "বদলাতে <b>পরের</b> বাবলে ট্যাপ করুন।",
    "Aim, bounce and pop groups of 3 or more.": "নিশানা করুন, বাঁকান, ৩ বা তার বেশি একসাথে ফাটান।",
    "Bubbles reached the line": "বাবল লাইনে পৌঁছে গেছে",
    "Popped": "ফাটানো",
    "<b>Tap</b> a tube, then tap another to pour.": "একটি টিউবে <b>ট্যাপ</b> করুন, তারপর আরেকটিতে ট্যাপ করে ঢালুন।",
    "You can pour onto the <b>same colour</b> or into an empty tube.": "<b>একই রঙের</b> ওপর বা খালি টিউবে ঢালা যায়।",
    "Fill every tube with one colour to clear the level. Each level gets harder.": "প্রতিটি টিউবে একটি রঙ রাখলে লেভেল পার। প্রতি লেভেল আরও কঠিন।",
    "Tap <b>Finish & save</b> any time after level 1 to keep your score.": "লেভেল ১-এর পর যেকোনো সময় <b>Finish & save</b> চাপলে স্কোর থাকবে।",
    "Sort the colours so every tube holds just one.": "রঙগুলো এমনভাবে সাজান যেন প্রতিটি টিউবে একটিই রঙ থাকে।",
    "Well sorted!": "চমৎকার সাজিয়েছেন!",
    "Levels": "লেভেল",
    "Reached": "পৌঁছেছেন",
    "<b>Swipe</b> a fruit (or tap two) to swap neighbours and make lines of 3+.": "ফল <b>সোয়াইপ</b> করুন (বা দুটিতে ট্যাপ করুন) — পাশাপাশি বদলে ৩+ এর লাইন বানান।",
    "Match 4 makes a <b>line blaster</b>, an L/T shape makes a <b>bomb</b>, 5 in a row makes a <b>rainbow</b>.": "৪টি মেলালে <b>লাইন ব্লাস্টার</b>, L/T আকারে <b>বোমা</b>, পরপর ৫টিতে <b>রংধনু</b>।",
    "Reach the level goal for <b>+10 moves</b>. Swaps that don’t match are free.": "লেভেলের লক্ষ্য পূরণ করলে <b>+১০ চাল</b>। না মেলা বদলে চাল কাটে না।",
    "Use the 🔪 <b>knife</b> (3 per game) to cut any fruit without using a move.": "🔪 <b>ছুরি</b> দিয়ে (প্রতি গেমে ৩টি) চাল খরচ না করে যেকোনো ফল কাটুন।",
    "Swap fruits, make matches, reach each level goal.": "ফল বদলান, মেলান, প্রতিটি লেভেলের লক্ষ্য পূরণ করুন।",
    "Out of moves": "চাল শেষ",
    "Fruits": "ফল",
    "Best chain": "সেরা চেইন",
    "Moves": "চাল",
    "<b>Swipe</b> across the screen to slice flying fruit.": "উড়ন্ত ফল কাটতে স্ক্রিনে <b>সোয়াইপ</b> করুন।",
    "Slice 3 or more in one swipe for a <b>combo</b> bonus.": "এক সোয়াইপে ৩ বা বেশি কাটলে <b>কম্বো</b> বোনাস।",
    "Touching a 💣 bomb ends the game.": "💣 বোমা ছুঁলেই খেলা শেষ।",
    "Let 3 fruits fall and it’s over.": "৩টি ফল পড়ে গেলে খেলা শেষ।",
    "Swipe to slice the fruit. Never touch the bombs!": "সোয়াইপ করে ফল কাটুন। বোমা কখনো ছোঁবেন না!",
    "<b>Tap</b> to throw a knife into the spinning log.": "ঘুরন্ত কাঠে ছুরি ছুড়তে <b>ট্যাপ</b> করুন।",
    "Hit another knife and it’s game over.": "অন্য ছুরিতে লাগলে খেলা শেষ।",
    "Throw all your knives to clear the stage. Hit 🍎 apples for +5.": "সব ছুরি ছুড়লে স্টেজ পার। 🍎 আপেলে লাগলে +৫।",
    "Every 5th stage is a <b>boss</b> log that spins faster.": "প্রতি ৫ম স্টেজে <b>বস</b> কাঠ — আরও দ্রুত ঘোরে।",
    "Tap to throw. Don’t hit the other knives!": "ট্যাপ করে ছুড়ুন। অন্য ছুরিতে লাগাবেন না!",
    "Clang!": "ঠং!",
    "Stage": "স্টেজ",
    "Knives": "ছুরি",
    "Apples": "আপেল",
    "Tap <b>🔊</b> to hear how the English word sounds.": "ইংরেজি শব্দের উচ্চারণ শুনতে <b>🔊</b> ট্যাপ করুন।",
    "Answer fast for bonus points. Correct answers in a row give a <b>streak</b> bonus.": "দ্রুত উত্তর দিলে বোনাস পয়েন্ট। পরপর সঠিক উত্তরে <b>স্ট্রিক</b> বোনাস।",
    "3 wrong answers and the round ends. Pick a topic below.": "৩টি ভুল উত্তরে রাউন্ড শেষ। নিচ থেকে একটি বিষয় বেছে নিন।",
    "Great practice!": "দারুণ অনুশীলন!",
    "Correct": "সঠিক",
    "Best streak": "সেরা স্ট্রিক",
    "<b>Swipe</b> (or arrow keys) to slide every tile.": "সব টাইল সরাতে <b>সোয়াইপ</b> করুন (অথবা অ্যারো কী)।",
    "Two equal tiles that touch <b>merge</b> into one.": "সমান দুটি টাইল ছুঁলে <b>মিলে</b> একটি হয়।",
    "Each merge adds its value to your score.": "প্রতিটি মিলনের মান আপনার স্কোরে যোগ হয়।",
    "The game ends when the board is full and nothing can merge.": "বোর্ড ভরে গেলে আর কিছু মিলাতে না পারলে খেলা শেষ।",
    "Slide the tiles. Merge equal numbers. Reach 2048!": "টাইল সরান। সমান সংখ্যা মেলান। 2048-এ পৌঁছান!",
    "Best tile": "সেরা টাইল",
    "Tile": "টাইল",
    "<b>Drag anywhere</b> to fly (or arrow keys). The jet follows your finger movement.": "উড়তে <b>যেকোনো জায়গায় টানুন</b> (অথবা অ্যারো কী)। জেট আপনার আঙুল অনুসরণ করে।",
    "Dodge rocks, <b>red drones</b> and <b>laser gates</b>. Fly through the gap!": "পাথর, <b>লাল ড্রোন</b> আর <b>লেজার গেট</b> এড়িয়ে চলুন। ফাঁক দিয়ে উড়ুন!",
    "Coins are worth 25 points each. Distance adds up too.": "প্রতিটি কয়েন ২৫ পয়েন্ট। দূরত্বেও পয়েন্ট বাড়ে।",
    "Grab ⛨ <b>shield</b> (blocks one hit) and U <b>magnet</b> power-ups.": "⛨ <b>ঢাল</b> (একবার আঘাত আটকায়) আর U <b>চুম্বক</b> পাওয়ার-আপ নিন।",
    "Fly through the neon city. Dodge everything, grab the coins.": "নিয়ন শহরের মধ্য দিয়ে উড়ুন। সব এড়িয়ে কয়েন ধরুন।",
    "Crashed!": "ধাক্কা লেগেছে!",
    "Distance": "দূরত্ব",
    "Coins": "কয়েন",
    "<b>Tap only the black tiles</b>, from the bottom up. Each tap plays the next note.": "নিচ থেকে উপরে <b>শুধু কালো টাইলে ট্যাপ করুন</b>। প্রতিটি ট্যাপে পরের সুর বাজে।",
    "Tap the first tile to start. The tiles speed up as you go.": "শুরু করতে প্রথম টাইলে ট্যাপ করুন। এগোলে টাইলের গতি বাড়ে।",
    "Tapping a white tile or missing a black one ends the game.": "সাদা টাইলে ট্যাপ করলে বা কালো টাইল মিস করলে খেলা শেষ।",
    "On a keyboard use <b>D F J K</b>.": "কিবোর্ডে <b>D F J K</b> ব্যবহার করুন।",
    "Tap the black tiles in order and play the song.": "ক্রমানুসারে কালো টাইলে ট্যাপ করে গান বাজান।",
    "Tiles": "টাইল",
    "Song": "গান",
    "Speed": "গতি",
    "<b>Tap</b> anywhere (or press Space) to flap upward.": "উপরে উঠতে যেকোনো জায়গায় <b>ট্যাপ</b> করুন (অথবা Space চাপুন)।",
    "Fly through the gaps between the pipes.": "পাইপগুলোর ফাঁক দিয়ে উড়ুন।",
    "Every pipe you pass is <b>+1</b>. It gets faster as you go.": "প্রতিটি পাইপ পার হলে <b>+১</b>। এগোলে গতি বাড়ে।",
    "Medals at 10, 20 and 40 pipes.": "১০, ২০ ও ৪০ পাইপে মেডেল।",
    "Tap to flap. Fly through the gaps. How far can you go?": "ট্যাপ করে ডানা ঝাপটান। ফাঁক দিয়ে উড়ুন। কত দূর যেতে পারেন?",
    "Ouch!": "উফ!",
    "Pipes": "পাইপ",
    "Medal": "মেডেল",
    "<b>Tap</b> a tile in the same row or column as the gap to slide it.": "ফাঁকা ঘরের একই সারি বা কলামের টাইলে <b>ট্যাপ</b> করলে তা সরে যায়।",
    "Put the numbers in order, 1 in the top-left, with the gap last.": "সংখ্যাগুলো ক্রমানুসারে সাজান — ১ উপরে বামে, ফাঁকা ঘর শেষে।",
    "Tiles glow when they reach their home spot.": "টাইল সঠিক জায়গায় পৌঁছালে জ্বলে ওঠে।",
    "Fewer moves means a <b>higher score</b>. Bigger boards pay more.": "কম চালে <b>বেশি স্কোর</b>। বড় বোর্ডে বেশি পাবেন।",
    "Slide the tiles back into order.": "টাইলগুলো সরিয়ে আবার ক্রমানুসারে সাজান।",
    "Solved!": "সমাধান হয়েছে!",
    "Size": "আকার",
    "Time": "সময়",
    "<b>Swipe</b> (or arrow keys) to turn the snake.": "সাপ ঘোরাতে <b>সোয়াইপ</b> করুন (অথবা অ্যারো কী)।",
    "Each 🍎 apple is +10 and makes you longer and faster.": "প্রতিটি 🍎 আপেলে +১০, আর সাপ লম্বা ও দ্রুত হয়।",
    "A <b>golden apple</b> appears every 5 apples: +30, but it vanishes fast!": "প্রতি ৫টি আপেলে একটি <b>সোনালি আপেল</b>: +৩০, তবে দ্রুত হারিয়ে যায়!",
    "Hitting a wall or your own tail ends the game.": "দেয়ালে বা নিজের লেজে লাগলে খেলা শেষ।",
    "Eat apples, grow longer, don’t bite yourself!": "আপেল খান, লম্বা হন, নিজেকে কামড়াবেন না!",
    "Length": "দৈর্ঘ্য",
    "A block slides back and forth. <b>Tap</b> to drop it.": "একটি ব্লক এদিক-ওদিক নড়ে। ফেলতে <b>ট্যাপ</b> করুন।",
    "Anything hanging over the edge is <b>cut off</b>.": "কিনারার বাইরে ঝুলে থাকা অংশ <b>কেটে যায়</b>।",
    "Land it exactly for a <b>PERFECT</b>. 3 in a row makes the block grow back.": "ঠিক ঠিক বসালে <b>PERFECT</b>। পরপর ৩টিতে ব্লক আবার বড় হয়।",
    "Miss the tower completely and it’s over.": "টাওয়ার পুরোপুরি মিস করলে খেলা শেষ।",
    "Tap at the right moment to build the tallest tower.": "সঠিক মুহূর্তে ট্যাপ করে সবচেয়ে উঁচু টাওয়ার বানান।",
    "Tower fell!": "টাওয়ার পড়ে গেছে!",
    "Perfect": "নিখুঁত",
  };

  let opts = null, meta = null;
  let state = 'idle'; // idle | playing | paused | over
  let score = 0, best = 0;
  let muted = store.get('arcade.muted', false);
  let hub = { signedIn: false, name: null };
  // Google Play edition of the app: games are just for fun there — no PMT rewards and no ads
  const PLAY_EDITION = (() => { try { return sessionStorage.getItem('arena.edition') === 'play'; } catch (e) { return false; } })();
  let runPromise = null;
  let lastBump = 0;
  let ui = {};

  /* ---------------- Hub messaging ---------------- */
  let reqId = 0;
  const waiting = new Map();
  function post(type, data = {}) { if (inHub) window.parent.postMessage({ src: 'arcade-game', type, game: opts && opts.id, ...data }, '*'); }
  function ask(type, data, timeout = 15000) {
    if (!inHub) return Promise.resolve({ error: 'standalone' });
    const id = ++reqId;
    return new Promise((resolve) => {
      const t = setTimeout(() => { waiting.delete(id); resolve({ error: 'timeout' }); }, timeout);
      waiting.set(id, (msg) => { clearTimeout(t); resolve(msg); });
      post(type, { reqId: id, ...data });
    });
  }
  window.addEventListener('message', (e) => {
    if (e.source !== window.parent) return;
    const m = e.data;
    if (!m || m.src !== 'arcade-hub') return;
    if (m.replyTo && waiting.has(m.replyTo)) { waiting.get(m.replyTo)(m); waiting.delete(m.replyTo); return; }
    if (m.type === 'hello' || m.type === 'auth') { hub.signedIn = !!m.signedIn; hub.name = m.name || null; refreshStartNote(); }
    if (m.type === 'pause' && state === 'playing') pause();
  });

  /* ---------------- Sound (synthesised, no files) ---------------- */
  let ac = null;
  function audio() {
    if (!ac) { const A = window.AudioContext || window.webkitAudioContext; if (!A) return null; ac = new A(); }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }
  function tone(freq, dur, type = 'sine', vol = 0.12, slideTo = null, delay = 0) {
    if (muted) return;
    const a = audio(); if (!a) return;
    const t0 = a.currentTime + delay;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(a.destination); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function noise(dur = 0.2, vol = 0.12, hp = 800) {
    if (muted) return;
    const a = audio(); if (!a) return;
    const buf = a.createBuffer(1, a.sampleRate * dur, a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    f.type = 'highpass'; f.frequency.value = hp; g.gain.value = vol;
    s.buffer = buf; s.connect(f).connect(g).connect(a.destination); s.start();
  }
  const SFX = {
    click: () => tone(700, 0.05, 'triangle', 0.07),
    move: () => tone(420, 0.05, 'triangle', 0.06, 520),
    swap: () => tone(360, 0.08, 'sine', 0.1, 620),
    pop: (n = 0) => tone(520 * Math.pow(1.06, n), 0.09, 'sine', 0.14, 980 * Math.pow(1.06, n)),
    coin: () => { tone(988, 0.07, 'square', 0.05); tone(1319, 0.14, 'square', 0.05, null, 0.07); },
    combo: (n = 1) => { const f = 440 * Math.pow(1.122, Math.min(n, 12)); tone(f, 0.1, 'triangle', 0.12); tone(f * 1.5, 0.14, 'triangle', 0.08, null, 0.06); },
    drop: () => tone(240, 0.12, 'sine', 0.16, 110),
    place: () => { tone(300, 0.06, 'triangle', 0.12); noise(0.05, 0.05, 2000); },
    bounce: () => tone(600, 0.04, 'square', 0.05),
    hit: () => { tone(180, 0.25, 'sawtooth', 0.12, 50); noise(0.2, 0.1, 400); },
    bad: () => tone(170, 0.14, 'square', 0.06, 140),
    clear: () => [660, 880, 1100].forEach((f, i) => tone(f, 0.12, 'triangle', 0.1, null, i * 0.05)),
    level: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.14, 'triangle', 0.1, null, i * 0.07)),
    win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.2, 'triangle', 0.12, null, i * 0.11)),
    lose: () => [392, 330, 262].forEach((f, i) => tone(f, i === 2 ? 0.4 : 0.18, 'triangle', 0.12, null, i * 0.17)),
    whoosh: () => noise(0.25, 0.08, 1200),
  };

  /* ---------------- Ads (Google H5 Games Ads) ---------------- */
  let adsReady = false, adPlaying = false;
  function loadAds() {
    const a = CFG.adsense;
    if (!a || !a.enabled || !a.client || PLAY_EDITION) return;
    const s = document.createElement('script');
    s.async = true; s.crossOrigin = 'anonymous';
    s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(a.client);
    s.setAttribute('data-ad-frequency-hint', '90s');
    document.head.appendChild(s);
    window.adsbygoogle = window.adsbygoogle || [];
    window.adBreak = window.adConfig = function (o) { window.adsbygoogle.push(o); };
    // Only use ads once Google says the Ad Placement API is ready (needs H5 Games Ads approval).
    window.adConfig({ preloadAdBreaks: 'on', sound: 'on', onReady: () => { adsReady = true; } });
  }
  function showAd(kind = 'next') {
    if (!adsReady) return Promise.resolve({ shown: false });
    return new Promise((resolve) => {
      let done = false;
      const finish = (r) => { if (!done) { done = true; resolve(r); } };
      window.adBreak({
        type: kind, name: (opts && opts.id) + '-' + kind,
        beforeAd: () => { adPlaying = true; SDK.muteAll(true); },
        afterAd: () => { adPlaying = false; SDK.muteAll(false); },
        adBreakDone: (p) => finish({ shown: p && p.breakStatus === 'viewed' }),
      });
      // If no ad starts quickly, never keep the player waiting.
      setTimeout(() => { if (!adPlaying) finish({ shown: false }); }, 1500);
      setTimeout(() => finish({ shown: false }), 45000);
    });
  }

  /* ---------------- Confetti ---------------- */
  function confetti(n = 90) {
    const c = el('canvas', 'ag-confetti'); ui.stage.appendChild(c);
    const r = ui.stage.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    c.width = r.width * dpr; c.height = r.height * dpr; c.style.width = r.width + 'px'; c.style.height = r.height + 'px';
    const x = c.getContext('2d'); x.scale(dpr, dpr);
    const colors = ['#fbbf24', '#8b5cf6', '#22d3ee', '#f472b6', '#34d399', '#fff'];
    const ps = Array.from({ length: n }, () => ({
      x: r.width / 2, y: r.height * 0.45, vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 13 - 4,
      s: 4 + Math.random() * 6, a: Math.random() * 6, va: (Math.random() - 0.5) * 0.4, c: colors[(Math.random() * colors.length) | 0],
    }));
    let f = 0;
    (function tick() {
      x.clearRect(0, 0, r.width, r.height);
      ps.forEach((p) => { p.vy += 0.35; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.a += p.va; x.save(); x.translate(p.x, p.y); x.rotate(p.a); x.fillStyle = p.c; x.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); x.restore(); });
      if (++f < 150) requestAnimationFrame(tick); else c.remove();
    })();
  }

  /* ---------------- UI ---------------- */
  function buildShell() {
    const app = el('div', 'ag-app');
    const top = el('div', 'ag-top');
    top.innerHTML = `
      <button class="ag-menu" data-act="exit" aria-label="${L('Back to menu')}"><span>←</span><b>${L('Menu')}</b></button>
      <div class="ag-title"><span class="ag-emoji">${meta.emoji}</span><span class="ag-name">${esc(meta.name)}</span></div>
      <div class="ag-spacer"></div>
      <div class="ag-extra" style="display:flex;gap:6px"></div>
      <div class="ag-chip accent"><b data-score>0</b><small>${L('Score')}</small></div>
      <div class="ag-chip"><b data-best>0</b><small>${L('Best')}</small></div>
      <button class="icon-btn" data-act="sound" aria-label="${L('Sound')}">🔊</button>
      <button class="icon-btn" data-act="full" aria-label="${L('Full screen')}">⛶</button>
      <button class="icon-btn" data-act="pause" aria-label="${L('Pause')}">⏸</button>`;
    const stage = document.getElementById('stage') || el('div');
    stage.classList.add('ag-stage');
    app.append(top, stage);
    document.body.prepend(app);
    ui = { app, top, stage, score: $('[data-score]', top), best: $('[data-best]', top), extra: $('.ag-extra', top), sound: $('[data-act=sound]', top) };
    top.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      SFX.click();
      if (b.dataset.act === 'exit') exit();
      if (b.dataset.act === 'pause') state === 'playing' ? pause() : state === 'paused' && resume();
      if (b.dataset.act === 'full') toggleFullscreen();
      if (b.dataset.act === 'sound') { muted = !muted; store.set('arcade.muted', muted); syncSound(); }
    });
    document.documentElement.style.setProperty('--accent', meta.colors[0]);
    syncSound();
    ui.best.textContent = fmt(best);
  }
  function syncSound() { ui.sound.textContent = muted ? '🔇' : '🔊'; }
  const fmt = (n) => Math.round(n).toLocaleString();

  function overlay(html) {
    closeOverlay();
    const o = el('div', 'ag-overlay');
    o.innerHTML = `<div class="ag-panel" style="--c1:${meta.colors[0]};--c2:${meta.colors[1]}">${html}</div>`;
    ui.stage.appendChild(o); ui.overlay = o;
    return o;
  }
  function closeOverlay() { if (ui.overlay) { ui.overlay.remove(); ui.overlay = null; } }

  function startNote() {
    if (PLAY_EDITION) return '';
    if (!inHub) return `<div class="ag-reward dim"><span>${L('Playing for fun.')} <a href="/arcade/${esc(opts.id)}" target="_top">${L('Open it on PMT Arcade')}</a> ${L('and sign in to earn PMT.')}</span></div>`;
    if (!hub.signedIn) return `<div class="ag-reward dim"><span>${L('Sign in on PMT Arcade to earn PMT for your scores.')}</span></div>`;
    return '';
  }
  function refreshStartNote() { const n = ui.overlay && ui.overlay.querySelector('[data-note]'); if (n) n.innerHTML = startNote(); }

  function showStart() {
    state = 'idle';
    const how = (opts.howTo || []).map((h) => `<div>${L(h)}</div>`).join('');
    const extra = opts.startExtra ? opts.startExtra() : '';
    const o = overlay(`
      <div class="ag-art">${meta.emoji}</div>
      <div class="ag-h">${esc(meta.name)}</div>
      <div class="ag-sub">${esc(L(opts.subtitle || meta.tag))}</div>
      ${how ? `<div class="ag-how">${how}</div>` : ''}
      ${extra}
      <div data-note>${startNote()}</div>
      <div class="ag-actions"><button class="btn btn-primary btn-lg" data-go>▶ ${L('Play')}</button><button class="btn" data-exit>⌂ ${L('Back to menu')}</button></div>
      ${best ? `<div class="ag-best">${L('Your best:')} <b class="num">${fmt(best)}</b></div>` : ''}`);
    $('[data-go]', o).onclick = () => { SFX.click(); goFullscreen(); start(); };
    $('[data-exit]', o).onclick = () => { SFX.click(); exit(); };
    if (opts.onStartScreen) opts.onStartScreen(o);
  }

  function start() {
    closeOverlay();
    score = 0; setScore(0);
    state = 'playing';
    runPromise = inHub && hub.signedIn && !PLAY_EDITION ? ask('start', {}) : null;
    audio();
    opts.onStart && opts.onStart();
  }

  function pause() {
    if (state !== 'playing') return;
    state = 'paused';
    opts.onPause && opts.onPause();
    const o = overlay(`
      <div class="ag-h">${L('Paused')}</div>
      <div class="ag-sub">${L('Score')} <b class="num">${fmt(score)}</b></div>
      <div class="ag-actions">
        <button class="btn btn-primary btn-lg" data-r>▶ ${L('Resume')}</button>
        <div class="ag-actions-row"><button class="btn" data-restart>↻ ${L('Restart')}</button><button class="btn" data-exit>⌂ ${L('Menu')}</button></div>
      </div>`);
    $('[data-r]', o).onclick = () => { SFX.click(); resume(); };
    $('[data-restart]', o).onclick = async () => { SFX.click(); await saveRunInProgress(); start(); };
    $('[data-exit]', o).onclick = () => { SFX.click(); exit(); };
  }
  function resume() { if (state !== 'paused') return; closeOverlay(); state = 'playing'; opts.onResume && opts.onResume(); }

  function setScore(n) {
    const prev = score; score = Math.max(0, Math.floor(n));
    ui.score.textContent = fmt(score);
    const now = performance.now();
    if (score > prev && now - lastBump > 300) { // throttled: restarting a CSS animation forces a layout
      lastBump = now; const chip = ui.score.parentElement;
      chip.classList.remove('bump'); void chip.offsetWidth; chip.classList.add('bump');
    }
  }

  const chips = {};
  function setStat(id, label, value) {
    if (!chips[id]) { const c = el('div', 'ag-chip', `<b></b><small>${esc(L(label))}</small>`); ui.extra.appendChild(c); chips[id] = c; }
    chips[id].querySelector('b').textContent = value;
  }

  async function gameOver(finalScore, info = {}) {
    if (state === 'over') return;
    state = 'over';
    setScore(finalScore);
    const isBest = score > best && score > 0;
    if (isBest) { best = score; store.set('arcade.best.' + opts.id, best); ui.best.textContent = fmt(best); }
    (info.win ? SFX.win : SFX.lose)();
    if (info.win || isBest) confetti();
    const stats = (info.stats || []).map(([k, v]) => `<div><b>${esc(v)}</b><small>${esc(L(k))}</small></div>`).join('');
    const o = overlay(`
      <div class="ag-h">${esc(L(info.title || 'Game Over'))}</div>
      <div class="ag-score" data-sc>0</div>
      ${isBest ? `<div class="ag-newbest">★ ${L('NEW BEST')}</div>` : `<div class="ag-sub">${L('Best')} ${fmt(best)}</div>`}
      ${stats ? `<div class="ag-stats">${stats}</div>` : ''}
      <div class="ag-reward dim" data-reward>${PLAY_EDITION ? '' : inHub && hub.signedIn ? `<div class="spinner"></div> ${L('Saving your score…')}` : startNote().replace(/^<div class="ag-reward dim">|<\/div>$/g, '')}</div>
      <div class="ag-actions-row"><button class="btn btn-primary" data-again>↻ ${L('Play again')}</button><button class="btn" data-exit>⌂ ${L('Menu')}</button></div>`);
    countUp($('[data-sc]', o), score);
    $('[data-exit]', o).onclick = () => { SFX.click(); exit(); };
    $('[data-again]', o).onclick = async (e) => {
      const b = e.currentTarget; if (b.disabled) return;
      b.disabled = true; SFX.click();
      await showAd('next');
      start();
    };

    if (inHub && hub.signedIn && runPromise) {
      const run = await runPromise;
      const box = $('[data-reward]', o);
      if (run && run.runId) {
        const res = await ask('finish', { runId: run.runId, score, meta: info.meta || {} });
        if (!box.isConnected) return;
        if (res.coins > 0) {
          box.className = 'ag-reward';
          box.innerHTML = `<span class="coin" style="font-size:1.5rem"></span><span class="big">+${fmt(res.coins)}</span><span>${L('PMT earned')}</span>`;
          SFX.coin();
        } else {
          box.innerHTML = esc(L(res.message || res.error || 'No PMT this time. Score higher to earn!'));
        }
      } else if (box.isConnected) {
        box.innerHTML = esc(L((run && (run.message || run.error)) || 'Could not reach the server. Your score was not saved.'));
      }
    }
  }
  function countUp(node, to) {
    const t0 = performance.now(), d = Math.min(900, 200 + to * 2);
    (function f(t) { const k = Math.min(1, (t - t0) / d); node.textContent = fmt(to * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(f); })(t0);
  }

  // Leaving or restarting mid-game still saves the score so far (the server applies the same rules).
  async function saveRunInProgress() {
    const pending = runPromise; runPromise = null;
    if (!pending || !inHub || !(state === 'playing' || state === 'paused') || score <= 0) return;
    const run = await pending;
    if (run && run.runId) post('finish', { runId: run.runId, score, meta: { left: true }, quiet: true });
  }
  async function exit() {
    await saveRunInProgress();
    leaveFullscreen();
    if (inHub) post('exit'); else location.href = '../../index.html';
  }
  // Full screen. Phones go full screen on Play; the ⛶ button toggles it anywhere. Inside the app the
  // hub also stretches the game frame over the whole screen, which works even where the browser
  // refuses real full screen for embedded pages (iPhone Safari).
  const isPhone = () => matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820;
  let immersive = false;
  function enterFullscreen() {
    immersive = true;
    post('fullscreen', { on: true });
    if (document.fullscreenElement || document.webkitFullscreenElement) return;
    const el = document.documentElement, req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req) Promise.resolve(req.call(el, { navigationUI: 'hide' })).then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('portrait').catch(() => {})).catch(() => {});
  }
  function leaveFullscreen() {
    immersive = false;
    post('fullscreen', { on: false });
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    const exitFs = document.exitFullscreen || document.webkitExitFullscreen;
    if (fsEl && exitFs) Promise.resolve(exitFs.call(document)).catch(() => {});
  }
  function toggleFullscreen() { immersive ? leaveFullscreen() : enterFullscreen(); }
  function goFullscreen() { if (isPhone()) enterFullscreen(); }
  // the player left full screen with the phone's back gesture / Esc: shrink the frame too
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && immersive && !isPhone()) leaveFullscreen(); });

  function floatText(x, y, text, color = '#fff') {
    const f = el('div', 'ag-float'); f.textContent = text; f.style.left = x + 'px'; f.style.top = y + 'px'; f.style.color = color;
    ui.stage.appendChild(f); setTimeout(() => f.remove(), 900);
  }

  /* Fit a canvas into the stage. Logical width is fixed; height is fixed or flexible (minH..maxH).
     reserveH keeps room (in screen px) for controls placed under the canvas. */
  function fitCanvas(canvas, cfg) {
    const view = { canvas, ctx: canvas.getContext('2d'), w: cfg.w, h: cfg.h || cfg.minH, scale: 1, dpr: 1 };
    const pad = cfg.pad == null ? 8 : cfg.pad;
    function fit() {
      const r = ui.stage.getBoundingClientRect();
      const aw = Math.max(50, r.width - pad * 2), ah = Math.max(50, r.height - pad * 2 - (cfg.reserveH || 0));
      if (cfg.minH) view.h = Math.round(Math.max(cfg.minH, Math.min(cfg.maxH || 9999, (ah / aw) * view.w)));
      const s = Math.min(aw / view.w, ah / view.h);
      const cw = Math.floor(view.w * s), ch = Math.floor(view.h * s);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
      canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
      view.scale = s; view.dpr = dpr;
      view.ctx.setTransform(canvas.width / view.w, 0, 0, canvas.height / view.h, 0, 0);
      cfg.onResize && cfg.onResize(view);
    }
    view.point = (e) => {
      const r = canvas.getBoundingClientRect();
      const p = e.touches ? e.touches[0] || e.changedTouches[0] : e;
      return { x: ((p.clientX - r.left) / r.width) * view.w, y: ((p.clientY - r.top) / r.height) * view.h };
    };
    view.toStage = (x, y) => {
      const r = canvas.getBoundingClientRect(), s = ui.stage.getBoundingClientRect();
      return { x: r.left - s.left + (x / view.w) * r.width, y: r.top - s.top + (y / view.h) * r.height };
    };
    view.fit = fit;
    new ResizeObserver(fit).observe(ui.stage);
    fit();
    return view;
  }

  function init(o) {
    opts = o;
    meta = (CFG.games || []).find((g) => g.id === o.id) || { id: o.id, name: o.id, emoji: '🎮', colors: ['#8b5cf6', '#22d3ee'], tag: '' };
    best = store.get('arcade.best.' + o.id, 0);
    buildShell();
    loadAds();
    document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'playing') pause(); });
    window.addEventListener('keydown', (e) => {
      if ((e.key === 'Escape' || e.key === 'p' || e.key === 'P') && (state === 'playing' || state === 'paused')) { e.preventDefault(); state === 'playing' ? pause() : resume(); }
      else if ((e.key === 'Enter' || e.key === ' ') && ui.overlay && state !== 'paused') { const b = ui.overlay.querySelector('[data-go],[data-again]'); if (b) { e.preventDefault(); b.click(); } }
    });
    // Stop iOS double-tap zoom / long-press menus inside games
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault());
    post('ready');
    showStart();
  }

  const SDK = {
    init, start, pause, resume, gameOver, setScore, setStat, floatText, fitCanvas, confetti, showAd,
    sfx: (name, arg) => SFX[name] && SFX[name](arg),
    vibrate: (ms = 15) => { if (!muted && navigator.vibrate) navigator.vibrate(ms); },
    muteAll: (m) => { if (ac) m ? ac.suspend() : ac.resume(); },
    addScore: (n) => setScore(score + n),
    get score() { return score; },
    get best() { return best; },
    get playing() { return state === 'playing'; },
    get state() { return state; },
    store,
  };
  window.Arcade = SDK;
})();
