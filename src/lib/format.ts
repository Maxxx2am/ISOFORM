/** Small formatting helpers shared across screens. */

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatRelativeDay(ts: number, now: number = Date.now()): string {
  const dayMs = 86_400_000;
  const startOfDay = (t: number) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const days = Math.round((startOfDay(now) - startOfDay(ts)) / dayMs);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(ts).toLocaleDateString();
}

/** Long-form duration for totals, e.g. "3h 24m" or "48m". */
export function formatDuration(ms: number): string {
  const totalMin = Math.round(Math.max(0, ms) / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

/** Thousands-separated integer, e.g. 100213 -> "100,213". Avoids relying on Intl. */
export function formatCount(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Stable-ish unique id without external deps. */
export function makeId(seed: number = Date.now()): string {
  return `${seed.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}
