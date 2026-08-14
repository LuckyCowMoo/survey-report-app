/** Device-orientation helpers for the tutorial viewfinder. */

type PermissionedOrientation = {
  requestPermission?: () => Promise<"granted" | "denied" | string>;
};

export function orientationNeedsPermission(): boolean {
  if (typeof window === "undefined") return false;
  const ctor = window.DeviceOrientationEvent as unknown as PermissionedOrientation;
  return typeof ctor?.requestPermission === "function";
}

export async function requestOrientationPermission(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const ctor = window.DeviceOrientationEvent as unknown as PermissionedOrientation;
  if (typeof ctor?.requestPermission !== "function") return true;
  try {
    const res = await ctor.requestPermission();
    return res === "granted";
  } catch {
    return false;
  }
}

export type DevicePose = { alpha: number; beta: number; gamma: number };

/** Portrait-phone look from a deviceorientation event, in radians. */
export function poseToLook(pose: DevicePose, calib: DevicePose | null): {
  yaw: number;
  pitch: number;
} {
  const alpha = pose.alpha;
  const beta = pose.beta;
  if (!calib) {
    return { yaw: 0, pitch: 0 };
  }
  const yaw = ((calib.alpha - alpha) * Math.PI) / 180;
  const pitch = ((beta - calib.beta) * Math.PI) / 180;
  return { yaw, pitch };
}

export function readPose(ev: DeviceOrientationEvent): DevicePose | null {
  if (ev.alpha == null || ev.beta == null || ev.gamma == null) return null;
  return { alpha: ev.alpha, beta: ev.beta, gamma: ev.gamma };
}
