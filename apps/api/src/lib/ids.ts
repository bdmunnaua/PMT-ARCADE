const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** ULID: 48-bit millisecond timestamp + 80 bits of crypto randomness, Crockford base32. Sortable by time. */
export function ulid(now: number = Date.now()): string {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let rand = '';
  for (let i = 0; i < 16; i++) rand += CROCKFORD[(bytes[i] as number) % 32];
  return time + rand;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

export function randomCode(length = 6): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[(bytes[i] as number) % CODE_ALPHABET.length];
  return out;
}

/** Cryptographically secure float in [0, 1). */
export function secureRandom(): number {
  const buf = new Uint32Array(2);
  crypto.getRandomValues(buf);
  // 53 random bits
  return ((buf[0] as number) * 2 ** 21 + ((buf[1] as number) >>> 11)) / 2 ** 53;
}
