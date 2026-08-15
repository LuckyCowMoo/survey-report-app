/** Camera-chapter beats for the Bayard valve-house tutorial. */

export type Look = { yaw: number; pitch: number };

function tutorialUrl(file: string) {
  const base = import.meta.env.BASE_URL || "/";
  const root = base.endsWith("/") ? base : `${base}/`;
  return `${root}tutorial/${file}`;
}

export const TUTORIAL_ASSETS = {
  frontPhoto: tutorialUrl("front.png"),
  gutterPhoto: tutorialUrl("gutter.png"),
  spawnPano: tutorialUrl("spawn.jpg"),
  gutterPano: tutorialUrl("gutter.jpg"),
  walkVideo: tutorialUrl("walk.mp4"),
  rhPhoto: tutorialUrl("rh.jpg"),
  baselinePhoto: tutorialUrl("baseline.jpg")
} as const;

export async function loadTutorialJpeg(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load tutorial image (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

export const TUTORIAL_LOOK = {
  /** Spawn facing the front elevation (centre of the spawn panorama). */
  spawn: { yaw: 0, pitch: 0.04 } satisfies Look,
  /** Framing that counts as “front elevation”. */
  front: { yaw: 0, pitch: 0.06 } satisfies Look,
  /**
   * Slew the 360 this far (radians) before the walk clip. Negative yaw is
   * looking right in the spawn panorama. Must match WALK_ALIGN_YAW in
   * scripts/blender/render_walk_from_blend.py
   */
  walkAlign: { yaw: -1.29, pitch: 0.04 } satisfies Look,
  /** Looking up at the vegetation in the gutter panorama. */
  gutter: { yaw: 0, pitch: 0.28 } satisfies Look
};

/** Max angular error (radians) to treat the shutter as lined up. */
export const TUTORIAL_AIM_SLOP = 0.32;

export const TUTORIAL_TIMING = {
  /** Pause on the spawn panorama before the app takes the look. */
  shot2HoldMs: 1600,
  slewMs: 1600,
  walkFadeMs: 420,
  /** Always hand off to the gutter pano if the clip never ends. */
  walkMaxMs: 11000,
  fallbackWalkMs: 5200
};

export function angleDelta(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function lookError(a: Look, b: Look): number {
  const dy = angleDelta(a.yaw, b.yaw);
  const dp = a.pitch - b.pitch;
  return Math.hypot(dy, dp);
}

export function looksAligned(look: Look, target: Look, slop = TUTORIAL_AIM_SLOP) {
  return lookError(look, target) <= slop;
}

export function tutorialHint(shotCount: number, phase: TutorialPhase): string {
  if (phase === "shot2-hold" || phase === "shot2-slew" || phase === "shot2-walk") {
    return "Stay still — following the path around the building";
  }
  if (shotCount <= 0) {
    return "Turn to frame the front elevation, then take the photo";
  }
  return "Frame the plants growing in the gutter, then take the photo";
}

export type TutorialPhase =
  | "loading"
  | "shot1"
  | "shot2-hold"
  | "shot2-slew"
  | "shot2-walk"
  | "shot2"
  | "free";
