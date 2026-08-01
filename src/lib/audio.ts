/**
 * Coach audio: a rep "ding" (expo-audio) and a spoken form coach (expo-speech).
 * Both are best-effort — wrapped so a device without audio never crashes a set.
 */
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import * as Speech from 'expo-speech';

let dingPlayer: AudioPlayer | null = null;
let audioModeSet = false;

// Tracked for cancellation when the tracking screen unmounts — otherwise
// queued setTimeout callbacks for tripleBeep (220ms + 440ms delays) survive
// the component being torn down and play a ghost ding after navigation.
let pendingDings: ReturnType<typeof setTimeout>[] = [];

async function ensureAudioMode() {
  if (audioModeSet) return;
  audioModeSet = true;
  try {
    // Play through the silent switch and duck (not stop) other audio.
    await setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' });
  } catch {}
}

/** Preload the ding + audio session. Call when a set begins. */
export function initCoachAudio() {
  ensureAudioMode();
  if (!dingPlayer) {
    try {
      dingPlayer = createAudioPlayer(require('../../assets/sounds/ding.wav'));
    } catch {
      dingPlayer = null;
    }
  }
}

export function playDing() {
  try {
    if (!dingPlayer) initCoachAudio();
    dingPlayer?.seekTo(0);
    dingPlayer?.play();
  } catch {}
}

// Voice coach rate limiting.
let lastSpokeAt = 0;
let lastPhrase = '';
// The deferred setTimeout below has no way to be cancelled once queued
// unless something tracks its id — without this, a cue or goal announcement
// that lands the same tick the user finishes/exits the set could still speak
// a moment later, after stopCoachAudio() already ran on unmount, because the
// bare setTimeout it scheduled had nothing cancelling it.
let pendingSpeechTimer: ReturnType<typeof setTimeout> | null = null;

function clearPendingSpeech() {
  if (pendingSpeechTimer != null) {
    clearTimeout(pendingSpeechTimer);
    pendingSpeechTimer = null;
  }
}

/**
 * Speak a coaching phrase, but sparingly: at least 4s between any two cues, and
 * the same phrase won't repeat within 9s — so it corrects, it doesn't nag.
 * Uses a short setTimeout to defer the native Speech.speak() call off the
 * current frame-processing tick — without this, TTS's native bridge call
 * would block the JS thread mid-rep and cause a visible freeze/stutter.
 * Speech rate lowered to 0.9 (from 1.0) to smooth out playback.
 */
export function speakCue(phrase: string | null | undefined, now: number) {
  if (!phrase) return;
  if (now - lastSpokeAt < 4000) return;
  if (phrase === lastPhrase && now - lastSpokeAt < 9000) return;
  lastSpokeAt = now;
  lastPhrase = phrase;
  clearPendingSpeech();
  pendingSpeechTimer = setTimeout(() => {
    pendingSpeechTimer = null;
    try {
      Speech.stop();
      Speech.speak(phrase, { rate: 0.9, pitch: 1.0 });
    } catch {}
  }, 10);
}

export function stopCoachAudio() {
  clearPendingSpeech();
  // Cancel any tripleBeep timeouts still queued so they don't fire after
  // the tracking screen has been unmounted (ghost ding on the review screen).
  for (const t of pendingDings) clearTimeout(t);
  pendingDings = [];
  try {
    Speech.stop();
  } catch {}
  lastSpokeAt = 0;
  lastPhrase = '';
  // Reset audio mode — if the OS kills the session while backgrounded,
  // the next initCoachAudio call needs to re-establish it.
  audioModeSet = false;
}

/** Three quick dings — the workout "goal reached" sound. Reuses the same
 * ding asset instead of shipping a second sound file. */
export function tripleBeep() {
  playDing();
  pendingDings.push(setTimeout(playDing, 220));
  pendingDings.push(setTimeout(playDing, 440));
}

/**
 * Announce a workout goal out loud, immediately — unlike `speakCue`, this is
 * NOT rate-limited: a goal hit is a rare, one-shot event (not frequent form
 * chatter), so it must not get silently swallowed by the 4s/9s cue throttle.
 * Interrupts whatever the coach was mid-saying so the goal news always lands.
 */
export function announceGoal(phrase: string) {
  clearPendingSpeech();
  pendingSpeechTimer = setTimeout(() => {
    pendingSpeechTimer = null;
    try {
      Speech.stop();
      Speech.speak(phrase, { rate: 0.9, pitch: 1.0 });
    } catch {}
  }, 10);
}
