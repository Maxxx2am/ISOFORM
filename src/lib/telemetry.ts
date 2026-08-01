/**
 * Beta feedback pipeline — strictly opt-in (see Settings, `telemetryOptIn`).
 * Uploads a finished session's rep-counting data (the exact angles/score/cues
 * SessionEngine produced — no images) to a private Supabase Storage bucket so
 * it can actually be reviewed for bugs, since almost none of this app's
 * exercise logic has been checked against real footage. Video is a SEPARATE,
 * more sensitive opt-in (`telemetryIncludeVideo`) — off even when the main
 * toggle is on.
 *
 * Plain fetch against Supabase's Storage REST API, not the supabase-js SDK —
 * no new native dependency, stays Expo-Go compatible. SUPABASE_ANON_KEY below
 * must be an anon key restricted by an RLS policy to INSERT-only on this one
 * bucket (see setup notes) — even read out of the app bundle, it can't list,
 * read, or delete anyone's uploads.
 *
 * SUPABASE_URL/SUPABASE_ANON_KEY are configured below against a real
 * Supabase project — `configured()` and the silent-no-op fallback stay in
 * place as a defensive guard (never throws even if these were ever cleared
 * out), not because they're currently blank.
 */
import type { SessionSummary, TimelineSample } from '@/engine/sessionEngine';
import { useSettings } from '@/store/settings';

const SUPABASE_URL = 'https://jxpswgmnsdnjrmpdgyta.supabase.co';
// Legacy JWT anon key — swapped in after the new sb_publishable_ key format
// hit a 403 "violates row-level security policy" even against a maximally
// permissive `with check (true)` policy, meaning the request wasn't being
// authorized as a recognized role at all before reaching Postgres. Safe to
// embed: scoped to insert-only by the RLS policy on this one bucket.
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp4cHN3Z21uc2RuanJtcGRneXRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUwMTQzMTgsImV4cCI6MjEwMDU5MDMxOH0.x1nX5JGcnXuqI22LaEoAyAWHrxlNJitpVchEUHlcwIw';
const BUCKET = 'isoform-telemetry';

function configured(): boolean {
  return SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;
}

/** e.g. "Handstand Push-Up (HSPU)" -> "handstand-push-up-hspu" */
function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Human-readable, self-describing file base name — so the exercise, date, and
 * result are visible straight from the Supabase file list, without opening
 * anything, when there are many sessions to sort through (especially once
 * more than one person is testing and bug-fix verification means finding one
 * specific clip). The session id's last 6 chars stay on the end only to
 * guarantee uniqueness, not as the primary identifier anymore.
 */
function fileBaseName(id: string, exerciseName: string, createdAt: number, summary: SessionSummary): string {
  const date = new Date(createdAt).toISOString().slice(0, 10);
  const stat = summary.mode === 'hold' ? `${summary.holdSeconds}s` : `${summary.reps}reps`;
  return `${date}_${slugify(exerciseName)}_${stat}_${id.slice(-6)}`;
}

async function uploadObject(path: string, body: BodyInit, contentType?: string): Promise<void> {
  // No x-upsert: session ids are always unique, never overwritten, and upsert
  // makes Storage check for an existing object first — that pre-check needs
  // its own SELECT/UPDATE authorization separate from the INSERT policy,
  // which could be exactly what's rejecting this as a generic RLS violation.
  const headers: Record<string, string> = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  };
  if (contentType) headers['Content-Type'] = contentType;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, { method: 'POST', headers, body });
  // fetch only rejects on a network failure — a rejected upload (bad key,
  // RLS policy mismatch, bucket typo) comes back as a normal non-ok response,
  // so that has to be checked explicitly or a real failure would look silent.
  if (!res.ok) throw new Error(`upload ${path} failed: ${res.status} ${await res.text().catch(() => '')}`);
}

/**
 * Call right after `saveSession()` succeeds, with the same arguments — fire-
 * and-forget, never throws into the caller (a failed beta upload must never
 * affect the workout flow, same reasoning as `schedulePushToCloud`).
 */
export function uploadSessionTelemetry(
  id: string,
  exerciseName: string,
  createdAt: number,
  summary: SessionSummary,
  videoUri: string | null,
  timeline: TimelineSample[],
): void {
  const { telemetryOptIn, telemetryIncludeVideo } = useSettings.getState();
  if (!telemetryOptIn || !configured()) return;

  const base = fileBaseName(id, exerciseName, createdAt, summary);

  (async () => {
    try {
      const payload = { id, exerciseName, createdAt, summary, timeline };
      await uploadObject(`sessions/${base}.json`, JSON.stringify(payload), 'application/json');

      if (telemetryIncludeVideo && videoUri) {
        const ext = videoUri.split('.').pop()?.split('?')[0] || 'mp4';
        const form = new FormData();
        // RN's FormData accepts a { uri, name, type } file descriptor as the
        // value for a multipart part — the DOM lib FormData types this method
        // expects only string | Blob, so this needs a narrow cast.
        form.append('file', { uri: videoUri, name: `${base}.${ext}`, type: `video/${ext}` } as unknown as Blob);
        await uploadObject(`videos/${base}.${ext}`, form);
      }
      console.log(`[telemetry] uploaded ${base}${telemetryIncludeVideo && videoUri ? ' (+video)' : ''}`);
    } catch (e) {
      // Best-effort — never let a failed beta upload affect the workout flow.
      // Logged (not silent) during the beta phase so a real failure is visible
      // in the Metro terminal instead of just vanishing.
      console.warn('[telemetry] upload failed:', e);
    }
  })();
}
