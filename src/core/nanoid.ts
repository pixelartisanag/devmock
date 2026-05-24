/**
 * Tiny ID generator — no dependencies.
 *
 * Supports seeded deterministic output via mulberry32 PRNG.
 * Without a seed, falls back to crypto.getRandomValues (random each run).
 *
 * Usage:
 *   nanoid()        → random ID (default)
 *   setSeed(42)     → all subsequent nanoid() calls are deterministic
 *   resetSeed()     → back to random
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

// ─── PRNG ─────────────────────────────────────────────────────────────────────

type RngFn = () => number;

let rng: RngFn | null = null; // null = use crypto (random)

/**
 * mulberry32 — fast, tiny, good distribution, seedable.
 * Returns floats in [0, 1).
 */
function mulberry32(seed: number): RngFn {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

export function setSeed(seed: number): void {
  rng = mulberry32(seed);
}

export function resetSeed(): void {
  rng = null;
}

// ─── nanoid ───────────────────────────────────────────────────────────────────

export function nanoid(size = 12): string {
  if (rng) {
    return Array.from({ length: size }, () => ALPHABET[Math.floor(rng!() * ALPHABET.length)]).join('');
  }
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}
