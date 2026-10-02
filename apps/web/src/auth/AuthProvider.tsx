import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { MeDto, PublicConfigDto } from '@arena/shared';
import { ApiError, get, post, setTokenGetter } from '../lib/api';
import { defaultIdentitySource, type IdentitySource } from './identity';

export type AuthStatus = 'loading' | 'unconfigured' | 'signed_out' | 'ready' | 'blocked' | 'error';

interface AuthState {
  status: AuthStatus;
  me: MeDto | null;
  config: PublicConfigDto | null;
  error: string | null;
  /** which identity source is active (e.g. "firebase", "dev") */
  sourceKind: string | null;
  signOut(): Promise<void>;
  refreshMe(): Promise<void>;
  retry(): void;
}

const Ctx = createContext<AuthState | null>(null);

const REF_KEY = 'arena.ref';
// an invite link (?ref=CODE) is remembered until the visitor has signed in
try {
  const ref = new URLSearchParams(window.location.search).get('ref');
  if (ref && /^[A-Z0-9]{4,12}$/i.test(ref)) localStorage.setItem(REF_KEY, ref.toUpperCase());
} catch {
  /* storage blocked: the invite code can still be typed in by hand */
}
function applyStoredReferral(): void {
  let code: string | null;
  try {
    code = localStorage.getItem(REF_KEY);
    if (code) localStorage.removeItem(REF_KEY);
  } catch {
    return;
  }
  if (code) void post('/api/arcade/referral', { code }).catch(() => undefined); // best effort: an old or own code is simply ignored
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}

export function useMe(): MeDto {
  const { me } = useAuth();
  if (!me) throw new Error('useMe requires a signed-in player');
  return me;
}

export function useConfig(): PublicConfigDto | null {
  return useAuth().config;
}

/**
 * Follows the host project's sign-in session (see ./identity.ts) and starts a platform session
 * for it. There is no login or registration UI here: the first session creates the player.
 */
export function AuthProvider({ children, source: given }: { children: ReactNode; source?: IdentitySource | null }) {
  const [source] = useState<IdentitySource | null>(() => (given !== undefined ? given : defaultIdentitySource()));
  const [status, setStatus] = useState<AuthStatus>(source ? 'loading' : 'unconfigured');
  const [me, setMe] = useState<MeDto | null>(null);
  const [config, setConfig] = useState<PublicConfigDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    get<PublicConfigDto>('/api/config')
      .then((c) => {
        setConfig(c);
        document.title = c.platformName;
      })
      .catch(() => setConfig(null));
  }, []);

  useEffect(() => {
    if (!source) return;
    setTokenGetter(() => source.getIdToken());
    let generation = 0;
    const unsubscribe = source.subscribe((signedIn) => {
      const mine = ++generation;
      if (!signedIn) {
        setMe(null);
        setStatus('signed_out');
        return;
      }
      setStatus('loading');
      post<MeDto>('/api/auth/session')
        .then((m) => {
          if (mine !== generation) return;
          setMe(m);
          setError(null);
          setStatus('ready');
          applyStoredReferral();
        })
        .catch((e: unknown) => {
          if (mine !== generation) return;
          setError(e instanceof ApiError ? e.message : 'Could not reach the server.');
          setStatus(e instanceof ApiError && e.code === 'ACCOUNT_BANNED' ? 'blocked' : 'error');
        });
    });
    return () => {
      generation += 1;
      unsubscribe();
    };
  }, [source, attempt]);

  const value = useMemo<AuthState>(
    () => ({
      status,
      me,
      config,
      error,
      sourceKind: source?.kind ?? null,
      async signOut() {
        await source?.signOut();
      },
      async refreshMe() {
        setMe(await get<MeDto>('/api/me'));
      },
      retry() {
        setAttempt((a) => a + 1);
      },
    }),
    [status, me, config, error, source],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
