# 🎮 NEON RUSH 2077 — Play to Earn PMT

A browser-based PWA game on BNB Chain where players earn real PMT tokens.

---

## 📁 FILES

| File | Description |
|------|-------------|
| `index.html` | Full game frontend (PWA-ready) |
| `backend.js` | Node.js backend for BNB transfers |
| `manifest.json` | PWA manifest (Android install) |
| `sw.js` | Service worker (offline play) |
| `.env` | Your private keys (NEVER share!) |

---

## ⚙️ SETUP

### 1. Backend (.env file)
Create a `.env` file in the same folder as `backend.js`:
```
PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE
TOKEN_ADDRESS=0xYOUR_PMT_TOKEN_ADDRESS
PORT=3000
```

### 2. Install dependencies
```bash
npm install
```

### 3. Start backend
```bash
node backend.js
```

### 4. Open the game
Open `index.html` in your browser.

---

## 📱 ANDROID PWA INSTALL (Free!)

1. Deploy `index.html`, `manifest.json`, `sw.js` to **GitHub Pages** or **Netlify** (both free)
2. Open the link in Chrome on Android
3. Chrome shows "Add to Home Screen" banner
4. Users tap Install → game appears as an app!

---

## 💰 ADS SETUP (Google AdSense)

1. Sign up at https://adsense.google.com (free)
2. Get approved (takes a few days)
3. Get your Publisher ID (looks like: `ca-pub-XXXXXXXXXXXXXXXX`)
4. In `index.html`, find this line and uncomment it:
```html
<!-- <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-XXXXXXXXXXXXXXXX" ...> -->
```
5. Replace `XXXXXXXXXXXXXXXX` with your real Publisher ID
6. The 3 ad slots (top banner, mobile banner, game-over rectangle) will show real ads

---

## 🌐 FREE HOSTING (GitHub Pages)

1. Create a free GitHub account at github.com
2. Create a new repository
3. Upload `index.html`, `manifest.json`, `sw.js`
4. Go to Settings → Pages → Source: main branch
5. Your game is live at: `https://yourusername.github.io/reponame`

---

## ⚠️ IMPORTANT SECURITY

- NEVER share your `.env` file
- NEVER upload `.env` to GitHub (add it to `.gitignore`)
- Your private key controls your PMT wallet
- Always keep enough BNB for gas fees

---

## 🚀 GAME FEATURES

- ✅ Vertical scroller (dodge obstacles, collect coins)
- ✅ User registration & login (stored locally)
- ✅ Earn PMT by playing
- ✅ Set BNB Chain wallet address
- ✅ Withdraw PMT to any BNB Chain wallet
- ✅ Mobile touch controls (left, right, boost)
- ✅ PWA — installable on Android
- ✅ Offline play (service worker)
- ✅ Ad slots ready for Google AdSense
- ✅ Confetti on successful withdrawal
