/** Device look-around: camera-style yaw/pitch from orientation + gyro. */

type PermissionedSensor = {
  requestPermission?: () => Promise<"granted" | "denied" | string>;
};

export function orientationNeedsPermission(): boolean {
  if (typeof window === "undefined") return false;
  const ctor = window.DeviceOrientationEvent as unknown as PermissionedSensor;
  return typeof ctor?.requestPermission === "function";
}

export async function requestOrientationPermission(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const orient = window.DeviceOrientationEvent as unknown as PermissionedSensor;
  let ok = true;
  if (typeof orient?.requestPermission === "function") {
    try {
      ok = (await orient.requestPermission()) === "granted";
    } catch {
      ok = false;
    }
  }
  const motion = window.DeviceMotionEvent as unknown as PermissionedSensor;
  if (typeof motion?.requestPermission === "function") {
    try {
      await motion.requestPermission();
    } catch {
      /* Android Chrome does not need this */
    }
  }
  return ok;
}

export type DevicePose = { alpha: number; beta: number; gamma: number };

export type Look = { yaw: number; pitch: number };

const DEG = Math.PI / 180;

type Quat = { x: number; y: number; z: number; w: number };

function quatMul(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z
  };
}

function quatAxisAngle(x: number, y: number, z: number, angle: number): Quat {
  const h = angle * 0.5;
  const s = Math.sin(h);
  return { x: x * s, y: y * s, z: z * s, w: Math.cos(h) };
}

/** Euler in YXZ order (radians). */
function quatEulerYXZ(x: number, y: number, z: number): Quat {
  const cx = Math.cos(x / 2);
  const sx = Math.sin(x / 2);
  const cy = Math.cos(y / 2);
  const sy = Math.sin(y / 2);
  const cz = Math.cos(z / 2);
  const sz = Math.sin(z / 2);
  return {
    x: sx * cy * cz + cx * sy * sz,
    y: cx * sy * cz - sx * cy * sz,
    z: cx * cy * sz - sx * sy * cz,
    w: cx * cy * cz + sx * sy * sz
  };
}

function quatRotate(q: Quat, vx: number, vy: number, vz: number) {
  const qv: Quat = { x: vx, y: vy, z: vz, w: 0 };
  const qi: Quat = { x: -q.x, y: -q.y, z: -q.z, w: q.w };
  const r = quatMul(quatMul(q, qv), qi);
  return { x: r.x, y: r.y, z: r.z };
}

export function wrapPi(a: number) {
  let x = a + Math.PI;
  x = x - Math.PI * 2 * Math.floor(x / (Math.PI * 2));
  return x - Math.PI;
}

export function screenAngleDeg(): number {
  const so = screen.orientation;
  if (so && typeof so.angle === "number") return so.angle;
  const wo = (window as Window & { orientation?: number }).orientation;
  return typeof wo === "number" ? wo : 0;
}

/**
 * Rear-camera look direction from deviceorientation (W3C / typical VR controls).
 * Yaw: around world up. Pitch: up/down. Turn the phone right → yaw decreases
 * so the panorama behaves like a real camera (world slides left).
 */
export function cameraLook(
  alpha: number,
  beta: number,
  gamma: number,
  screenDeg = screenAngleDeg()
): Look {
  let q = quatEulerYXZ(beta * DEG, alpha * DEG, -gamma * DEG);
  q = quatMul(q, quatAxisAngle(1, 0, 0, -Math.PI / 2));
  q = quatMul(q, quatAxisAngle(0, 0, 1, -screenDeg * DEG));
  const d = quatRotate(q, 0, 0, -1);
  return {
    yaw: Math.atan2(d.x, -d.z),
    pitch: Math.asin(Math.max(-1, Math.min(1, d.y)))
  };
}

export function readPose(ev: DeviceOrientationEvent): DevicePose | null {
  if (ev.alpha == null || ev.beta == null || ev.gamma == null) return null;
  return { alpha: ev.alpha, beta: ev.beta, gamma: ev.gamma };
}

export type LookTracker = {
  calib: Look | null;
  filtered: Look | null;
  absLook: Look | null;
  pose: DevicePose | null;
  lastGyroT: number;
};

export function createLookTracker(): LookTracker {
  return {
    calib: null,
    filtered: null,
    absLook: null,
    pose: null,
    lastGyroT: 0
  };
}

export function resetLookTracker(t: LookTracker) {
  t.calib = null;
  t.filtered = null;
  t.absLook = null;
  t.pose = null;
  t.lastGyroT = 0;
}

function relativeLook(t: LookTracker, abs: Look): Look {
  if (!t.calib) t.calib = { ...abs };
  return {
    yaw: wrapPi(abs.yaw - t.calib.yaw),
    pitch: abs.pitch - t.calib.pitch
  };
}

/** Absolute orientation sample. Compass yaw is pulled in gently to kill drift. */
export function trackerPushOrientation(
  t: LookTracker,
  pose: DevicePose
): Look {
  t.pose = pose;
  const abs = cameraLook(pose.alpha, pose.beta, pose.gamma);
  t.absLook = abs;
  const target = relativeLook(t, abs);
  if (!t.filtered) {
    t.filtered = { ...target };
    return t.filtered;
  }
  const hasGyro = t.lastGyroT !== 0;
  const kYaw = hasGyro ? 0.04 : 0.28;
  const kPitch = hasGyro ? 0.12 : 0.4;
  t.filtered.yaw = wrapPi(
    t.filtered.yaw + wrapPi(target.yaw - t.filtered.yaw) * kYaw
  );
  t.filtered.pitch += (target.pitch - t.filtered.pitch) * kPitch;
  return t.filtered;
}

/**
 * Integrate device gyro (deg/s). This is what makes side-to-side stable;
 * magnetometer alpha is too noisy when the phone is held upright.
 */
export function trackerPushGyro(
  t: LookTracker,
  rate: { alpha: number | null; beta: number | null; gamma: number | null },
  now: number
): Look | null {
  if (rate.alpha == null || rate.beta == null || rate.gamma == null) return t.filtered;
  if (!t.filtered) {
    t.filtered = { yaw: 0, pitch: 0 };
  }
  const prev = t.lastGyroT;
  t.lastGyroT = now;
  const dt = prev ? Math.min(0.08, Math.max(0, (now - prev) / 1000)) : 0;
  if (dt <= 0) return t.filtered;

  const beta = (t.pose?.beta ?? 90) * DEG;
  const sB = Math.sin(beta);
  const cB = Math.cos(beta);
  // Portrait, camera-forward: world yaw is mostly device-Y (gamma).
  const yawRate = (-rate.gamma * sB - rate.alpha * cB) * DEG;
  const pitchRate = rate.beta * DEG;
  t.filtered.yaw = wrapPi(t.filtered.yaw + yawRate * dt);
  t.filtered.pitch = Math.max(
    -1.2,
    Math.min(1.2, t.filtered.pitch + pitchRate * dt)
  );
  return t.filtered;
}
