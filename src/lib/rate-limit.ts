import type { DB, LoginAttempt } from "./types";

// Brute-force protection policy:
// - 5 failed attempts on an email inside the window locks that email for 15 min.
// - 5 failed attempts from an IP inside the window locks that IP for 15 min.
// Locks double on repeat offences, up to 1 hour. Successful logins clear state.
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;
const BASE_LOCK_MS = 15 * 60 * 1000;
const MAX_LOCK_MS = 60 * 60 * 1000;
const ENTRY_TTL_MS = 24 * 60 * 60 * 1000;

export function emailAttemptKey(email: string): string {
  return `email:${email}`;
}

export function ipAttemptKey(ip: string): string {
  return `ip:${ip}`;
}

export function signupAttemptKey(ip: string): string {
  return `signup:${ip}`;
}

function findEntry(db: DB, key: string): LoginAttempt | undefined {
  return db.login_attempts.find((a) => a.key === key);
}

/** Returns remaining lock seconds when locked, otherwise 0. */
export function lockedForSeconds(db: DB, key: string, now = Date.now()): number {
  const entry = findEntry(db, key);
  if (!entry?.locked_until) return 0;
  const until = new Date(entry.locked_until).getTime();
  if (until <= now) return 0;
  return Math.ceil((until - now) / 1000);
}

/**
 * Records a failed attempt. Applies/extends a lock when the failure threshold
 * inside the rolling window is crossed. Returns the new lock duration (0 = no lock).
 */
export function recordFailure(db: DB, key: string, now = Date.now()): number {
  let entry = findEntry(db, key);
  if (!entry) {
    entry = { key, failures: 0, first_failed_at: new Date(now).toISOString(), last_failed_at: new Date(now).toISOString(), locked_until: null };
    db.login_attempts.push(entry);
  }
  const first = new Date(entry.first_failed_at).getTime();
  if (now - first > WINDOW_MS) {
    entry.failures = 0;
    entry.first_failed_at = new Date(now).toISOString();
    entry.locked_until = null;
  }
  entry.failures += 1;
  entry.last_failed_at = new Date(now).toISOString();

  if (entry.locked_until && new Date(entry.locked_until).getTime() > now) {
    // Already locked; extend by the same remaining duration on top of expiry.
    const extra = Math.min(new Date(entry.locked_until).getTime() - first, MAX_LOCK_MS);
    entry.locked_until = new Date(new Date(entry.locked_until).getTime() + Math.min(extra, BASE_LOCK_MS)).toISOString();
    return Math.ceil((new Date(entry.locked_until).getTime() - now) / 1000);
  }

  if (entry.failures >= MAX_FAILURES) {
    const priorLocks = Math.max(0, Math.floor(entry.failures / MAX_FAILURES) - 1);
    const lockMs = Math.min(BASE_LOCK_MS * 2 ** priorLocks, MAX_LOCK_MS);
    entry.locked_until = new Date(now + lockMs).toISOString();
    return Math.ceil(lockMs / 1000);
  }
  return 0;
}

export function recordSuccess(db: DB, keys: string[]): void {
  db.login_attempts = db.login_attempts.filter((a) => !keys.includes(a.key));
}

/** Drops stale, unlocked entries so the collection cannot grow forever. */
export function pruneAttempts(db: DB, now = Date.now()): number {
  const before = db.login_attempts.length;
  db.login_attempts = db.login_attempts.filter((a) => {
    const last = new Date(a.last_failed_at).getTime();
    if (now - last > ENTRY_TTL_MS) return false;
    if (a.locked_until && new Date(a.locked_until).getTime() <= now) {
      a.locked_until = null;
    }
    return true;
  });
  return before - db.login_attempts.length;
}
