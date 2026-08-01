import { listSessions, type SessionRecord } from '@/storage/db';

export type { SessionRecord };

let cache: { data: SessionRecord[]; ts: number } | null = null;
const TTL = 15_000;

export async function getSessions(force = false): Promise<SessionRecord[]> {
  const now = Date.now();
  if (!force && cache && now - cache.ts < TTL) return cache.data;
  try {
    const data = await listSessions();
    cache = { data, ts: now };
    return data;
  } catch {
    return cache?.data ?? [];
  }
}

export function getCachedSessions(): SessionRecord[] | null {
  return cache?.data ?? null;
}

export function invalidateCache(): void {
  cache = null;
}
