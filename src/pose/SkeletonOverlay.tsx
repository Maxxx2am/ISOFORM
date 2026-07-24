import Svg, { Circle, Line, Path } from 'react-native-svg';

import { KEY_JOINTS, L, POSE_CONNECTIONS, type Landmark } from '@/pose/types';
import { Accents } from '@/theme/palette';

export type BodyHighlight = 'torso' | 'arm' | 'leg' | null;

type SkeletonOverlayProps = {
  landmarks: Landmark[] | null;
  width: number;
  height: number;
  /** Mirror horizontally (natural for front-camera self-view). */
  mirror?: boolean;
  accentColor?: string;
  /** Color for a highlighted body part when form is wrong. */
  failColor?: string;
  /** Which body part to highlight (currently violated form rule). */
  highlight?: BodyHighlight;
  minVisibility?: number;
  /** Draw only arms + torso + head (skip the legs — they glitch on push-ups). */
  hideLegs?: boolean;
  /** Side view: draw a single clean line down the more-visible side (no box,
   *  no guessing at the hidden far side — e.g. a handstand from the side). */
  sideView?: boolean;
  /** Draw a horizontal line at the bar (wrist height) — for pull-ups. */
  showBar?: boolean;
};

// Torso sides are drawn as CURVES (see below), not straight lines.
const TORSO = new Set([`${L.LeftShoulder}-${L.LeftHip}`, `${L.RightShoulder}-${L.RightHip}`]);

/** Map a pose connection key to its body part for skeleton highlighting. */
function connectionPart(a: L, b: L): BodyHighlight {
  if (
    (a === L.LeftShoulder && b === L.RightShoulder) ||
    (a === L.LeftHip && b === L.RightHip) ||
    TORSO.has(`${a}-${b}`)
  ) return 'torso';
  if (
    (a === L.LeftShoulder || a === L.RightShoulder || a === L.LeftElbow || a === L.RightElbow) &&
    (b === L.LeftElbow || b === L.RightElbow || b === L.LeftWrist || b === L.RightWrist)
  ) return 'arm';
  if (
    (a === L.LeftHip || a === L.RightHip || a === L.LeftKnee || a === L.RightKnee || a === L.LeftAnkle || a === L.RightAnkle) &&
    (b === L.LeftKnee || b === L.RightKnee || b === L.LeftAnkle || b === L.RightAnkle || b === L.LeftFootIndex || b === L.RightFootIndex)
  ) return 'leg';
  return null;
}

const LEG = new Set<number>([
  L.LeftKnee, L.RightKnee, L.LeftAnkle, L.RightAnkle,
  L.LeftHeel, L.RightHeel, L.LeftFootIndex, L.RightFootIndex,
]);

type Side = { shoulder: L; elbow: L; wrist: L; hip: L; knee: L; ankle: L; foot: L };
const SIDE: { left: Side; right: Side } = {
  left: { shoulder: L.LeftShoulder, elbow: L.LeftElbow, wrist: L.LeftWrist, hip: L.LeftHip, knee: L.LeftKnee, ankle: L.LeftAnkle, foot: L.LeftFootIndex },
  right: { shoulder: L.RightShoulder, elbow: L.RightElbow, wrist: L.RightWrist, hip: L.RightHip, knee: L.RightKnee, ankle: L.RightAnkle, foot: L.RightFootIndex },
};

/**
 * Draws the skeleton from normalized landmarks. Two modes:
 * - default: both sides, torso as a bendable spine (arch is visible), optional
 *   hideLegs for front push-ups.
 * - sideView: a single clean line down whichever side the camera sees best —
 *   one arm, one leg, one curved spine. Nothing is drawn for landmarks that
 *   aren't visible, so it never guesses/flickers the hidden far side.
 */
