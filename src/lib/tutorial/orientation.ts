/** Camera-style look-around: gyroscope only. No gravity, no compass, no horizon. */

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

export type Look = { yaw: number; pitch: number; roll?: number };

export type CamQuat = { x: number; y: number; z: number; w: number };

export function quatIdentity(): CamQuat {
  return { x: 0, y: 0, z: 0, w: 1 };
}

export function quatConj(q: CamQuat): CamQuat {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

export function quatNorm(q: CamQuat): CamQuat {
  const n = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
}

export function quatFromLook(yaw: number, pitch: number, roll = 0): CamQuat {
  return quatNorm(
    quatMul(
      quatMul(quatAxisAngle(0, 1, 0, yaw), quatAxisAngle(1, 0, 0, pitch)),
      quatAxisAngle(0, 0, 1, roll)
    )
  );
}

export function lookFromCamQuat(q: CamQuat): Look {
  const d = quatRotate(q, 0, 0, -1);
  const u = quatRotate(q, 0, 1, 0);
  const yaw = Math.atan2(d.x, -d.z);
  const pitch = Math.asin(Math.max(-1, Math.min(1, d.y)));
  const cy = Math.cos(-yaw);
  const sy = Math.sin(-yaw);
  const ux = u.x * cy + u.z * sy;
  const uy = u.y;
  const uz = -u.x * sy + u.z * cy;
  const cp = Math.cos(-pitch);
  const sp = Math.sin(-pitch);
  const roll = Math.atan2(ux, uy * cp - uz * sp);
  return { yaw, pitch, roll };
}

const DEG = Math.PI / 180;

export function quatMul(a: CamQuat, b: CamQuat): CamQuat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z
  };
}

function quatAxisAngle(x: number, y: number, z: number, angle: number): CamQuat {
  const h = angle * 0.5;
  const s = Math.sin(h);
  return { x: x * s, y: y * s, z: z * s, w: Math.cos(h) };
}

function quatEulerYXZ(x: number, y: number, z: number): CamQuat {
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

function quatRotate(q: CamQuat, vx: number, vy: number, vz: number) {
  const qv: CamQuat = { x: vx, y: vy, z: vz, w: 0 };
  const qi: CamQuat = { x: -q.x, y: -q.y, z: -q.z, w: q.w };
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
 * Map a sensor quaternion into the same yaw/pitch the viewfinder used
 * before free-look (including YAW_SIGN), plus roll so you can go inverted.
 */
export function lookFromQuaternion(
  x: number,
  y: number,
  z: number,
  w: number
): Look {
  const q = { x, y, z, w };
  const f = quatRotate(q, 0, 0, -1);
  const u = quatRotate(q, 0, 1, 0);
  const yaw0 = Math.atan2(f.x, -f.z);
  const pitch = Math.asin(Math.max(-1, Math.min(1, f.y)));
  const cy = Math.cos(-yaw0);
  const sy = Math.sin(-yaw0);
  const ux = u.x * cy + u.z * sy;
  const uy = u.y;
  const uz = -u.x * sy + u.z * cy;
  const cp = Math.cos(-pitch);
  const sp = Math.sin(-pitch);
  const upx = ux;
  const upy = uy * cp - uz * sp;
  const roll = Math.atan2(upx, upy);
  return { yaw: yaw0, pitch, roll };
}

export function cameraLook(alpha: number, beta: number, gamma: number): Look {
  const q = cameraQuat(alpha, beta, gamma);
  return lookFromQuaternion(q.x, q.y, q.z, q.w);
}

export function readPose(ev: DeviceOrientationEvent): DevicePose | null {
  if (ev.alpha == null || ev.beta == null || ev.gamma == null) return null;
  return { alpha: ev.alpha, beta: ev.beta, gamma: ev.gamma };
}

export type LookTracker = {
  calib: Look | null;
  filtered: Look | null;
  filteredQ: CamQuat | null;
  lastGyroT: number;
  usedMotion: boolean;
  usedRelative: boolean;
};

export function createLookTracker(): LookTracker {
  return {
    calib: null,
    filtered: null,
    filteredQ: null,
    lastGyroT: 0,
    usedMotion: false,
    usedRelative: false
  };
}

export function resetLookTracker(t: LookTracker) {
  t.calib = null;
  t.filtered = null;
  t.filteredQ = null;
  t.lastGyroT = 0;
}

function ensureFiltered(t: LookTracker): Look {
  if (!t.filtered) t.filtered = { yaw: 0, pitch: 0, roll: 0 };
  if (!t.filteredQ) t.filteredQ = quatIdentity();
  return t.filtered;
}

function setFromLook(t: LookTracker, look: Look): Look {
  const roll = look.roll ?? 0;
  t.filtered = { yaw: look.yaw, pitch: look.pitch, roll };
  t.filteredQ = quatFromLook(look.yaw, look.pitch, roll);
  return t.filtered;
}

function quatIntegrate(q: CamQuat, wx: number, wy: number, wz: number, dt: number): CamQuat {
  const ang = Math.hypot(wx, wy, wz) * dt;
  if (ang < 1e-10) return q;
  const inv = dt / ang;
  return quatNorm(
    quatMul(q, quatAxisAngle(wx * inv, wy * inv, wz * inv, ang))
  );
}

/**
 * Gyro rates in the phone's own axes. Does not use gravity, so the
 * photosphere can go inverted and does not re-level to the floor.
 */
export function trackerPushMotion(
  t: LookTracker,
  rate: { alpha: number | null; beta: number | null; gamma: number | null },
  now: number
): Look {
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
    /* Nod→pitch, turn→yaw, roll→roll; yaw and roll signs flipped from the first solve. */
    t.filteredQ = quatIntegrate(
      t.filteredQ ?? quatIdentity(),
      w0.z,
      w0.x,
      w0.y,
      dt
    );
    const next = lookFromCamQuat(t.filteredQ);
    look.yaw = next.yaw;
    look.pitch = next.pitch;
    look.roll = next.roll ?? 0;
  }

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
  if (!t.calib) t.calib = { ...abs, roll: abs.roll ?? 0 };
  return setFromLook(t, {
    yaw: wrapPi(abs.yaw - t.calib.yaw),
    pitch: abs.pitch - t.calib.pitch,
    roll: wrapPi((abs.roll ?? 0) - (t.calib.roll ?? 0))
  });
}

function cameraQuat(alpha: number, beta: number, gamma: number): CamQuat {
  let q = quatEulerYXZ(beta * DEG, alpha * DEG, -gamma * DEG);
  q = quatMul(q, quatAxisAngle(1, 0, 0, -Math.PI / 2));
  q = quatMul(q, quatAxisAngle(0, 0, 1, -screenAngleDeg() * DEG));
  return q;
}

/** Last resort when no gyro/motion (rare). */
export function trackerPushOrientation(
  t: LookTracker,
  pose: DevicePose
): Look | null {
  if (t.usedMotion || t.usedRelative) return t.filtered;
  const abs = cameraLook(pose.alpha, pose.beta, pose.gamma);
  if (!t.calib) t.calib = { ...abs, roll: abs.roll ?? 0 };
  return setFromLook(t, {
    yaw: wrapPi(abs.yaw - t.calib.yaw),
    pitch: abs.pitch - t.calib.pitch,
    roll: wrapPi((abs.roll ?? 0) - (t.calib.roll ?? 0))
  });
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
