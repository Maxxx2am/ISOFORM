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
  totalReps: number | null;
  totalHoldSeconds: number | null;
  activeMs: number | null;
  avgBottomAngle: number | null;
  cues: CueTally[];
  videoUri: string | null;
  videoAspect: number | null;
  score: number | null;
  firstActionMs: number | null;
  lastActionMs: number | null;
  segments: { startMs: number; endMs: number; reps: number }[];
  timeline: TimelineSample[];
  /** Free-text note the user wrote after this set. */
  note: string | null;
};

/** Body measurement log, one row per entry — used for trend charts on Profile. */
export type MeasurementRecord = {
  id: string;
  createdAt: number;
  weightKg: number | null;
  chestCm: number | null;
  waistCm: number | null;
  armCm: number | null;
  thighCm: number | null;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/** Columns added after the initial release — older DBs need them bolted on. */
const MIGRATION_COLUMNS: { name: string; ddl: string }[] = [
  { name: 'score', ddl: 'ALTER TABLE sessions ADD COLUMN score INTEGER;' },
  { name: 'firstActionMs', ddl: 'ALTER TABLE sessions ADD COLUMN firstActionMs INTEGER;' },
  { name: 'lastActionMs', ddl: 'ALTER TABLE sessions ADD COLUMN lastActionMs INTEGER;' },
  { name: 'timeline', ddl: 'ALTER TABLE sessions ADD COLUMN timeline TEXT;' },
  { name: 'videoAspect', ddl: 'ALTER TABLE sessions ADD COLUMN videoAspect REAL;' },
  { name: 'totalReps', ddl: 'ALTER TABLE sessions ADD COLUMN totalReps INTEGER;' },
  { name: 'totalHoldSeconds', ddl: 'ALTER TABLE sessions ADD COLUMN totalHoldSeconds INTEGER;' },
  { name: 'segments', ddl: 'ALTER TABLE sessions ADD COLUMN segments TEXT;' },
  { name: 'activeMs', ddl: 'ALTER TABLE sessions ADD COLUMN activeMs INTEGER;' },
  { name: 'note', ddl: 'ALTER TABLE sessions ADD COLUMN note TEXT;' },
];

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
        CREATE TABLE IF NOT EXISTS body_measurements (
          id TEXT PRIMARY KEY NOT NULL,
          createdAt INTEGER NOT NULL,
          weightKg REAL,
          chestCm REAL,
          waistCm REAL,
          armCm REAL,
          thighCm REAL
        );
      `);
      // Every prior version of this ran all 8 ALTERs unconditionally on EVERY
      // cold start, each one guaranteed to fail with "column already exists"
      // after the first time it ever succeeded — 8 wasted round-trips sitting
      // directly in front of the very first DB query, forever. Checking the
      // real schema once and only running what's actually missing turns that
      // into a single read on every launch after the first migration.
      const existing = new Set((await db.getAllAsync<{ name: string }>(`PRAGMA table_info(sessions);`)).map((c) => c.name));
      for (const col of MIGRATION_COLUMNS) {
        if (existing.has(col.name)) continue;
        try {
          await db.execAsync(col.ddl);
        } catch (e: unknown) { const msg = String(e); if (!msg.includes('duplicate column') && !msg.includes('already exists')) { throw e; } }
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
  note?: string | null,
): Promise<boolean> {
  try {
  const db = await getDb();
  const score = scoreSession(summary);
  const trimmed = trimTimelineForStorage(summary, timeline);
  await db.runAsync(
    `INSERT INTO sessions
      (id, exerciseId, exerciseName, createdAt, durationMs, reps, holdSeconds, avgBottomAngle, cues, videoUri, score, firstActionMs, lastActionMs, timeline, videoAspect, totalReps, totalHoldSeconds, segments, activeMs, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    summary.totalReps,
    summary.totalHoldSeconds,
    JSON.stringify(summary.segments),
    summary.activeMs,
    note ?? null,
  );
  return true; } catch { return false; }
}

type Row = Omit<SessionRecord, 'cues' | 'timeline' | 'segments'> & {
  cues: string;
  timeline: string | null;
  segments: string | null;
};

function toRecord(row: Row): SessionRecord {
  return {
    ...row,
    cues: safeParseCues(row.cues),
    timeline: safeParseTimeline(row.timeline),
    segments: safeParseSegments(row.segments),
  };
}

