/**
 * Google Play edition. The Play Store version of the Android app (package com.pmtarcade.app)
 * opens the site with ?edition=play. In that mode the site shows only what Google Play allows
 * without a gambling licence: the free arcade games (no PMT rewards, no ads), profile and support —
 * no stakes, Aviator, wallet, buying/selling, prizes or PMT balances. The full website, and the
 * full Android app from pmtarcade.com, are unchanged.
 *
 * Kept in sessionStorage (this app window only), so opening pmtarcade.com in Chrome is never affected.
 */
const KEY = 'arena.edition';

function detect(): boolean {
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get('edition') === 'play') {
      sessionStorage.setItem(KEY, 'play');
      return true;
    }
    if (sessionStorage.getItem(KEY) === 'play') return true;
    // started from the Play app, even without the parameter (e.g. a pmtarcade.com link opened in it)
    if (document.referrer.startsWith('android-app://com.pmtarcade.app') && !document.referrer.startsWith('android-app://com.pmtarcade.app.')) {
      sessionStorage.setItem(KEY, 'play');
      return true;
    }
  } catch {
    /* storage blocked */
  }
  return false;
}

export const isPlayEdition = typeof window !== 'undefined' && detect();

/** pages the Play edition may open; everything else goes back to the games */
export function playEditionAllows(pathname: string): boolean {
  return pathname === '/' || pathname === '/play' || pathname.startsWith('/arcade/') || pathname === '/profile' || pathname === '/support';
}
