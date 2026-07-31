/** On-device workout history (SQLite). Everything stays on the phone. */
import * as SQLite from 'expo-sqlite';

import type { CueTally } from '@/engine/formAnalyzer';
import { scoreSession, type SessionSummary, type TimelineSample } from '@/engine/sessionEngine';
import { trimTimelineForStorage } from '@/lib/replayWindow';

export type SessionRecord = {
  id: string;
  exerciseId: string;
  exerciseName: string;
  createdAt: number;
  durationMs: number;
  reps: number;
  holdSeconds: number;
  avgBottomAngle: number | null;
  cues: CueTally[];
  videoUri: string | null;
  /** Recorded video width/height ratio — lets a reopened replay size its box
   * correctly instead of falling back to a full-width, wrong-aspect box. */
  videoAspect: number | null;
  /** Overall 0-100 score computed at save time (null for sessions saved before this existed). */
  score: number | null;
  /** Tracked-action window, ms — lets a reopened review trim the same way a fresh one does. */
  firstActionMs: number | null;
  lastActionMs: number | null;
  /** Per-frame landmarks for the replay window only (not the whole raw session) — lets the
   * skeleton overlay draw when reopening a session from history, not just right after finishing it. */
  timeline: TimelineSample[];
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync('iso-form.db').then(async (db) => {
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY NOT NULL,
          exerciseId TEXT NOT NULL,
          exerciseName TEXT NOT NULL,
          createdAt INTEGER NOT NULL,
          durationMs INTEGER NOT NULL,
          reps INTEGER NOT NULL,
          holdSeconds INTEGER NOT NULL,
          avgBottomAngle REAL,
          cues TEXT NOT NULL,
          videoUri TEXT
        );
      `);
      // Columns added after the initial release — older DBs need them bolted on.
      for (const ddl of [
        `ALTER TABLE sessions ADD COLUMN score INTEGER;`,
        `ALTER TABLE sessions ADD COLUMN firstActionMs INTEGER;`,
        `ALTER TABLE sessions ADD COLUMN lastActionMs INTEGER;`,
        `ALTER TABLE sessions ADD COLUMN timeline TEXT;`,
        `ALTER TABLE sessions ADD COLUMN videoAspect REAL;`,
      ]) {
        try {
          await db.execAsync(ddl);
        } catch (e: unknown) {
          const msg = String(e);
          if (!msg.includes('duplicate column') && !msg.includes('already exists')) {
            throw e;
          }
        }
      }
      return db;
    });
  }
  return dbPromise;
}

export async function saveSession(
  id: string,
  exerciseName: string,
  createdAt: number,
  summary: SessionSummary,
  videoUri: string | null,
  timeline: TimelineSample[] = [],
  videoAspect?: number,
): Promise<boolean> {
  try {
    const db = await getDb();
    const score = scoreSession(summary);
    const trimmed = trimTimelineForStorage(summary, timeline);
    await db.runAsync(
      `INSERT INTO sessions
      (id, exerciseId, exerciseName, createdAt, durationMs, reps, holdSeconds, avgBottomAngle, cues, videoUri, score, firstActionMs, lastActionMs, timeline, videoAspect)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      summary.exerciseId,
      exerciseName,
      createdAt,
      summary.durationMs,
      summary.reps,
      summary.holdSeconds,
      summary.avgBottomAngle,
      JSON.stringify(summary.cues),
      videoUri,
      score,
      summary.firstActionMs,
      summary.lastActionMs,
      JSON.stringify(trimmed),
      videoAspect ?? null,
    );
    return true;
  } catch {
    return false;
  }
}

type Row = Omit<SessionRecord, 'cues' | 'timeline'> & { cues: string; timeline: string | null };

function toRecord(row: Row): SessionRecord {
  return { ...row, cues: safeParseCues(row.cues), timeline: safeParseTimeline(row.timeline) };
}

// Stats/list views (Insights, "best run" lookups) only ever read
// reps/holdSeconds/score/etc — never the per-frame timeline, which is by far
// the largest column (it's raw pose data). Leaving it out of both the query
// and the parse here avoids hauling and JSON-parsing up to 100 sessions'
// worth of replay data just to compute a streak or a rep total. Anything that
// needs the real timeline (single-session replay, full-fidelity export) uses
// getSession/listSessionsFull instead.
const LIST_COLUMNS =
  'id, exerciseId, exerciseName, createdAt, durationMs, reps, holdSeconds, avgBottomAngle, cues, videoUri, score, firstActionMs, lastActionMs, videoAspect';

export async function listSessions(limit = 100): Promise<SessionRecord[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Omit<Row, 'timeline'>>(
    `SELECT ${LIST_COLUMNS} FROM sessions ORDER BY createdAt DESC LIMIT ?`,
    limit,
  );
  return rows.map((row) => ({ ...row, cues: safeParseCues(row.cues), timeline: [] }));
}

export async function getSession(id: string): Promise<SessionRecord | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<Row>(`SELECT * FROM sessions WHERE id = ?`, id);
  return row ? toRecord(row) : null;
}

/** Full-fidelity read (timeline included) for the rare cases that need every
 * row's replay data at once — right now just the JSON data export. */
export async function listSessionsFull(limit = 100000): Promise<SessionRecord[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Row>(`SELECT * FROM sessions ORDER BY createdAt DESC LIMIT ?`, limit);
  return rows.map(toRecord);
}

export async function deleteSession(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM sessions WHERE id = ?`, id);
}

/** Wipes every logged session. Used by Settings → Backup & Data → Delete all data. */
export async function clearAllSessions(): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM sessions`);
}

/** A session as backed up to iCloud — stats/cues only, no video or per-frame timeline. */
export type CloudSessionRecord = Omit<SessionRecord, 'timeline' | 'videoUri'>;

/**
 * Inserts a session pulled from an iCloud backup, unless one with the same id
 * already exists locally (e.g. restoring on the device that made it, or
 * restoring twice) — a safe, idempotent merge rather than a full sync engine.
 * Returns true if it was actually a new row.
 */
export async function insertIfMissing(rec: CloudSessionRecord): Promise<boolean> {
  const db = await getDb();
  const existing = await db.getFirstAsync<{ id: string }>(`SELECT id FROM sessions WHERE id = ?`, rec.id);
  if (existing) return false;
  await db.runAsync(
    `INSERT INTO sessions
      (id, exerciseId, exerciseName, createdAt, durationMs, reps, holdSeconds, avgBottomAngle, cues, videoUri, score, firstActionMs, lastActionMs, timeline, videoAspect)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    rec.id,
    rec.exerciseId,
    rec.exerciseName,
    rec.createdAt,
    rec.durationMs,
    rec.reps,
    rec.holdSeconds,
    rec.avgBottomAngle,
    JSON.stringify(rec.cues),
    null,
    rec.score,
    rec.firstActionMs,
    rec.lastActionMs,
    JSON.stringify([]),
    null,
  );
  return true;
}

function safeParseCues(s: string): CueTally[] {
  try {
    return JSON.parse(s) as CueTally[];
  } catch {
    return [];
  }
}

function safeParseTimeline(s: string | null): TimelineSample[] {
  if (!s) return [];
  try {
    return JSON.parse(s) as TimelineSample[];
  } catch {
    return [];
  }
}
