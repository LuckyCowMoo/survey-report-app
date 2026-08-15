/** Device compass heading in degrees clockwise from magnetic north [0, 360). */

export function headingFromOrientationEvent(
  e: DeviceOrientationEvent
): number | null {
  const webkit = (e as DeviceOrientationEvent & { webkitCompassHeading?: number })
    .webkitCompassHeading;
  if (typeof webkit === "number" && Number.isFinite(webkit)) {
    return ((webkit % 360) + 360) % 360;
  }
  if (typeof e.alpha === "number" && Number.isFinite(e.alpha)) {
    return ((360 - e.alpha) % 360 + 360) % 360;
  }
  return null;
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
  const onOrient = (e: DeviceOrientationEvent) => {
    onHeading(headingFromOrientationEvent(e));
  };
  window.addEventListener("deviceorientationabsolute", onOrient, true);
  window.addEventListener("deviceorientation", onOrient, true);
  return () => {
    window.removeEventListener("deviceorientationabsolute", onOrient, true);
    window.removeEventListener("deviceorientation", onOrient, true);
  };
}

export function nearestCompassIndex(headingDeg: number): number {
  return ((Math.round(headingDeg / 45) % 8) + 8) % 8;
}
