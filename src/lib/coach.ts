/** Turns a session summary into coach-style advice (specific, actionable). */
import { getExercise, getNextProgression } from '@/exercises/data';
import { scoreSession, type SessionSummary } from '@/engine/sessionEngine';

/** Specific fixes keyed by the short cue text the engine emits. */
const CUE_ADVICE: Record<string, string> = {
  'Chest up': 'Keep your chest proud and eyes forward as you descend — it stops you tipping onto your toes.',
  'Go lower': 'Break parallel on every rep. A deeper rep with control beats a shallow fast one.',
  'Go a little lower': 'Get your elbows closer to ninety degrees before pressing back up — the last few inches build the most strength.',
  'Lift your feet': 'Pull your feet fully off the floor and keep pulling your knees up — floating feet are what makes this a planche, not a plank.',
  'Straighten your line': 'Squeeze your abs and glutes to flatten the arch in your back — a straight line holds a lot longer than a banana.',
  'Straighten your legs': 'Lock your knees straight and point your toes — bent legs shorten your line and make the hold harder to judge.',
  'Straighten your body': 'Squeeze your glutes and brace your abs so your hips don\'t sag — one straight line head to heels.',
  'Stay tall': 'Keep your torso upright through the lunge; let your legs do the work, not your back.',
  'Lift your hips': 'Your hips are dropping — squeeze your glutes and push them up into a straight line.',
  "Don't overarch": 'Squeeze your glutes to hold the position instead of cranking your lower back — the arch should come from your hips, not your spine.',
  'Sit lower': 'Slide down the wall until your thighs are parallel to the floor.',
  'Lower your hips': 'You\'re piking up — bring your hips down in line with your shoulders and heels.',
  'Pull higher': 'Drive your elbows down and back to get your chin fully over the bar.',
  'Sit all the way up': 'Finish each rep with your torso near vertical — don\'t cut the top short.',
  'Reach fully overhead': 'Fully extend your arms overhead so your hands nearly touch at the top.',
  'Kick up into your handstand': 'Commit to the kick and stack your hips over your hands — a wall helps.',
  'Straighten — squeeze your line': 'Squeeze glutes and ribs to kill the banana back and hold a straight line.',
  'Sit lower — aim for 90°': 'Slide a little lower until your thighs are parallel to the floor.',
  'Come up slightly': 'You\'re past 90° — rise a touch so your knees aren\'t overloaded.',
  "Don't let your hips sag": 'Push your hips up and squeeze your glutes — a sagging lower back strains your spine.',
  "Tuck your elbows in": 'Keep your elbows at 45° to your torso, not flared out to 90° — it protects your shoulders.',
  'Chin over the bar': 'Pull all the way until your chin clears the bar — half reps won\'t build full strength.',
  'Lock out at the bottom': 'Full extension at the bottom is essential — don\'t skip the dead hang.',
  'No kipping': 'Control the movement with your back and arms, not momentum from your legs.',
  'Depress your shoulders': 'Push your shoulders down, not up toward your ears — it engages your lats.',
  'Neutral neck': 'Keep your gaze at the floor, neck in line with your spine — craning forward strains it.',
  'Go deeper': 'Lower all the way — partial reps skip the hardest part of the range of motion.',
  'Keep hips high': 'Your hips are the highest point in the pike — don\'t let them drop toward the floor.',
  'Knees over toes': 'Push your knees out in line with your toes — don\'t let them cave inward.',
  'Lean forward slightly': 'A slight forward lean brings your chest into the dip — stay upright and it\'s all triceps.',
  'Straighten and squeeze your legs': 'Point your toes and squeeze your legs together for a tighter line.',
  'Gaze between your hands': 'Looking back drops your shoulders open — keep your gaze between your hands.',
  // Planche path
  'Lock your arms': 'Straight arms are non-negotiable in planche work — locked elbows protect your joints and build the right strength.',
  "Don't touch the floor": 'Your feet should float — keep pulling your knees up and leaning forward harder.',
  'Pull knees tighter': 'Squeeze your knees closer to your chest for a tighter, stronger tuck.',
  'Straighten your back': 'Push your chest forward and pull your shoulders back — a piked back leaks planche strength.',
  // Front Lever path
  'Straight arms': 'Lock your elbows completely — bent arms mean you\'re doing a front lever row, not a static hold.',
  'Level your hips': 'Your hips must be level with your shoulders — lift them up to make your body horizontal.',
  'Tuck your knees tighter (Front Lever)': 'Pull your knees all the way to your chest — the tighter the tuck, the easier the lever.',
  'Straighten your legs (Front Lever)': 'Point your toes and squeeze your legs together — a straight line holds longer.',
  // HeSPU / 90°
  'Lower slower': 'Control the descent — 3–5 seconds per rep builds serious strength and control.',
  'Elbows at 90°': 'Find the 90° sweet spot — too bent and you\'re resting, too straight and you\'re not working.',
  'Straighten a bit': 'You\'re below 90° — lift slightly to find the hold position.',
  'Bend more': 'You\'re above 90° — lower your elbows to the target angle.',
  'Stop at 90°': 'This variation deliberately stops around 90° — save the deeper range for full HSPU work.',
  'Don\'t lock out': 'Keep this one short of a full lockout — that keeps tension on your shoulders through the whole set.',
  // V-Sit
  'Lift higher': 'Drive your legs toward vertical — think toes to the ceiling.',
  "Don't swing (V-Sit)": 'Everything comes from compression, not momentum.',
  'Lift your legs higher': 'Push your legs closer to vertical — your core can take it.',
  // Pistol
  'Straighten your extended leg': 'Keep your front leg locked straight — bent makes the squat harder and less effective.',
  // Hanging Knee Raise
  'Knees higher': 'Raise your knees above your hips for a full contraction — partial reps waste the set.',
  'Stop swinging': 'Control the movement with your core, not momentum. Pause at the top and bottom.',
  // Muscle-Up
  'Pull higher (Muscle-Up)': 'Pull your chest to the bar — the transition needs that extra height.',
  'Punch through the transition': 'Rotate your wrists and punch your elbows over the bar — that\'s the whole muscle-up.',
  'Lower slower (Transition)': '3–5 seconds down through the transition builds the strength to do it up.',
  'Chest to bar': 'Drive your chest to the bar — not your chin. The higher you pull, the easier the transition.',
};

