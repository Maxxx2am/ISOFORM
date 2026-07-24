/**
 * Small typo-tolerant search over exercises. Matches on name/summary/family/
 * muscles, tolerates 1–2 character mistakes, and still narrows results (a small
 * typo won't dump the whole list).
 */
import type { Exercise } from '@/exercises/types';

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/** Allowed typos scale with word length. */
function maxEdits(len: number): number {
  if (len <= 3) return 0;
  if (len <= 5) return 1;
  return 2;
}

/** Returns a score (higher = better) for a query word against a token, or null. */
function wordScore(qword: string, token: string): number | null {
  if (token === qword) return 100;
  if (token.startsWith(qword)) return 80;
  if (token.includes(qword)) return 60;
  const d = levenshtein(qword, token);
  if (d <= maxEdits(qword.length)) return 50 - d * 10;
  // Also allow a typo against the token's prefix (for partial typing).
  const prefix = token.slice(0, qword.length);
  if (prefix.length === qword.length && levenshtein(qword, prefix) <= maxEdits(qword.length)) return 40;
  return null;
}

/**
 * A hit in the exercise's own NAME ("Handstand") must outrank an incidental
 * word inside its summary (Pike Push-Up's blurb literally says "...path to
 * handstand push-ups", which used to tie with the real Handstand entry and
 * — thanks to sort stability — could out-rank it). Family is weighted next
 * since it groups a whole progression (e.g. searching "pull" should favor
 * pull-ups over an unrelated move that happens to mention pulling).
 */
const FIELD_WEIGHT = { name: 3, family: 1.5, summary: 1, category: 0.5, muscles: 0.5 } as const;

function scoreExercise(queryWords: string[], ex: Exercise): number | null {
  const fields: Record<keyof typeof FIELD_WEIGHT, string> = {
    name: normalize(ex.name),
    family: normalize(ex.family),
    summary: normalize(ex.summary),
    category: normalize(ex.category),
    muscles: normalize(ex.muscles.join(' ')),
  };
  let total = 0;
  for (const qw of queryWords) {
    let best: number | null = null;
    for (const field of Object.keys(fields) as (keyof typeof FIELD_WEIGHT)[]) {
      for (const tok of fields[field].split(' ')) {
        const s = wordScore(qw, tok);
        if (s == null) continue;
        const weighted = s * FIELD_WEIGHT[field];
        if (best == null || weighted > best) best = weighted;
      }
    }
    if (best == null) return null; // every query word must match something
    total += best;
  }
  return total;
}

export function searchExercises(query: string, list: Exercise[]): Exercise[] {
  const q = normalize(query);
  if (!q) return list;
  const words = q.split(' ');
  return list
    .map((ex) => ({ ex, score: scoreExercise(words, ex) }))
    .filter((r): r is { ex: Exercise; score: number } => r.score != null)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.ex);
}
