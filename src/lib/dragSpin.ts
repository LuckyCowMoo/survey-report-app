/** Shared corner-grab spin physics (home floating reports + review lift ghost). */

export const ANGULAR_GAIN = 0.85;
/** Max degrees of spin applied from a single pointer/scroll sample. */
export const ANGULAR_CLAMP = 12;

/** Weak spring toward upright while a lift-ghost is held still. */
export const UPRIGHT_SPRING = 0.00025;
export const UPRIGHT_DAMPING = 0.96;

export function degToRad(d: number) {
  return (d * Math.PI) / 180;
}

export function rotate(x: number, y: number, deg: number) {
  const r = degToRad(deg);
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: x * c - y * s, y: x * s + y * c };
}

export function unrotate(x: number, y: number, deg: number) {
  return rotate(x, y, -deg);
}

/**
 * Tangential motion at the grab lever → degrees of rotation.
 * `grabLocal*` is in the same space as `pv*` (usually visual / screen px).
 */
export function spinFromDelta(
  grabLocalX: number,
  grabLocalY: number,
  rotDeg: number,
  pvx: number,
  pvy: number
): number {
  const lever = rotate(grabLocalX, grabLocalY, rotDeg);
  const leverLen2 = lever.x * lever.x + lever.y * lever.y;
  if (leverLen2 <= 36) return 0;
  const torque = lever.x * pvy - lever.y * pvx;
  const dRot = (torque / leverLen2) * ANGULAR_GAIN * (180 / Math.PI);
  return Math.max(-ANGULAR_CLAMP, Math.min(ANGULAR_CLAMP, dRot));
}

/** Soft righting toward `targetRot` (degrees). `dt` is frames @ 60Hz. */
export function stepUpright(
  rot: number,
  vr: number,
  dt: number,
  targetRot = 0
): { rot: number; vr: number } {
  const err = rot - targetRot;
  let nextVr = vr - err * UPRIGHT_SPRING * dt;
  nextVr *= Math.pow(UPRIGHT_DAMPING, dt);
  let nextRot = rot + nextVr * dt;
  if (Math.abs(err) < 0.04 && Math.abs(nextVr) < 0.04) {
    return { rot: targetRot, vr: 0 };
  }
  return { rot: nextRot, vr: nextVr };
}