export type Coaching = { verdict: string; advice: string[] };

export function coachNotes(summary: SessionSummary, context?: { previousBest?: number | null }): Coaching {
  const ex = getExercise(summary.exerciseId);
  const advice: string[] = [];

  const previousBest = context?.previousBest ?? null;
  const currentValue = summary.mode === 'hold' ? summary.holdSeconds : summary.reps;
  const beatRecord = previousBest != null && currentValue > previousBest;
  if (beatRecord) {
    const unit = summary.mode === 'hold' ? 's' : ' reps';
    advice.push(`New best — you beat your previous ${previousBest}${unit} by ${currentValue - previousBest}${unit}. Keep pushing this one.`);
  }

  for (const c of summary.cues.slice(0, 2)) {
    advice.push(CUE_ADVICE[c.cue] ?? `Focus on: ${c.cue.toLowerCase()}.`);
  }
  if (summary.depthScore != null && summary.depthScore < 70 && summary.avgBottomAngle != null && summary.targetAngle != null) {
    advice.push(`You averaged ${Math.round(summary.avgBottomAngle)}° at the bottom — aim closer to ${summary.targetAngle}° for full range.`);
  } else if (summary.depthScore != null && summary.depthScore < 70) {
    advice.push('Your depth is short of the target angle — slow down and hit full range on each rep.');
  }
  if (summary.consistencyScore != null && summary.consistencyScore < 70) {
    advice.push('Your reps varied in depth — settle on one tempo and make every rep look identical.');
  }
  if (summary.mode === 'reps' && summary.avgRepSeconds != null && summary.avgRepSeconds < 1.2) {
    advice.push('You’re moving quickly — a 2–3 second lowering phase builds more strength and control.');
  }
  if (summary.mode === 'hold' && summary.formQuality != null && summary.formQuality < 70) {
    advice.push('Your back curved during the hold — think “push tall, ribs in” to flatten the line.');
  }
  if (summary.mode === 'hold' && summary.attempts > 2) {
    advice.push('You fell a few times — shorten the hold slightly and nail a clean line before chasing time.');
  }

  const next = ex ? getNextProgression(ex) : undefined;
  if (advice.length === 0) {
    advice.push('Clean, controlled work — add reps, add time, or start working toward the next progression.');
    if (next) advice.push(`When this feels easy, progress to ${next.name}.`);
  }

  // Round out the feedback with one rotating tip from the exercise's full tip
  // pool (10+ per move) so review doesn't repeat the same 1-2 lines every set.
  if (ex && ex.cues.length > 0 && advice.length < 4) {
    const seed = (summary.reps + summary.holdSeconds + summary.attempts + Math.round(summary.avgBottomAngle ?? 0)) % ex.cues.length;
    const extra = ex.cues[seed];
    if (!advice.includes(extra)) advice.push(extra);
  }

  const score = scoreSession(summary);
  const verdict = beatRecord
    ? 'A new personal best — great work.'
    : score >= 90
      ? 'Excellent set — this is dialed in.'
      : score >= 80
        ? 'Strong work. A couple of small tweaks and this is perfect.'
        : score >= 55
          ? 'Solid effort — here’s where to sharpen it.'
          : 'Good start — let’s clean up the fundamentals.';

  return { verdict, advice: advice.slice(0, 5) };
}
