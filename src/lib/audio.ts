/**
 * Coach audio: a rep "ding" (expo-audio) and a spoken form coach (expo-speech).
 * Both are best-effort — wrapped so a device without audio never crashes a set.
 */
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import * as Speech from 'expo-speech';

let dingPlayer: AudioPlayer | null = null;
let audioModeSet = false;

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

/**
 * Speak a coaching phrase, but sparingly: at least 4s between any two cues, and
 * the same phrase won't repeat within 9s — so it corrects, it doesn't nag.
 */
export function speakCue(phrase: string | null | undefined, now: number) {
  if (!phrase) return;
  if (now - lastSpokeAt < 4000) return;
  if (phrase === lastPhrase && now - lastSpokeAt < 9000) return;
  lastSpokeAt = now;
  lastPhrase = phrase;
  try {
    Speech.stop();
    Speech.speak(phrase, { rate: 1.0, pitch: 1.0 });
  } catch {}
}

export function stopCoachAudio() {
  try {
    Speech.stop();
  } catch {}
  lastSpokeAt = 0;
  lastPhrase = '';
}

/** Three quick dings — the workout "goal reached" sound. Reuses the same
 * ding asset instead of shipping a second sound file. */
export function tripleBeep() {
  playDing();
  setTimeout(playDing, 220);
  setTimeout(playDing, 440);
}

/**
 * Announce a workout goal out loud, immediately — unlike `speakCue`, this is
 * NOT rate-limited: a goal hit is a rare, one-shot event (not frequent form
 * chatter), so it must not get silently swallowed by the 4s/9s cue throttle.
 * Interrupts whatever the coach was mid-saying so the goal news always lands.
 */
export function announceGoal(phrase: string) {
  try {
    Speech.stop();
    Speech.speak(phrase, { rate: 1.0, pitch: 1.0 });
  } catch {}
}