export function SkeletonOverlay({
  landmarks,
  width,
  height,
  mirror = false,
  accentColor = Accents.mono.color,
  failColor = Accents.mono.color,
  highlight = null,
  minVisibility = 0.4,
  hideLegs = false,
  sideView = false,
  showBar = false,
}: SkeletonOverlayProps) {
  if (!landmarks || landmarks.length === 0) return null;

  const px = (lm: Landmark) => (mirror ? (1 - lm.x) * width : lm.x * width);
  const py = (lm: Landmark) => lm.y * height;
  const vis = (i: number) => (landmarks[i]?.visibility ?? 0) >= minVisibility;

  // Pull-up bar: horizontal line at the higher visible wrist.
  let barY: number | null = null;
  if (showBar) {
    const ys: number[] = [];
    if (vis(L.LeftWrist)) ys.push(py(landmarks[L.LeftWrist]));
    if (vis(L.RightWrist)) ys.push(py(landmarks[L.RightWrist]));
    if (ys.length) barY = Math.min(...ys);
  }

  if (sideView) {
    return (
      <SideSkeleton
        landmarks={landmarks}
        width={width}
        height={height}
        px={px}
        py={py}
        vis={vis}
        accentColor={accentColor}
        failColor={failColor}
        highlight={highlight}
      />
    );
  }

  const spineBow = computeSpineBow(landmarks, px, py, minVisibility);

  return (
    <Svg width={width} height={height} pointerEvents="none">
      {barY != null ? (
        <Line x1={0} y1={barY} x2={width} y2={barY} stroke="rgba(255,255,255,0.55)" strokeWidth={3} />
      ) : null}
      {POSE_CONNECTIONS.map(([a, b], i) => {
        if (TORSO.has(`${a}-${b}`)) return null;
        if (hideLegs && (LEG.has(a) || LEG.has(b))) return null;
        const la = landmarks[a];
        const lb = landmarks[b];
        if (!la || !lb) return null;
        if (la.visibility < minVisibility || lb.visibility < minVisibility) return null;
        const part = connectionPart(a, b);
        const lineColor = highlight && part === highlight ? failColor : accentColor;
        return (
          <Line key={`c${i}`} x1={px(la)} y1={py(la)} x2={px(lb)} y2={py(lb)} stroke={lineColor} strokeWidth={4} strokeLinecap="round" />
        );
      })}

      {([[L.LeftShoulder, L.LeftHip], [L.RightShoulder, L.RightHip]] as const).map(([s, h], i) => {
        if (!vis(s) || !vis(h)) return null;
        const sx = px(landmarks[s]);
        const sy = py(landmarks[s]);
        const hx = px(landmarks[h]);
        const hy = py(landmarks[h]);
        const cx = (sx + hx) / 2 + spineBow.dx;
        const cy = (sy + hy) / 2 + spineBow.dy;
        const spineColor = highlight === 'torso' ? failColor : accentColor;
        return <Path key={`spine${i}`} d={`M ${sx} ${sy} Q ${cx} ${cy} ${hx} ${hy}`} stroke={spineColor} strokeWidth={4} strokeLinecap="round" fill="none" />;
      })}

      {KEY_JOINTS.map((j) => {
        if (hideLegs && LEG.has(j)) return null;
        const lm = landmarks[j];
        if (!lm || lm.visibility < minVisibility) return null;
        return <Circle key={`j${j}`} cx={px(lm)} cy={py(lm)} r={6} fill="#FFFFFF" />;
      })}
    </Svg>
  );
}

