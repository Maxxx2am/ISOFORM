import { listSessions, type SessionRecord } from '@/storage/db';

export type { SessionRecord };

let cache: { data: SessionRecord[]; ts: number } | null = null;
let pending: Promise<SessionRecord[]> | null = null;
const TTL = 15_000;

export async function getSessions(force = false): Promise<SessionRecord[]> {
  const now = Date.now();
  if (!force && cache && now - cache.ts < TTL) return cache.data;
  if (!force && pending) return pending;

  pending = listSessions()
    .then((data) => {
      cache = { data, ts: Date.now() };
      return data;
    })
    .catch(() => cache?.data ?? [])
    .finally(() => { pending = null; });

  return pending;
}

export function getCachedSessions(): SessionRecord[] | null {
  return cache?.data ?? null;
}

export function invalidateCache(): void {
  cache = null;
}
