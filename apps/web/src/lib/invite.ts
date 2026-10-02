/**
 * Friend invites: the link a host shares (pmtarcade.com/r/CODE), the share buttons, and the
 * in-app browser problem (Google blocks sign-in inside Facebook, Messenger, Instagram, imo …).
 */
export const inviteUrl = (code: string) => `${window.location.origin}/r/${code.toUpperCase()}`;

export function inviteText(host: string, gameName: string, stake: string, code: string): string {
  return `🎲 ${host} invited you to play ${gameName} on PMT Arcade! Stake: ${stake}. New players get free PMT. Tap to join: ${inviteUrl(code)}`;
}

const isAndroid = () => /Android/i.test(navigator.userAgent);
const isIOS = () => /iPhone|iPad|iPod/i.test(navigator.userAgent);
export const isMobile = () => isAndroid() || isIOS();

/** Small browsers inside other apps, where Google refuses to sign people in. */
export function inAppBrowser(): string | null {
  const ua = navigator.userAgent;
  if (/FBAN|FBAV|FB_IAB|FBIOS|MessengerForiOS|Messenger/i.test(ua)) return 'Facebook';
  if (/Instagram/i.test(ua)) return 'Instagram';
  if (/imo(?!\w)|imoAndroid/i.test(ua)) return 'imo';
  if (/Line\//i.test(ua)) return 'LINE';
  if (/TikTok|musical_ly|Bytedance/i.test(ua)) return 'TikTok';
  if (/Snapchat/i.test(ua)) return 'Snapchat';
  // a generic Android WebView (the "; wv)" marker), used by imo and many other apps
  if (isAndroid() && /; wv\)/.test(ua)) return 'app';
  return null;
}

/** Opens the current page in Chrome on Android; null where that is not possible (iPhone). */
export function openInChromeHref(): string | null {
  if (!isAndroid()) return null;
  const { host, pathname, search } = window.location;
  return `intent://${host}${pathname}${search}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(window.location.href)};end`;
}

export interface ShareTarget {
  id: 'whatsapp' | 'messenger' | 'facebook' | 'more' | 'copy';
  label: string;
  href?: string;
}

export function shareTargets(text: string, url: string): ShareTarget[] {
  const targets: ShareTarget[] = [{ id: 'whatsapp', label: 'WhatsApp', href: `https://wa.me/?text=${encodeURIComponent(text)}` }];
  if (isMobile()) targets.push({ id: 'messenger', label: 'Messenger', href: `fb-messenger://share/?link=${encodeURIComponent(url)}` });
  targets.push({ id: 'facebook', label: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}` });
  if (typeof navigator.share === 'function') targets.push({ id: 'more', label: 'imo & more apps' });
  targets.push({ id: 'copy', label: 'Copy link' });
  return targets;
}