/** One clean line down the more-visible side. */
function SideSkeleton({
  landmarks,
  width,
  height,
  px,
  py,
  vis,
  accentColor,
  failColor = '#FF453A',
  highlight = null,
}: {
  landmarks: Landmark[];
  width: number;
  height: number;
  px: (lm: Landmark) => number;
  py: (lm: Landmark) => number;
  vis: (i: number) => boolean;
  accentColor: string;
  failColor?: string;
  highlight?: BodyHighlight;
}) {
  const score = (s: Side) =>
    [s.shoulder, s.elbow, s.wrist, s.hip, s.knee, s.ankle].reduce((sum, i) => sum + (landmarks[i]?.visibility ?? 0), 0);
  const side = score(SIDE.left) >= score(SIDE.right) ? SIDE.left : SIDE.right;

  const color = (part: BodyHighlight) => (highlight === part ? failColor : accentColor);

  const seg = (a: number, b: number, key: string, part?: BodyHighlight) => {
    if (!vis(a) || !vis(b)) return null;
    return <Line key={key} x1={px(landmarks[a])} y1={py(landmarks[a])} x2={px(landmarks[b])} y2={py(landmarks[b])} stroke={color(part ?? null)} strokeWidth={4} strokeLinecap="round" />;
  };

  // Bendable spine shoulder→hip, bowing by this side's shoulder–hip–knee angle.
  let spine = null;
  if (vis(side.shoulder) && vis(side.hip)) {
    const sx = px(landmarks[side.shoulder]);
    const sy = py(landmarks[side.shoulder]);
    const hx = px(landmarks[side.hip]);
    const hy = py(landmarks[side.hip]);
    const bow = vis(side.knee)
      ? bowFrom(sx, sy, hx, hy, px(landmarks[side.knee]), py(landmarks[side.knee]))
      : { dx: 0, dy: 0 };
    spine = (
      <Path
        key="spine"
        d={`M ${sx} ${sy} Q ${(sx + hx) / 2 + bow.dx} ${(sy + hy) / 2 + bow.dy} ${hx} ${hy}`}
        stroke={color('torso')}
        strokeWidth={4}
        strokeLinecap="round"
        fill="none"
      />
    );
  }

  const joints = [L.Nose, side.shoulder, side.elbow, side.wrist, side.hip, side.knee, side.ankle];

  return (
    <Svg width={width} height={height} pointerEvents="none">
      {seg(L.Nose, side.shoulder, 's-neck', 'torso')}
      {seg(side.shoulder, side.elbow, 's-uarm', 'arm')}
      {seg(side.elbow, side.wrist, 's-farm', 'arm')}
      {seg(side.hip, side.knee, 's-thigh', 'leg')}
      {seg(side.knee, side.ankle, 's-shin', 'leg')}
      {seg(side.ankle, side.foot, 's-foot')}
      {spine}
      {joints.map((j) =>
        vis(j) ? <Circle key={`sj${j}`} cx={px(landmarks[j])} cy={py(landmarks[j])} r={6} fill="#FFFFFF" /> : null,
      )}
    </Svg>
  );
}

/** Bow (px) + belly direction for a single shoulder→hip segment given the knee. */
function bowFrom(sx: number, sy: number, hx: number, hy: number, kx: number, ky: number): { dx: number; dy: number } {
  const v1x = sx - hx, v1y = sy - hy;
  const v2x = kx - hx, v2y = ky - hy;
  const m1 = Math.hypot(v1x, v1y), m2 = Math.hypot(v2x, v2y);
  if (m1 === 0 || m2 === 0) return { dx: 0, dy: 0 };
  const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (m1 * m2)));
  const angle = (Math.acos(cos) * 180) / Math.PI;
  const bend = Math.max(0, 178 - angle);
  if (bend < 4) return { dx: 0, dy: 0 };
  const mag = Math.min(0.34 * m1, bend * (m1 / 220));
  let nx = -v1y / m1, ny = v1x / m1;
  if (nx * v2x + ny * v2y > 0) {
    nx = -nx;
    ny = -ny;
  }
  return { dx: nx * mag, dy: ny * mag };
}

function computeSpineBow(lms: Landmark[], px: (lm: Landmark) => number, py: (lm: Landmark) => number, minVis: number): { dx: number; dy: number } {
  const pick = (l: L, r: L): Landmark | null => {
    const a = lms[l];
    const b = lms[r];
    const av = a?.visibility ?? 0;
    const bv = b?.visibility ?? 0;
    if (av >= minVis && bv >= minVis) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: 0, visibility: 1 };
    if (av >= minVis) return a;
    if (bv >= minVis) return b;
    return null;
  };
  const sh = pick(L.LeftShoulder, L.RightShoulder);
  const hip = pick(L.LeftHip, L.RightHip);
  const knee = pick(L.LeftKnee, L.RightKnee);
  if (!sh || !hip || !knee) return { dx: 0, dy: 0 };
  return bowFrom(px(sh), py(sh), px(hip), py(hip), px(knee), py(knee));
}
