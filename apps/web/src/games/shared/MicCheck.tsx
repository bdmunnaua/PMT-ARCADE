/**
 * Microphone & speaker check for voice chat: shows whether this browser allows the microphone
 * for pmtarcade.com, lets the player test it (a bar moves when they speak) and the speaker
 * (a short tone), and shows how to unblock it for this exact phone / browser.
 */
import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Mic, RefreshCw, Volume2, XCircle } from 'lucide-react';
import { Button } from '../../components/ui';
import { inAppBrowser, openInChromeHref } from '../../lib/invite';
import { t } from '../../lib/i18n';

type Permission = 'granted' | 'prompt' | 'denied' | 'unknown';

/**
 * Chrome's own permission button (<permission type="microphone">). Unlike a normal button it can
 * turn the microphone back on even after "Block" was chosen, without opening any settings.
 * Only shown where the browser supports it.
 */
const hasPermissionElement = typeof window !== 'undefined' && 'HTMLPermissionElement' in window;

/** where the site-settings icon is on this browser: Safari on iPhone keeps the address bar at the bottom */
function iconSpot(): 'top' | 'bottom' {
  const ua = navigator.userAgent;
  const iOS = /iPhone|iPod/i.test(ua);
  const safari = iOS && !/CriOS|FxiOS|EdgiOS/i.test(ua);
  return safari ? 'bottom' : 'top';
}

/**
 * Websites are not allowed to open the browser's settings, so this shows exactly where to tap:
 * a big arrow pointing at the icon next to the address, and the steps for this phone.
 */
function PermissionGuide({ onClose }: { onClose: () => void }) {
  const spot = iconSpot();
  const steps = unblockSteps();
  return (
    <div className="fixed inset-0 z-[100] bg-black/80 text-white" onClick={onClose} role="dialog" aria-modal="true">
      <div className={`absolute left-3 flex flex-col items-start ${spot === 'top' ? 'top-1' : 'bottom-1 flex-col-reverse'}`}>
        <span className={`animate-bounce text-6xl leading-none ${spot === 'top' ? '' : 'rotate-180'}`} aria-hidden>
          ⬆
        </span>
        <span className="mt-1 mb-1 rounded-lg bg-white px-3 py-1.5 text-sm font-bold text-ink-900">
          {spot === 'top' ? t('Tap the icon here, next to pmtarcade.com') : t('Tap "aA" here, next to the address')}
        </span>
      </div>
      <div className="absolute inset-x-4 top-1/2 -translate-y-1/2 space-y-3 rounded-2xl bg-ink-900 p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <p className="text-base font-bold">{t('Allow the microphone for pmtarcade.com')}</p>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          {steps.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ol>
        <div className="flex gap-2">
          <Button onClick={() => window.location.reload()}>{t('Done — reload the page')}</Button>
          <Button variant="secondary" onClick={onClose}>
            {t('Close')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function BrowserPermissionButton({ onChange }: { onChange: () => void }) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.addEventListener('promptaction', onChange);
    el.addEventListener('promptdismiss', onChange);
    return () => {
      el.removeEventListener('promptaction', onChange);
      el.removeEventListener('promptdismiss', onChange);
    };
  }, [onChange]);
  return createElement('permission', { ref, type: 'microphone', style: { fontSize: '16px', padding: '10px 16px', borderRadius: '12px' } });
}

