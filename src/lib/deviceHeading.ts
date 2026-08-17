/** Device compass heading in degrees clockwise from magnetic north [0, 360). */

function wrap360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function shortestDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

function lerpAngle(from: number, to: number, t: number): number {
  return wrap360(from + shortestDelta(from, to) * t);
}

/**
 * Heading of the top of the phone on the horizontal plane, from alpha/beta/gamma.
 * Needed when the device is upright or face-down — raw alpha is not a compass.
 */
function headingFromAxes(
  alpha: number,
  beta: number,
  gamma: number
): number {
  const toRad = Math.PI / 180;
  const x = beta * toRad;
  const y = gamma * toRad;
  const z = alpha * toRad;
  const cY = Math.cos(y);
  const cZ = Math.cos(z);
  const sX = Math.sin(x);
  const sY = Math.sin(y);
  const sZ = Math.sin(z);
  const vx = -cZ * sY - sZ * sX * cY;
  const vy = -sZ * sY + cZ * sX * cY;
  let heading = Math.atan2(vx, vy) * (180 / Math.PI);
  if (heading < 0) heading += 360;
  const angle =
    typeof screen !== "undefined" && screen.orientation?.angle != null
      ? screen.orientation.angle
      : 0;
  return wrap360(heading + angle);
}

export function headingFromOrientationEvent(
  e: DeviceOrientationEvent
): number | null {
  const webkit = (e as DeviceOrientationEvent & { webkitCompassHeading?: number })
    .webkitCompassHeading;
  if (typeof webkit === "number" && Number.isFinite(webkit)) {
    return wrap360(webkit);
  }
  if (typeof e.alpha !== "number" || !Number.isFinite(e.alpha)) return null;
  if (
    typeof e.beta === "number" &&
    Number.isFinite(e.beta) &&
    typeof e.gamma === "number" &&
    Number.isFinite(e.gamma)
  ) {
    return headingFromAxes(e.alpha, e.beta, e.gamma);
  }
  return wrap360(360 - e.alpha);
}

export async function requestHeadingPermission(): Promise<boolean> {
  const DOE = DeviceOrientationEvent as unknown as {
    requestPermission?: () => Promise<PermissionState | string>;
  };
  if (typeof DOE.requestPermission === "function") {
    try {
      const result = await DOE.requestPermission();
      return result === "granted";
    } catch {
      return false;
    }
  }
  return true;
}

export function subscribeDeviceHeading(
  onHeading: (deg: number | null) => void
): () => void {
  let smoothed: number | null = null;
  let heardAbsolute = false;
  const SMOOTH = 0.16;

  const apply = (raw: number) => {
    smoothed = smoothed == null ? raw : lerpAngle(smoothed, raw, SMOOTH);
    onHeading(smoothed);
  };

  const onAbsolute = (e: DeviceOrientationEvent) => {
    heardAbsolute = true;
    const heading = headingFromOrientationEvent(e);
    if (heading != null) apply(heading);
  };

  const onRelative = (e: DeviceOrientationEvent) => {
    // Absolute and relative events fight on Android and cause cardinal flicker.
    if (heardAbsolute) return;
    const heading = headingFromOrientationEvent(e);
    if (heading != null) apply(heading);
  };

  window.addEventListener("deviceorientationabsolute", onAbsolute, true);
  window.addEventListener("deviceorientation", onRelative, true);
  return () => {
    window.removeEventListener("deviceorientationabsolute", onAbsolute, true);
    window.removeEventListener("deviceorientation", onRelative, true);
  };
}

/** Snap to 8-wind rose, with hysteresis so noise cannot flicker at a boundary. */
export function nearestCompassIndex(
  headingDeg: number,
  current?: number | null
): number {
  const raw = ((Math.round(headingDeg / 45) % 8) + 8) % 8;
  if (current == null || current === raw) return raw;
  const center = current * 45;
  const offset = Math.abs(shortestDelta(center, headingDeg));
  // Stay on the current petal until ~12° past the 22.5° sector edge.
  if (offset <= 34) return current;
  return raw;
}
