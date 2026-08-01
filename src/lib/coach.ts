/** Turns a session summary into coach-style advice (specific, actionable). */
import { getExercise, getNextProgression } from '@/exercises/data';
import { scoreSession, type SessionSummary } from '@/engine/sessionEngine';

/**
 * Specific fixes keyed by `${exerciseSlug}: { [ruleId]: advice }` — NOT by
 * the cue's display text. Cue text is expected to change/expand a lot (every
 * exercise is growing from ~2-4 cues to 10+), and several exercises already
 * shared identical short cue text ("Straighten your legs", "Go deeper",
 * "Lift higher"...) while meaning different things — a flat text-keyed map
 * either silently drops advice on a wording edit or, worse, hands one
 * exercise's advice to an unrelated one that happens to share a phrase
 * (this had already happened: superman-hold and leg-raise were both
 * inheriting l-to-v-raises' "toes to the ceiling" advice through a shared
 * 'Lift higher' key). `FormRule.id` is stable per exercise and unique within
 * it, so that's the real key.
 */
const CUE_ADVICE: Record<string, Record<string, string>> = {
  pushup: {
    'body-line': 'Squeeze your glutes and brace your abs so your hips don\'t sag — one straight line head to heels.',
    depth: 'Get your elbows closer to ninety degrees before pressing back up — the last few inches build the most strength.',
    'sagging-hips': 'Push your hips up and squeeze your glutes — a sagging lower back strains your spine.',
    piked: 'Bring your hips back down in line with your shoulders — you\'re piking, not pressing.',
    'elbow-flare': 'Keep your elbows at 45° to your torso, not flared out to 90° — it protects your shoulders.',
    'hands-wide': 'Bring your hands in a bit — very wide hands put extra strain on your shoulders.',
    'hands-narrow': 'Widen your hands slightly — very narrow hands strain your wrists and elbows.',
    'uneven-arms': 'Press evenly with both arms — one side is doing more of the work than the other.',
    'head-drop': 'Keep your neck neutral — eyes just ahead of your hands, not staring straight down.',
    'hip-twist': 'Keep your hips square to the floor — don\'t let your torso twist as you press.',
  },
  pullup: {
    partial: 'Pull all the way until your chin clears the bar — half reps won\'t build full strength.',
    'no-lockout': 'Full extension at the bottom is essential — don\'t skip the dead hang.',
    kipping: 'Control the movement with your back and arms, not momentum from your legs.',
    'legs-swinging': 'Keep your legs still and braced — swinging them steals momentum from your back.',
    shrug: 'Relax your shoulders and hang first — starting hunched up disengages your lats.',
    'hands-wide': 'Bring your grip in a bit — very wide adds unnecessary shoulder strain.',
    'hands-narrow': 'Widen your grip slightly — very narrow strains your wrists.',
    'uneven-pull': 'Pull evenly with both arms — one side is doing more of the work.',
    'uneven-grip': 'Even out your grip height — one hand is noticeably higher on the bar.',
    'shoulder-tilt': 'Keep your shoulders level — you\'re rotating around the bar.',
  },
  'l-sit': {
    'locked-arms': 'Fully extend your elbows — a bent arm means you\'re not really supporting the hold.',
    'bent-legs-mild': 'Your knees are starting to bend — lock them out straight.',
    'bent-legs': 'Lock your knees straight and point your toes — bent legs shorten your line and make the hold harder to judge.',
    shrug: 'Push your shoulders down, not up toward your ears — it engages your lats.',
    neck: 'Keep your gaze forward, not down at your feet.',
    'feet-low': 'Press down harder and lift — your feet are barely off the floor.',
    'uneven-legs': 'Raise both legs together — one is higher than the other.',
  },
  plank: {
    'body-line': 'Brace your core and glutes to tighten that line from head to heels.',
    sag: 'Your hips are dropping — squeeze your glutes and push them up into a straight line.',
    piked: 'You\'re piking up — bring your hips down in line with your shoulders and heels.',
    'neutral-neck': 'Keep your gaze at the floor, neck in line with your spine — craning forward strains it.',
    'head-drop': 'Keep your head in line with your spine — don\'t let it hang down.',
    shrug: 'Push your shoulders down away from your ears instead of shrugging.',
    'elbows-mild': 'Slide your elbows back under your shoulders for a stronger, steadier base.',
    'elbows-not-stacked': 'Stack your elbows directly under your shoulders — they\'ve drifted well off.',
    'knees-mild': 'Lock your knees out straight before they bend any further.',
    'bent-knees': 'Straighten your legs fully — bent knees shorten the hold and make it easier than it should be.',
  },
  squat: {
    shallow: 'Break parallel on every rep. A deeper rep with control beats a shallow fast one.',
    'no-lockout': 'Finish the rep — lock your hips out fully at the top instead of stopping short.',
    'chest-up-mild': 'Start lifting your chest before you fold forward any further.',
    'chest-up': 'Keep your chest proud and eyes forward as you descend — it stops you tipping onto your toes.',
    'knee-forward-mild': 'Your knees are starting to travel well past your toes — sit back into your hips a bit more.',
    'knee-forward': 'Your knees are traveling too far past your toes — push your hips back more.',
    'heel-lift': 'Keep your weight through your midfoot and heel, not your toes.',
  },
  dip: {
    shallow: 'Lower all the way — partial reps skip the hardest part of the range of motion.',
    'too-deep': 'If you feel any pinching in your shoulders, don\'t go lower than this.',
    'no-lockout': 'Press all the way to a full lockout at the top of every rep.',
    shrug: 'Pull your shoulder blades down and back instead of letting them creep up toward your ears.',
    'legs-swinging': 'Keep your core tight so your legs don\'t swing.',
    'uneven-arms': 'Press evenly with both arms — one is pressing more than the other.',
  },
  handstand: {
    banana: 'Squeeze glutes and ribs to kill the banana back and hold a straight line.',
    'bent-knees': 'Point your toes and squeeze your legs together for a tighter line.',
    'bent-knees-severe': 'Your knees are badly bent — straighten them, that\'s a tuck, not a handstand.',
    gaze: 'Looking back drops your shoulders open — keep your gaze between your hands.',
    'bent-arms': 'Lock your arms — a soft elbow makes balance much harder.',
    'not-stacked': 'Stack your hips directly over your shoulders — that\'s the base of the whole balance.',
    'not-balanced': 'Stack your shoulders back over your wrists — that\'s what\'s pulling you off balance.',
    'legs-apart': 'Point your toes and squeeze your legs together for a tighter line.',
    'uneven-arms': 'Push evenly through both arms — one is taking more of the load.',
  },
  'tuck-planche': {
    'locked-arms': 'Straight arms are non-negotiable in planche work — locked elbows protect your joints and build the right strength.',
    'feet-up': 'Pull your feet fully off the floor and keep pulling your knees up — floating feet are what makes this a planche, not a plank.',
    'tuck-tight': 'Squeeze your knees closer to your chest for a tighter, stronger tuck.',
    'flat-back-mild': 'Start flattening your back before it becomes a real pike.',
    'flat-back': 'Push your chest forward and pull your shoulders back — a piked back leaks planche strength.',
    shrug: 'Push your shoulder blades away from your ears — protract, don\'t shrug.',
    'uneven-arms': 'Even out the support on both arms — one is taking more of the load.',
    'knees-apart': 'Keep your knees together for a tighter, more compact tuck.',
    'lean-more': 'Lean your shoulders further forward, well past your hands.',
    gaze: 'Keep your neck neutral, gaze slightly forward of your hands.',
  },
  'adv-tuck-planche': {
    'locked-arms': 'Straight arms are non-negotiable in planche work — locked elbows protect your joints and build the right strength.',
    'flat-back-mild': 'Start flattening your back before it becomes a real sag or pike.',
    'flat-back': 'Push your chest forward and pull your shoulders back — a piked back leaks planche strength.',
    'feet-up': 'Your feet should float — keep pulling your knees up and leaning forward harder.',
    'hips-not-level': 'Your hips should sit roughly level with your shoulders at this stage.',
    shrug: 'Push your shoulder blades away from your ears — protract, don\'t shrug.',
    'uneven-arms': 'Even out the support on both arms — one is taking more of the load.',
    'knees-apart': 'Keep your knees together for a tighter line.',
    'lean-more': 'Lean your shoulders further forward, well past your hands.',
  },
  planche: {
    'locked-arms': 'Straight arms are non-negotiable in planche work — locked elbows protect your joints and build the right strength.',
    'bent-knees': 'Lock your knees straight and point your toes — bent legs shorten your line and make the hold harder to judge.',
    'flat-back': 'Push your chest forward and pull your shoulders back — a piked back leaks planche strength.',
    'hips-low': 'Your hips are dropping — squeeze your glutes and push them up into a straight line.',
    shrug: 'Push your shoulder blades away from your ears — protract, don\'t shrug.',
    'uneven-arms': 'Even out the support on both arms — one is taking more of the load.',
    'legs-apart': 'Point your toes and squeeze your legs together.',
    'lean-more': 'Lean your shoulders further forward, well past your hands.',
  },
  'tuck-front-lever': {
    'bent-arms': 'Lock your elbows completely — bent arms mean you\'re doing a front lever row, not a static hold.',
    'tuck-tighter': 'Squeeze your knees closer to your chest for a tighter, stronger tuck.',
    'hips-dropping': 'Your hips must be level with your shoulders — lift them up to make your body horizontal.',
    shrug: 'Pull your shoulder blades down and back instead of shrugging up.',
    'hands-wide': 'Bring your grip in a bit — very wide adds unnecessary shoulder strain.',
    'hands-narrow': 'Widen your grip slightly — very narrow strains your wrists.',
    'uneven-arms': 'Even out the load on both arms — one is more locked out than the other.',
    'shoulder-tilt': 'Keep your shoulders level — you\'re rotating around the bar.',
    neck: 'Keep your chin slightly tucked, not craned up.',
    'knees-apart': 'Keep your knees together for a tighter, easier tuck.',
  },
  'adv-tuck-front-lever': {
    'bent-arms': 'Lock your elbows completely — bent arms mean you\'re doing a front lever row, not a static hold.',
    'too-tucked': 'Extend your knees back a bit further than a basic tuck — you\'re ready to open up more.',
    'hips-dropping': 'Your hips must be level with your shoulders — lift them up to make your body horizontal.',
    shrug: 'Pull your shoulder blades down and back instead of shrugging up.',
    'hands-wide': 'Bring your grip in a bit — very wide adds unnecessary shoulder strain.',
    'hands-narrow': 'Widen your grip slightly — very narrow strains your wrists.',
    'uneven-arms': 'Even out the load on both arms — one is more locked out than the other.',
    'shoulder-tilt': 'Keep your shoulders level — you\'re rotating around the bar.',
    neck: 'Keep your chin slightly tucked, not craned up.',
    'knees-apart': 'Keep your knees together for a tighter line.',
  },
  'front-lever': {
    'bent-arms': 'Lock your elbows completely — bent arms mean you\'re doing a front lever row, not a static hold.',
    'bent-knees': 'Lock your knees straight and point your toes — bent legs shorten your line and make the hold harder to judge.',
    sag: 'Your hips are dropping — squeeze your glutes and push them up into a straight line.',
    'hip-creep': 'Fight to keep full extension at the hip — it\'s drawing in toward a tuck.',
    shrug: 'Pull your shoulder blades down and back hard instead of shrugging up.',
    'hands-wide': 'Bring your grip in a bit — very wide adds unnecessary shoulder strain.',
    'hands-narrow': 'Widen your grip slightly — very narrow strains your wrists.',
    'uneven-arms': 'Even out the load on both arms — one is more locked out than the other.',
    'shoulder-tilt': 'Keep your shoulders level — you\'re rotating around the bar.',
    neck: 'Keep your neck neutral, gaze forward — not down at your feet.',
    'legs-apart': 'Point your toes and squeeze your legs together.',
  },
  hespu: {
    'banana-mild': 'Start bracing your abs now, before it turns into a full arch.',
    banana: 'Squeeze your abs and glutes to flatten the arch in your back — a straight line holds a lot longer than a banana.',
    shallow: 'Lower all the way — partial reps skip the hardest part of the range of motion.',
    'bent-knees': 'Point your toes and squeeze your legs together for a tighter, easier line.',
    'not-stacked': 'Keep your hips stacked over your shoulders as you press — don\'t let them drift.',
    'legs-apart': 'Squeeze your legs together for a tighter, easier line.',
    'uneven-arms': 'Press evenly with both arms — one is pressing more than the other.',
    'head-forward': 'Lower your head toward the floor between your hands, not out in front of them.',
    shrug: 'Push your shoulders down away from your ears through the press.',
  },
  'hspu-90': {
    banana: 'Squeeze your abs and glutes to flatten the arch in your back — a straight line holds a lot longer than a banana.',
    'too-deep': 'This variation deliberately stops around 90° — save the deeper range for full HSPU work.',
    'locking-out': 'Keep this one short of a full lockout — that keeps tension on your shoulders through the whole set.',
    'bent-knees': 'Point your toes and keep your legs together for a tighter, easier line.',
    'not-stacked': 'Keep your hips stacked over your shoulders through the whole range.',
    'legs-apart': 'Squeeze your legs together for a tighter, easier line.',
    'uneven-arms': 'Press evenly with both arms — one is pressing more than the other.',
    'head-forward': 'Keep your head between your hands, not drifting out in front of them.',
    shrug: 'Push your shoulders down away from your ears through the range.',
  },
  '90deg-hold': {
    'too-bent': 'You\'re below 90° — lift slightly to find the hold position.',
    'too-straight': 'You\'re above 90° — lower your elbows to the target angle.',
    banana: 'Squeeze your abs and glutes to flatten the arch in your back — a straight line holds a lot longer than a banana.',
    'bent-knees': 'Point your toes and squeeze your legs together for a cleaner line.',
    'not-stacked': 'Keep your hips stacked over your shoulders — that\'s what holds the line.',
    'legs-apart': 'Squeeze your legs together for a cleaner line.',
    'uneven-arms': 'Even out the load on both arms — one is taking more than the other.',
    neck: 'Keep your neck neutral, gaze between your hands.',
  },
  'l-to-v-raises': {
    'bent-legs-mild': 'Your knees are starting to bend — lock them out straight.',
    'bent-legs': 'Lock your knees straight and point your toes — bent legs shorten your line and make the hold harder to judge.',
    low: 'Lift your legs closer to vertical, toward a real V.',
    'locked-arms': 'Press down through straight arms — don\'t let your elbows bend as you lift.',
    shrug: 'Keep your shoulders down, away from your ears.',
    'uneven-legs': 'Lift both legs together — one is higher than the other.',
  },
  'v-sit': {
    'bent-knees-mild': 'Your knees are starting to bend — lock them out straight.',
    'bent-knees': 'Lock your knees straight and point your toes — bent legs shorten your line and make the hold harder to judge.',
    'not-high-enough': 'Push your legs closer to vertical, toward a real V — your core can take it.',
    'locked-arms': 'Press down through straight arms to support the hold.',
    shrug: 'Keep your shoulders down away from your ears.',
    'uneven-legs': 'Hold both legs together — one is higher than the other.',
  },
  pistol: {
    shallow: 'Lower all the way — partial reps skip the hardest part of the range of motion.',
    'extended-leg-bent': 'Keep your front leg locked straight — bent makes the squat harder and less effective.',
    'chest-up-mild': 'Start lifting your chest before you fold forward any further.',
    'chest-up': 'Keep your chest proud and eyes forward as you descend — it stops you tipping onto your toes.',
    'leg-touching': 'Keep your extended leg lifted the whole rep — it\'s drifting down toward the floor.',
    'heel-lift': 'Keep your weight through your support midfoot and heel, not your toes.',
    'knee-forward-mild': 'Your support knee is starting to travel well past your toes.',
    'knee-forward': 'Your support knee is traveling too far past your toes — sit back into your hip more.',
  },
  'hanging-knee-raise': {
    'bent-arms': 'Lock your elbows completely — bent arms mean you\'re swinging from your shoulders, not raising from your core.',
    partial: 'Raise your knees above your hips for a full contraction — partial reps waste the set.',
    swinging: 'Control the movement with your core, not momentum. Pause at the top and bottom.',
    'not-tucking': 'Curl your knees up rather than kicking your legs up straight.',
    shrug: 'Push your shoulders down away from your ears — hang, don\'t shrug.',
    'hands-wide': 'Bring your grip in a bit — very wide adds unnecessary shoulder strain.',
    'hands-narrow': 'Widen your grip slightly — very narrow strains your wrists.',
    'uneven-raise': 'Raise both knees together — one is rising higher than the other.',
    'neck-crane': 'Don\'t crane your neck looking down at your knees — keep it relaxed and in line.',
    'shoulder-tilt': 'Keep your shoulders level — you\'re rotating around the bar.',
  },
  'muscle-up': {
    'no-transition': 'Rotate your wrists and punch your elbows over the bar — that\'s the whole muscle-up.',
    'catch-low': 'Pull higher before you turn over — you\'re catching the transition too low.',
    'no-lockout': 'Press all the way to a full lockout at the top of the support.',
    banana: 'Keep your line tight through the pull — don\'t let your back arch.',
    shrug: 'Relax and hang first — starting with your shoulders hunched up disengages your lats.',
    'hands-wide': 'Bring your grip in a bit — very wide adds shoulder strain and a harder turnover.',
    'hands-narrow': 'Widen your grip slightly — very narrow strains your wrists through the turnover.',
    'uneven-pull': 'Drive evenly with both arms through the pull and turnover.',
    'uneven-grip': 'Even out your grip height — one hand is noticeably higher on the bar.',
    'shoulder-tilt': 'Keep your shoulders level through the turnover.',
  },
  'wall-sit': {
    'too-high': 'Slide down the wall until your thighs are parallel to the floor.',
    'too-low': 'You\'re past 90° — rise a touch so your knees aren\'t overloaded.',
    'back-off-wall-mild': 'Your back is starting to lift off the wall — press it flat again.',
    'back-off-wall': 'Press your back flat against the wall for a safer, more effective hold.',
    'knee-forward-mild': 'Your knees are starting to travel past your toes.',
    'knee-forward': 'Walk your feet out further from the wall — your knees have traveled past your toes.',
  },
  'jump-squat': {
    shallow: 'Break parallel on every rep. A deeper rep with control beats a shallow fast one.',
    'chest-up-mild': 'Start lifting your chest before you fold forward any further.',
    'chest-up': 'Keep your chest up as you load the jump — don\'t collapse forward.',
    'knee-forward-mild': 'Your knees are starting to travel well past your toes as you load.',
    'knee-forward': 'Your knees are traveling too far past your toes — push your hips back more.',
  },
  'superman-hold': {
    flat: 'Lift your arms and legs higher off the floor — squeeze your glutes and lower back to hold the extension.',
    'overextending-mild': 'You\'re starting to overextend — this only needs a small, controlled lift.',
    overextending: 'Ease off the height — that\'s more extension than this needs, and it risks pinching your lower back.',
    'uneven-lift': 'Lift evenly on both sides — one is rising higher than the other.',
    neck: 'Keep your neck neutral — don\'t crane your head up to look forward.',
    'arms-not-reaching': 'Reach your arms out long instead of bending them.',
    'legs-bent': 'Keep your legs straight and long instead of bending your knees.',
  },
  'leg-raise': {
    shallow: 'Lift your legs higher before lowering — a fuller top range works your lower abs harder.',
    'no-lockout': 'Lower all the way, just short of the floor, instead of stopping short.',
    'legs-bent': 'Keep your legs straighter if you can do it without your back arching.',
    'uneven-legs': 'Raise both legs together — one is higher than the other.',
  },
  'jumping-jack': {
    'arms-not-overhead': 'Get your arms all the way overhead, not just to shoulder height.',
    'feet-too-wide': 'Land a little narrower — roughly shoulder-width is plenty.',
  },
  'mountain-climbers': {
    'hips-high-mild': 'Keep your hips level with your shoulders — they\'re starting to creep up.',
    'hips-high': 'Keep your hips in line with your shoulders — piking them up turns this into a bad plank, not a mountain climber.',
    'hips-sag': 'Brace your core — your hips are dropping toward the floor.',
    'body-line': 'Keep one straight line from your shoulders to your heels the whole time.',
    'hands-mild': 'Slide your hands back under your shoulders for a steadier base.',
    'hands-not-stacked': 'Plant your hands directly under your shoulders — they\'ve drifted well off.',
    'bent-arms': 'Lock your supporting arms straight — don\'t let your elbows bend under you.',
    'shallow-drive': 'Drive your knee further in toward your chest, not just a tap on the way through.',
    shrug: 'Push your shoulders down away from your ears instead of shrugging.',
    'neutral-neck': 'Keep your neck in line with your spine — don\'t crane your head up.',
  },
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

  const exAdvice = ex ? CUE_ADVICE[ex.slug] : undefined;
  for (const c of summary.cues.slice(0, 2)) {
    advice.push(exAdvice?.[c.ruleId] ?? `Focus on: ${c.cue.toLowerCase()}.`);
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
