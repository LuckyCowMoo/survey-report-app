import { useEffect } from "react";

type Glow = {
  x: number;
  y: number;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  /** 0–1 progress through the current hop (time domain, before easing). */
  t: number;
  /** Seconds for this hop at the reference average speed. */
  duration: number;
};

/** Average percent-units per second (ease-in-out still averages to this). */
const SPEED = 14;
const ARRIVE_EPS = 0.998;
const PAUSE_MIN_MS = 900;
const PAUSE_MAX_MS = 2200;
const MIN_DURATION = 0.45;

function randomAnchor(): { x: number; y: number } {
  return {
    x: 8 + Math.random() * 84,
    y: 6 + Math.random() * 88
  };
}

function pauseMs() {
  return PAUSE_MIN_MS + Math.random() * (PAUSE_MAX_MS - PAUSE_MIN_MS);
}

/** Smooth accelerate first half, decelerate second half. */
function easeInOut(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

function makeGlow(x: number, y: number, target: { x: number; y: number }): Glow {
  const dist = Math.hypot(target.x - x, target.y - y);
  return {
    x,
    y,
    sx: x,
    sy: y,
    tx: target.x,
    ty: target.y,
    t: 0,
    duration: Math.max(MIN_DURATION, dist / SPEED)
  };
}

function retarget(g: Glow, target: { x: number; y: number }) {
  const dist = Math.hypot(target.x - g.x, target.y - g.y);
  g.sx = g.x;
  g.sy = g.y;
  g.tx = target.x;
  g.ty = target.y;
  g.t = 0;
  g.duration = Math.max(MIN_DURATION, dist / SPEED);
}

/** Advance along the hop with ease-in-out; returns true when settled on target. */
function stepGlow(g: Glow, dt: number): boolean {
  if (g.t >= 1) {
    g.x = g.tx;
    g.y = g.ty;
    return true;
  }

  g.t = Math.min(1, g.t + dt / g.duration);
  const u = easeInOut(g.t);
  g.x = g.sx + (g.tx - g.sx) * u;
  g.y = g.sy + (g.ty - g.sy) * u;
  return g.t >= ARRIVE_EPS;
}

/** Soft studio background wash — ease-in-out drift within the viewport. */
export default function AmbientGlow() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    // Fixed viewport layer — % anchors stay on-screen while long pages scroll
    const wash = document.createElement("div");
    wash.className = "ambient-wash";
    wash.setAttribute("aria-hidden", "true");
    document.body.prepend(wash);

    const a = makeGlow(14, 8, randomAnchor());
    const b = makeGlow(90, 75, randomAnchor());

    let raf = 0;
    let last = performance.now();
    let pauseUntilA = Number.POSITIVE_INFINITY;
    let pauseUntilB = Number.POSITIVE_INFINITY;

    const apply = () => {
      wash.style.setProperty("--glow-x", `${a.x.toFixed(2)}%`);
      wash.style.setProperty("--glow-y", `${a.y.toFixed(2)}%`);
      wash.style.setProperty("--glow2-x", `${b.x.toFixed(2)}%`);
      wash.style.setProperty("--glow2-y", `${b.y.toFixed(2)}%`);
    };

    const tick = (now: number) => {
      const dt = Math.min(48, now - last) / 1000;
      last = now;

      const arrivedA = stepGlow(a, dt);
      const arrivedB = stepGlow(b, dt);

      if (arrivedA) {
        if (pauseUntilA === Number.POSITIVE_INFINITY) {
          pauseUntilA = now + pauseMs();
        } else if (now >= pauseUntilA) {
          retarget(a, randomAnchor());
          pauseUntilA = Number.POSITIVE_INFINITY;
        }
      } else {
        pauseUntilA = Number.POSITIVE_INFINITY;
      }

      if (arrivedB) {
        if (pauseUntilB === Number.POSITIVE_INFINITY) {
          pauseUntilB = now + pauseMs();
        } else if (now >= pauseUntilB) {
          retarget(b, randomAnchor());
          pauseUntilB = Number.POSITIVE_INFINITY;
        }
      } else {
        pauseUntilB = Number.POSITIVE_INFINITY;
      }

      apply();
      raf = requestAnimationFrame(tick);
    };

    apply();
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      wash.remove();
    };
  }, []);

  return null;
}
