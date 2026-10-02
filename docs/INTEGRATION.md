# Merging into a host project (sign-in)

Token Arena has **no login, registration, password-reset or "choose a username" screens**. It is
meant to be merged into another project that already signs users in. The platform only:

1. reads the host's sign-in session in the browser,
2. sends its **Firebase ID token** to the API as `Authorization: Bearer <token>`,
3. verifies that token on the server on every request (`apps/api/src/auth/verifier.ts`), and
4. creates the player profile, permanent player number and wallets automatically on the first
   `POST /api/auth/session` for that user.

## What the host project must provide

| | |
|---|---|
| Sign-in | Firebase Authentication in the **same Firebase project** as `FIREBASE_PROJECT_ID` (any provider: email/password, Google, phone…). |
| Same origin (recommended) | Serve Token Arena and the host app from the same domain so they share the Firebase session (Firebase keeps it per origin). |
| Sign-in page URL | Set `VITE_LOGIN_URL` (root `.env`). Signed-out visitors get a **Go to sign in** button to `VITE_LOGIN_URL?redirect=<current page>`. The host should send the user back to `redirect` after signing in (only redirect to your own domain). |

The web app reuses the host's Firebase app if one is already initialised (`getApps()` in
`apps/web/src/lib/firebase.ts`), so both can live in one bundle.

## If the host does not use Firebase

The browser side is pluggable: pass your own source to the provider.

```tsx
import { AuthProvider } from './auth/AuthProvider';
import type { IdentitySource } from './auth/identity';

const hostSession: IdentitySource = {
  kind: 'host',
  subscribe: (onChange) => host.onSessionChange((user) => onChange(!!user)), // returns unsubscribe
  getIdToken: () => host.getAccessToken(), // a JWT for the API, or null
  signOut: () => host.signOut(),
};

<AuthProvider source={hostSession}>…</AuthProvider>
```

The server side must then verify that token: implement `TokenVerifier` (`verify(token) →
{ uid, email, emailVerified, signInProvider, name }`) for your issuer, for example with `jose`'s
`createRemoteJWKSet` against your provider's JWKS, and return it from `getVerifier` in
`apps/api/src/app.ts`. Never accept a user id from the browser without verifying a signed token.

## Player profile created on first sign-in

| Field | Source |
|---|---|
| player number | next permanent number (#100001, #100002, …) |
| username | the email's local part (`rahim.uddin@…` → `rahim_uddin`), 3–20 of `a–z 0–9 _`; if taken, a 4-digit suffix is added (`rahim_uddin_4821`). Permanent. |
| display name | the token's `name` claim, else the username. Players can change it on **Profile**. |
| email / verified | from the token, refreshed on every session |

Admins still need a verified email in production (`ADMIN_REQUIRE_VERIFIED_EMAIL`); email
verification is the host project's job.

## Local development without the host

`VITE_DEV_AUTH=true` (root `.env`) together with `DEV_AUTH=true` (`apps/api/.dev.vars`) shows a
**development identity** box on the signed-out screen: type a name such as `alice` and that tab
acts as player `alice` (the API accepts the token `dev.alice`). Each browser tab can be a
different player, which is how the multiplayer games are tested locally.

This is not a login and cannot work in production:

* the browser code is only included by `vite dev` (`import.meta.env.DEV`), never by `vite build`;
* the API accepts `dev.` tokens only when `ENVIRONMENT` is exactly `development` **and**
  `DEV_AUTH` is `true`; `ENVIRONMENT=production` always refuses them (tested in
  `tests/integration/auth-registration.test.ts`).

Make yourself Super Admin locally after picking a dev name (e.g. `boss`):

```bash
npm run admin:create -- --email boss@dev.localhost
```