// Stats/list views (Insights, "best run" lookups) only ever read
// reps/holdSeconds/score/etc — never the per-frame timeline, which is by far
// the largest column (it's raw pose data). Leaving it out of both the query
// and the parse here avoids hauling and JSON-parsing up to 100 sessions'
// worth of replay data just to compute a streak or a rep total. Anything that
// needs the real timeline (single-session replay, full-fidelity export) uses
// getSession/listSessionsFull instead.
const LIST_COLUMNS =
  'id, exerciseId, exerciseName, createdAt, durationMs, reps, holdSeconds, avgBottomAngle, cues, videoUri, score, firstActionMs, lastActionMs, videoAspect, totalReps, totalHoldSeconds, segments, activeMs, note';

/**
 * Just the timestamps, for callers that only need to compute a streak (e.g.
 * the Train tab header) — avoids pulling the full session shape (cues, video
 * uri, segments, etc.) just to check "did I train recently."
 */
export async function listRecentSessionDates(limit = 400): Promise<number[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ createdAt: number }>(
    `SELECT createdAt FROM sessions ORDER BY createdAt DESC LIMIT ?`,
    limit,
  );
  return rows.map((r) => r.createdAt);
}

export async function listSessions(limit = 100): Promise<SessionRecord[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Omit<Row, 'timeline'>>(
    `SELECT ${LIST_COLUMNS} FROM sessions ORDER BY createdAt DESC LIMIT ?`,
    limit,
  );
  return rows.map((row) => ({
    ...row,
    cues: safeParseCues(row.cues),
    segments: safeParseSegments(row.segments),
    timeline: [],
  }));
}

/**
 * Same shape as `listSessions`, but scoped to one exercise via SQL instead of
 * fetching+parsing the whole history client-side — used anywhere that only
 * needs one exercise's best/recent result (exercise detail, pre-set "beat
 * your best" lookups) instead of every session ever logged.
 */
export async function listSessionsForExercise(exerciseId: string, limit = 100): Promise<SessionRecord[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Omit<Row, 'timeline'>>(
    `SELECT ${LIST_COLUMNS} FROM sessions WHERE exerciseId = ? ORDER BY createdAt DESC LIMIT ?`,
    exerciseId,
    limit,
  );
  return rows.map((row) => ({
    ...row,
    cues: safeParseCues(row.cues),
    segments: safeParseSegments(row.segments),
    timeline: [],
  }));
}

/**
 * Same shape as `listSessionsForExercise`, but across every exercise — the
 * most recent `limit` sessions, for iCloud backup (`src/lib/icloudSync.ts`).
 * Callers there narrow this down to `CloudSessionRecord` themselves (drop
 * `videoUri`); this just avoids hauling the heavy `timeline` column into
 * memory for something that's about to be dropped anyway.
 */
export async function listSessionsForSync(limit: number): Promise<SessionRecord[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Omit<Row, 'timeline'>>(
    `SELECT ${LIST_COLUMNS} FROM sessions ORDER BY createdAt DESC LIMIT ?`,
    limit,
  );
  return rows.map((row) => ({
    ...row,
    cues: safeParseCues(row.cues),
    segments: safeParseSegments(row.segments),
    timeline: [],
  }));
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
      (id, exerciseId, exerciseName, createdAt, durationMs, reps, holdSeconds, avgBottomAngle, cues, videoUri, score, firstActionMs, lastActionMs, timeline, videoAspect, totalReps, totalHoldSeconds, segments, activeMs)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    rec.totalReps,
    rec.totalHoldSeconds,
    JSON.stringify(rec.segments),
    rec.activeMs,
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

function safeParseSegments(s: string | null): { startMs: number; endMs: number; reps: number }[] {
  if (!s) return [];
  try {
    return JSON.parse(s) as { startMs: number; endMs: number; reps: number }[];
  } catch {
    return [];
  }
}

// ── Body measurements ──

export async function saveMeasurement(m: Omit<MeasurementRecord, 'id'> & { id?: string }): Promise<void> {
  const db = await getDb();
  const id = m.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await db.runAsync(
    `INSERT OR REPLACE INTO body_measurements (id, createdAt, weightKg, chestCm, waistCm, armCm, thighCm) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id, m.createdAt, m.weightKg ?? null, m.chestCm ?? null, m.waistCm ?? null, m.armCm ?? null, m.thighCm ?? null,
  );
}

export async function listMeasurements(limit = 100): Promise<MeasurementRecord[]> {
  const db = await getDb();
  return db.getAllAsync<MeasurementRecord>(
    `SELECT * FROM body_measurements ORDER BY createdAt DESC LIMIT ?`, limit,
  );
}

export async function listMeasurementsAsc(limit = 100): Promise<MeasurementRecord[]> {
  const db = await getDb();
  return db.getAllAsync<MeasurementRecord>(
    `SELECT * FROM body_measurements ORDER BY createdAt ASC LIMIT ?`, limit,
  );
}

export async function deleteMeasurement(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM body_measurements WHERE id = ?`, id);
}