/** which unblock steps fit this device */
function deviceKind(): 'android-chrome' | 'samsung' | 'iphone' | 'desktop-chrome' | 'edge' | 'firefox' | 'safari-mac' | 'other' {
  const ua = navigator.userAgent;
  const iOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (iOS) return 'iphone';
  if (/SamsungBrowser/i.test(ua)) return 'samsung';
  if (/Android/i.test(ua)) return 'android-chrome';
  if (/Edg\//i.test(ua)) return 'edge';
  if (/Firefox\//i.test(ua)) return 'firefox';
  if (/Chrome\//i.test(ua)) return 'desktop-chrome';
  if (/Safari\//i.test(ua)) return 'safari-mac';
  return 'other';
}

function unblockSteps(): string[] {
  switch (deviceKind()) {
    case 'android-chrome':
      return [
        t('Tap the icon left of pmtarcade.com in the address bar (⚙ or 🔒).'),
        t('Tap "Permissions" (or "Site settings") → Microphone → Allow.'),
        t('If it is still blocked: phone Settings → Apps → Chrome → Permissions → Microphone → Allow.'),
        t('Come back and tap "Check again".'),
      ];
    case 'samsung':
      return [
        t('Tap the 🔒 icon left of the address → Permissions → Microphone → Allow.'),
        t('If it is still blocked: phone Settings → Apps → Samsung Internet → Permissions → Microphone → Allow.'),
        t('Come back and tap "Check again".'),
      ];
    case 'iphone':
      return [
        t('In Safari, tap "aA" in the address bar → Website Settings → Microphone → Allow.'),
        t('If it is still blocked: iPhone Settings → Safari → Microphone → Allow (or Ask).'),
        t('Using Chrome on iPhone: iPhone Settings → Chrome → Microphone → on.'),
        t('Come back and tap "Check again".'),
      ];
    case 'desktop-chrome':
    case 'edge':
      return [
        t('Click the icon left of the address (🔒 or ⚙) → Site settings → Microphone → Allow.'),
        t('Reload the page, then tap "Check again".'),
        t('Windows: Settings → Privacy & security → Microphone → let apps and your browser use it.'),
      ];
    case 'firefox':
      return [t('Click the microphone icon (crossed out) left of the address → remove "Blocked".'), t('Reload the page, then tap "Check again".')];
    case 'safari-mac':
      return [t('Safari menu → Settings → Websites → Microphone → pmtarcade.com → Allow.'), t('Reload the page, then tap "Check again".')];
    default:
      return [t('Open your browser settings → Site settings → Microphone → allow pmtarcade.com, then reload the page.')];
  }
}

const ERROR_TEXT: Record<string, string> = {
  NotAllowedError: 'The microphone is blocked for this site. Follow the steps below to allow it.',
  SecurityError: 'The microphone is blocked for this site. Follow the steps below to allow it.',
  NotFoundError: 'No microphone was found on this device.',
  OverconstrainedError: 'No microphone was found on this device.',
  NotReadableError: 'Another app (a phone or WhatsApp call?) is using the microphone. Close it and try again.',
  AbortError: 'Another app (a phone or WhatsApp call?) is using the microphone. Close it and try again.',
};

/**
 * `onAllowed`: used inside voice chat — once the microphone is allowed it is handed straight to the
 * call (no 10 s test that would keep the microphone busy).
 */
export function MicCheck({ compact = false, onAllowed }: { compact?: boolean; onAllowed?: () => void }) {
  const [perm, setPerm] = useState<Permission>('unknown');
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(0);
  const [heardVoice, setHeardVoice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [beeped, setBeeped] = useState(false);
  const [guide, setGuide] = useState(false);
  const stop = useRef<() => void>(() => undefined);
  const allowedRef = useRef(onAllowed);
  allowedRef.current = onAllowed;
  const inApp = inAppBrowser();
  const supported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

  const readPermission = useCallback(async () => {
    try {
      const st = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      setPerm(st.state as Permission);
      st.onchange = () => {
        setPerm(st.state as Permission);
        // allowed in the browser settings while in voice: hand the microphone to the call
        if (st.state === 'granted') allowedRef.current?.();
      };
    } catch {
      setPerm('unknown'); // older Safari cannot tell before asking
    }
  }, []);
  useEffect(() => {
    void readPermission();
    return () => stop.current();
  }, [readPermission]);

  /** asks for the microphone (the browser shows "Allow?") and shows a live level bar for 10 s */
  const test = async () => {
    stop.current();
    setError(null);
    setHeardVoice(false);
    // started inside the tap: iPhones only let sound processing run when it begins with a tap
    let ctx: AudioContext | null;
    try {
      ctx = new AudioContext();
      void ctx.resume().catch(() => undefined);
    } catch {
      ctx = null;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      setPerm('granted');
      if (onAllowed) {
        stream.getTracks().forEach((tr) => tr.stop());
        void ctx?.close().catch(() => undefined);
        onAllowed();
        return;
      }
      setTesting(true);
      if (!ctx) ctx = new AudioContext();
      const audio = ctx;
      void audio.resume().catch(() => undefined);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      audio.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
        const pct = Math.min(100, Math.round((peak / 64) * 100));
        setLevel(pct);
        if (pct > 25) setHeardVoice(true);
      };
      const meter = setInterval(tick, 60);
      const timer = setTimeout(() => stop.current(), 10_000);
      stop.current = () => {
        clearInterval(meter);
        clearTimeout(timer);
        stream.getTracks().forEach((tr) => tr.stop());
        void audio.close().catch(() => undefined);
        setTesting(false);
        setLevel(0);
        stop.current = () => undefined;
      };
    } catch (e) {
      void ctx?.close().catch(() => undefined);
      const name = (e as { name?: string })?.name ?? '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        // closing the question also ends here; only a real "Block" needs the browser settings
        let state: string = 'denied';
        try {
          state = (await navigator.permissions.query({ name: 'microphone' as PermissionName })).state;
        } catch {
          /* Safari cannot tell */
        }
        if (state === 'denied') {
          setPerm('denied');
          setGuide(true);
        } else {
          setError(t('You closed the question without choosing. Tap "Allow microphone" again and choose Allow.'));
          return;
        }
      }
      setError(t(ERROR_TEXT[name] ?? 'The microphone could not be opened ({name}).', { name: name || 'error' }));
    }
  };

  /** a short two-note tone, to check the speaker / earphones */
  const beep = () => {
    try {
      const ctx = new AudioContext();
      const gain = ctx.createGain();
      gain.gain.value = 0.25;
      gain.connect(ctx.destination);
      [660, 880].forEach((f, i) => {
        const o = ctx.createOscillator();
        o.frequency.value = f;
        o.connect(gain);
        o.start(ctx.currentTime + i * 0.35);
        o.stop(ctx.currentTime + i * 0.35 + 0.3);
      });
      setTimeout(() => void ctx.close().catch(() => undefined), 1200);
      setBeeped(true);
    } catch {
      /* no audio output */
    }
  };

  const status =
    perm === 'granted'
      ? { icon: <CheckCircle2 className="size-4 text-emerald-500" />, text: t('Microphone allowed for pmtarcade.com') }
      : perm === 'denied'
        ? { icon: <XCircle className="size-4 text-rose-500" />, text: t('Microphone blocked for pmtarcade.com') }
        : perm === 'prompt'
          ? { icon: <Mic className="size-4 text-amber-500" />, text: t('Not allowed yet — tap "Allow microphone"') }
          : { icon: <Mic className="size-4 text-ink-400" />, text: t('Tap "Allow microphone" to check') };
  const allowed = perm === 'granted';

  return (
    <div className={`space-y-2 rounded-xl border border-ink-100 p-3 text-sm dark:border-ink-800 ${compact ? '' : 'bg-ink-50 dark:bg-ink-900'}`}>
      {!supported || inApp ? (
        <div className="space-y-2 text-amber-800 dark:text-amber-200">
          <p>{inApp ? t('Voice chat does not work inside {app}. Open the game in Chrome or Safari to talk.', { app: inApp }) : t('This browser cannot use voice chat. Use Chrome, Safari, Edge or Firefox.')}</p>
          {inApp && openInChromeHref() && (
            <a href={openInChromeHref()!} className="inline-flex rounded-lg bg-brand-600 px-3 py-1.5 font-semibold text-white">
              {t('Open in Chrome to continue')}
            </a>
          )}
        </div>
      ) : (
        <>
          <p className="flex items-center gap-2 font-semibold">
            {status.icon}
            {status.text}
          </p>
          {!allowed && (
            <div className="space-y-2">
              {/* one big tap: the browser then shows its own "Allow microphone?" question */}
              <Button icon={<Mic className="size-5" />} onClick={test} disabled={testing} className="w-full justify-center py-3 text-base">
                {t('Allow microphone')}
              </Button>
              {perm === 'denied' && (
                <Button variant="secondary" onClick={() => setGuide(true)} className="w-full justify-center">
                  {t('Open the browser permission — show me where')}
                </Button>
              )}
              {perm === 'denied' && hasPermissionElement && (
                <div className="space-y-1 text-center">
                  <p className="text-xs text-ink-500">{t('Blocked before? Tap this browser button to allow it again:')}</p>
                  <BrowserPermissionButton onChange={() => void readPermission()} />
                </div>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {allowed && (
              <Button size="sm" icon={<Mic className="size-4" />} onClick={test} disabled={testing}>
                {testing ? t('Speak now…') : t('Test microphone')}
              </Button>
            )}
            <Button size="sm" variant="secondary" icon={<Volume2 className="size-4" />} onClick={beep}>
              {t('Test speaker')}
            </Button>
            <Button size="sm" variant="ghost" icon={<RefreshCw className="size-4" />} onClick={() => void readPermission()}>
              {t('Check again')}
            </Button>
          </div>
          {testing && (
            <div className="space-y-1">
              <div className="h-3 overflow-hidden rounded-full bg-ink-200 dark:bg-ink-700">
                <div className="h-full rounded-full bg-emerald-500 transition-[width] duration-75" style={{ width: `${level}%` }} />
              </div>
              <p className="text-xs text-ink-500">{heardVoice ? t('✓ Your microphone works — the others can hear you in voice chat.') : t('Say something — the green bar should move.')}</p>
            </div>
          )}
          {!testing && heardVoice && <p className="text-xs text-emerald-600">{t('✓ Your microphone works — the others can hear you in voice chat.')}</p>}
          {beeped && <p className="text-xs text-ink-500">{t('Did you hear two beeps? If not, turn the volume up (and check silent mode).')}</p>}
          {error && <p className="text-xs text-rose-600">{error}</p>}
          {(perm === 'denied' || error) && (
            <ol className="list-decimal space-y-1 pl-5 text-xs">
              {unblockSteps().map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          )}
          {perm === 'denied' && (
            <Button size="sm" variant="secondary" onClick={() => window.location.reload()}>
              {t('Reload the page')}
            </Button>
          )}
          {guide && <PermissionGuide onClose={() => setGuide(false)} />}
        </>
      )}
    </div>
  );
}
