/** Camera-style look-around: gyro yaw + gravity pitch. No compass. */

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
/** Flip left/right so turning the phone right shows the right of the scene. */
const YAW_SIGN = -1;

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
 * DeviceMotion axes → screen axes. Portrait (angle 0) is unchanged.
 * Do not add an extra 90° — that is what kept the look a right-angle off.
 */
function deviceToScreen(x: number, y: number, z: number) {
  const a = ((screenAngleDeg() % 360) + 360) % 360;
  if (a === 90) return { x: y, y: -x, z };
  if (a === 180) return { x: -x, y: -y, z };
  if (a === 270) return { x: -y, y: x, z };
  return { x, y, z };
}

/**
 * Rear-camera look: −90° around X (flat device → looking through the back),
 * then undo the screen’s rotation. No extra Z offset.
 */
export function cameraLook(alpha: number, beta: number, gamma: number): Look {
  let q = quatEulerYXZ(beta * DEG, alpha * DEG, -gamma * DEG);
  q = quatMul(q, quatAxisAngle(1, 0, 0, -Math.PI / 2));
  q = quatMul(q, quatAxisAngle(0, 0, 1, -screenAngleDeg() * DEG));
  const d = quatRotate(q, 0, 0, -1);
  return {
    yaw: YAW_SIGN * Math.atan2(d.x, -d.z),
    pitch: Math.asin(Math.max(-1, Math.min(1, d.y)))
  };
}

/**
 * RelativeOrientationSensor is already a camera-style attitude.
 * Do not apply the DeviceOrientation −90° X (that aims out the top of the phone).
 */
export function lookFromQuaternion(
  x: number,
  y: number,
  z: number,
  w: number
): Look {
  const d = quatRotate({ x, y, z, w }, 0, 0, -1);
  return {
    yaw: YAW_SIGN * Math.atan2(d.x, -d.z),
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
  gravPitch0: number | null;
  lastGyroT: number;
  usedMotion: boolean;
  usedRelative: boolean;
};

export function createLookTracker(): LookTracker {
  return {
    calib: null,
    filtered: null,
    gravPitch0: null,
    lastGyroT: 0,
    usedMotion: false,
    usedRelative: false
  };
}

export function resetLookTracker(t: LookTracker) {
  t.calib = null;
  t.filtered = null;
  t.gravPitch0 = null;
  t.lastGyroT = 0;
}

function ensureFiltered(t: LookTracker): Look {
  if (!t.filtered) t.filtered = { yaw: 0, pitch: 0 };
  return t.filtered;
}

function gravityPitch(_ax: number, ay: number, az: number) {
  return Math.atan2(az, ay);
}

/**
 * IMU sample: gyro for yaw (locked, like a camera), gravity for pitch (horizon).
 * rotationRate is deg/s on device X/Y/Z = beta/gamma/alpha.
 */
export function trackerPushMotion(
  t: LookTracker,
  rate: { alpha: number | null; beta: number | null; gamma: number | null },
  accel: { x: number | null; y: number | null; z: number | null } | null,
  now: number
): Look {
  if (t.usedRelative) return ensureFiltered(t);
  t.usedMotion = true;
  const look = ensureFiltered(t);
  const prev = t.lastGyroT;
  t.lastGyroT = now;
  const dt = prev ? Math.min(0.05, Math.max(0, (now - prev) / 1000)) : 0;

  if (
    dt > 0 &&
    rate.alpha != null &&
    rate.beta != null &&
    rate.gamma != null
  ) {
    const w0 = deviceToScreen(
      rate.beta * DEG,
      rate.gamma * DEG,
      rate.alpha * DEG
    );
    const wx = w0.x;
    const wy = w0.y;
    const wz = w0.z;
    let ux = 0;
    let uy = 1;
    let uz = 0;
    if (accel && accel.x != null && accel.y != null && accel.z != null) {
      const g = deviceToScreen(accel.x, accel.y, accel.z);
      const mag = Math.hypot(g.x, g.y, g.z);
      if (mag > 4) {
        ux = g.x / mag;
        uy = g.y / mag;
        uz = g.z / mag;
      }
    }
    const yawRate = YAW_SIGN * (wx * ux + wy * uy + wz * uz);
    look.yaw = wrapPi(look.yaw + yawRate * dt);
    look.pitch += wx * dt;
  }

  if (accel && accel.x != null && accel.y != null && accel.z != null) {
    const g = deviceToScreen(accel.x, accel.y, accel.z);
    const mag = Math.hypot(g.x, g.y, g.z);
    if (mag > 4) {
      const gp = gravityPitch(g.x, g.y, g.z);
      if (t.gravPitch0 == null) t.gravPitch0 = gp;
      const target = gp - t.gravPitch0;
      // Tight horizon lock (~45ms), not the old compass ease.
      const k = dt > 0 ? 1 - Math.exp(-dt / 0.045) : 0.2;
      look.pitch += (target - look.pitch) * k;
    }
  }

  look.pitch = Math.max(-1.2, Math.min(1.2, look.pitch));
  return look;
}

/** Chrome RelativeOrientationSensor (game-rotation vector, no compass). */
export function trackerPushQuaternion(
  t: LookTracker,
  x: number,
  y: number,
  z: number,
  w: number
): Look {
  t.usedRelative = true;
  const abs = lookFromQuaternion(x, y, z, w);
  if (!t.calib) t.calib = { ...abs };
  const next = {
    yaw: wrapPi(abs.yaw - t.calib.yaw),
    pitch: abs.pitch - t.calib.pitch
  };
  t.filtered = next;
  return next;
}

/** Last resort when no gyro/motion (rare). */
export function trackerPushOrientation(
  t: LookTracker,
  pose: DevicePose
): Look | null {
  if (t.usedMotion || t.usedRelative) return t.filtered;
  const abs = cameraLook(pose.alpha, pose.beta, pose.gamma);
  if (!t.calib) t.calib = { ...abs };
  const target = {
    yaw: wrapPi(abs.yaw - t.calib.yaw),
    pitch: abs.pitch - t.calib.pitch
  };
  const look = ensureFiltered(t);
  look.yaw = wrapPi(look.yaw + wrapPi(target.yaw - look.yaw) * 0.55);
  look.pitch += (target.pitch - look.pitch) * 0.55;
  return look;
}

type RelativeSensor = {
  quaternion?: number[] | null;
  start: () => void;
  stop: () => void;
  addEventListener: (type: string, fn: () => void) => void;
  removeEventListener: (type: string, fn: () => void) => void;
};

export function startRelativeOrientation(
  t: LookTracker,
  onReading: (look: Look) => void
): () => void {
  const Ctor = (
    window as unknown as {
      RelativeOrientationSensor?: new (opts: {
        frequency: number;
        referenceFrame: string;
      }) => RelativeSensor;
    }
  ).RelativeOrientationSensor;
  if (!Ctor) return () => {};
  let sensor: RelativeSensor;
  try {
    sensor = new Ctor({ frequency: 60, referenceFrame: "screen" });
  } catch {
    return () => {};
  }
  const onRead = () => {
    const q = sensor.quaternion;
    if (!q || q.length < 4) return;
    onReading(trackerPushQuaternion(t, q[0]!, q[1]!, q[2]!, q[3]!));
  };
  try {
    sensor.addEventListener("reading", onRead);
    sensor.start();
  } catch {
    return () => {};
  }
  return () => {
    try {
      sensor.removeEventListener("reading", onRead);
      sensor.stop();
    } catch {
      /* ignore */
    }
  };
}
