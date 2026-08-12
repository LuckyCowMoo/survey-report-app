import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from "react";
import { degToRad, rotate, spinFromDelta, unrotate } from "../lib/dragSpin";

type CardState = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Degrees — absolute card orientation */
  rot: number;
  vr: number;
  dragging: boolean;
  baseRotate: number;
  phase: number;
};

type DragState = {
  index: number;
  pointerId: number;
  lastX: number;
  lastY: number;
  /** Grab point in card-local space (origin at center, unrotated) */
  grabLocalX: number;
  grabLocalY: number;
  /** Screen position of the CSS rest center while this drag is active */
  restCx: number;
  restCy: number;
};

type OBB = {
  cx: number;
  cy: number;
  hw: number;
  hh: number;
  rot: number;
};

const SPRING = 0.011 * 0.05;
const DAMPING = 0.945;
const ROT_SPRING = 0.009 * 0.05;
const ROT_DAMPING = 0.94;
const COLLISION_BOUNCE = 0.35;
/** How much sliding speed is killed on contact (0–1). */
const COLLISION_FRICTION = 0.62;
/** Inset so rounded corners don't "hit" before the visible edges meet. */
const CORNER_INSET = 7;
const FLOAT_AMP_Y = 7;
const FLOAT_AMP_X = 5;
const FLOAT_AMP_R = 1.8;

/** Matches `.home-actions` / Import max width — extra cards spawn when Import stops growing. */
const IMPORT_MAX_WIDTH = 560;
const MOBILE_COUNT = 2;
const DESKTOP_COUNT = 4;

const REPORT_CLASS = [
  "home-report-a",
  "home-report-b",
  "home-report-c",
  "home-report-d"
] as const;

const INITIAL: CardState[] = [
  {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    rot: 9,
    vr: 0,
    dragging: false,
    baseRotate: 9,
    phase: 0
  },
  {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    rot: -8,
    vr: 0,
    dragging: false,
    baseRotate: -8,
    phase: Math.PI
  },
  {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    rot: -14,
    vr: 0,
    dragging: false,
    baseRotate: -14,
    phase: Math.PI * 0.45
  },
  {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    rot: 6,
    vr: 0,
    dragging: false,
    baseRotate: 6,
    phase: Math.PI * 1.35
  }
];

/** True once the Import strip has reached its max width (no longer shrinking with the viewport). */
function useImportAtMaxWidth(homeRoot: HTMLElement | null) {
  const [atMax, setAtMax] = useState(false);

  useEffect(() => {
    if (!homeRoot) {
      setAtMax(false);
      return;
    }

    const actions = homeRoot.querySelector(".home-actions");
    if (!(actions instanceof HTMLElement)) {
      setAtMax(false);
      return;
    }

    const update = () => {
      setAtMax(actions.getBoundingClientRect().width >= IMPORT_MAX_WIDTH - 0.5);
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(actions);
    return () => ro.disconnect();
  }, [homeRoot]);

  return atMax;
}

function cardCenter(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
}

function obbCorners(box: OBB) {
  const locals = [
    { x: -box.hw, y: -box.hh },
    { x: box.hw, y: -box.hh },
    { x: box.hw, y: box.hh },
    { x: -box.hw, y: box.hh }
  ];
  return locals.map((p) => {
    const w = rotate(p.x, p.y, box.rot);
    return { x: box.cx + w.x, y: box.cy + w.y };
  });
}

function project(corners: { x: number; y: number }[], ax: number, ay: number) {
  let min = Infinity;
  let max = -Infinity;
  for (const p of corners) {
    const d = p.x * ax + p.y * ay;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return { min, max };
}

/**
 * Separating-axis test for two oriented boxes.
 * Returns a push on A (and opposite on B) along the minimum translation axis.
 */
function obbSeparate(
  a: OBB,
  b: OBB
): { ox: number; oy: number; nx: number; ny: number; depth: number } | null {
  const aCorners = obbCorners(a);
  const bCorners = obbCorners(b);

  const ar = degToRad(a.rot);
  const br = degToRad(b.rot);
  const axes = [
    { x: Math.cos(ar), y: Math.sin(ar) },
    { x: -Math.sin(ar), y: Math.cos(ar) },
    { x: Math.cos(br), y: Math.sin(br) },
    { x: -Math.sin(br), y: Math.cos(br) }
  ];

  let minDepth = Infinity;
  let bestNx = 0;
  let bestNy = 0;

  for (const axis of axes) {
    const ax = axis.x;
    const ay = axis.y;
    const pa = project(aCorners, ax, ay);
    const pb = project(bCorners, ax, ay);
    const depth = Math.min(pa.max, pb.max) - Math.max(pa.min, pb.min);
    if (depth <= 0) return null;

    if (depth < minDepth) {
      minDepth = depth;
      // Normal should point from B toward A
      const dx = a.cx - b.cx;
      const dy = a.cy - b.cy;
      if (dx * ax + dy * ay < 0) {
        bestNx = -ax;
        bestNy = -ay;
      } else {
        bestNx = ax;
        bestNy = ay;
      }
    }
  }

  return {
    ox: bestNx * minDepth,
    oy: bestNy * minDepth,
    nx: bestNx,
    ny: bestNy,
    depth: minDepth
  };
}

function applyContactVelocity(
  a: CardState,
  b: CardState,
  nx: number,
  ny: number
) {
  const relVx = a.vx - b.vx;
  const relVy = a.vy - b.vy;
  const vn = relVx * nx + relVy * ny;
  const vtX = relVx - vn * nx;
  const vtY = relVy - vn * ny;

  // Bounce only when closing along the normal
  const bouncedVn = vn < 0 ? -vn * COLLISION_BOUNCE : vn * 0.15;
  const slide = 1 - COLLISION_FRICTION;
  const outVx = bouncedVn * nx + vtX * slide;
  const outVy = bouncedVn * ny + vtY * slide;

  if (a.dragging && !b.dragging) {
    b.vx = a.vx - outVx;
    b.vy = a.vy - outVy;
    b.vr *= 1 - COLLISION_FRICTION * 0.45;
    b.vr += a.vr * 0.12;
  } else if (b.dragging && !a.dragging) {
    a.vx = b.vx + outVx;
    a.vy = b.vy + outVy;
    a.vr *= 1 - COLLISION_FRICTION * 0.45;
    a.vr += b.vr * 0.12;
  } else if (!a.dragging && !b.dragging) {
    const acx = (a.vx + b.vx) / 2;
    const acy = (a.vy + b.vy) / 2;
    a.vx = acx + outVx / 2;
    a.vy = acy + outVy / 2;
    b.vx = acx - outVx / 2;
    b.vy = acy - outVy / 2;
    a.vr *= 1 - COLLISION_FRICTION * 0.35;
    b.vr *= 1 - COLLISION_FRICTION * 0.35;
  }
}

/** Decorative floating report cards — draggable, spring home, soft collide. */
export default function FloatingReports() {
  const layerRef = useRef<HTMLDivElement>(null);
  const [homeEl, setHomeEl] = useState<HTMLElement | null>(null);
  const importAtMax = useImportAtMaxWidth(homeEl);
  const count = importAtMax ? DESKTOP_COUNT : MOBILE_COUNT;
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const stateRef = useRef<CardState[]>(
    INITIAL.slice(0, MOBILE_COUNT).map((c) => ({ ...c }))
  );
  const dragRef = useRef<DragState | null>(null);
  const reduceMotionRef = useRef(false);
  const countRef = useRef(count);
  countRef.current = count;

  useEffect(() => {
    const home = layerRef.current?.closest(".home");
    setHomeEl(home instanceof HTMLElement ? home : null);
  }, []);

  useEffect(() => {
    stateRef.current = INITIAL.slice(0, count).map((c) => ({ ...c }));
    dragRef.current = null;
  }, [count]);

  // Keep the fixed atmosphere aligned to the home frame so cards rest
  // near the UI, not the raw viewport edges.
  useEffect(() => {
    const layer = layerRef.current;
    const home = homeEl;
    if (!layer || !home) return;

    const sync = () => {
      const r = home.getBoundingClientRect();
      layer.style.top = `${r.top}px`;
      layer.style.left = `${r.left}px`;
      layer.style.width = `${r.width}px`;
      layer.style.height = `${r.height}px`;
    };

    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(home);
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, true);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
    };
  }, [homeEl, count]);

  useEffect(() => {
    reduceMotionRef.current = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const cards = stateRef.current;
    const els = () => cardRefs.current;
    let raf = 0;
    let last = performance.now();

    const poseOf = (i: number, time: number) => {
      const c = cards[i];
      let bobX = 0;
      let bobY = 0;
      let bobR = 0;
      if (!reduceMotionRef.current && !c.dragging) {
        const p = c.phase + (time / 1000) * (0.55 + i * 0.12);
        bobX = Math.sin(p) * FLOAT_AMP_X;
        bobY = Math.cos(p * 0.85) * FLOAT_AMP_Y;
        bobR = Math.sin(p * 0.7) * FLOAT_AMP_R;
      }
      return { bobX, bobY, bobR, rot: c.rot + bobR };
    };

    const applyTransforms = (time: number) => {
      const nodes = els();
      const n = countRef.current;
      for (let i = 0; i < n; i++) {
        const el = nodes[i];
        const c = cards[i];
        if (!el || !c) continue;
        const pose = poseOf(i, time);
        el.style.transform = `translate3d(${c.x + pose.bobX}px, ${c.y + pose.bobY}px, 0) rotate(${pose.rot}deg)`;
        el.classList.toggle("is-dragging", c.dragging);
      }
    };

    const makeObb = (el: HTMLElement, rot: number): OBB => {
      const center = cardCenter(el);
      return {
        cx: center.x,
        cy: center.y,
        hw: Math.max(8, el.offsetWidth / 2 - CORNER_INSET),
        hh: Math.max(8, el.offsetHeight / 2 - CORNER_INSET),
        rot
      };
    };

    const resolvePair = (i: number, j: number, time: number) => {
      const nodes = els();
      const aEl = nodes[i];
      const bEl = nodes[j];
      if (!aEl || !bEl) return;

      const aPose = poseOf(i, time);
      const bPose = poseOf(j, time);
      const sep = obbSeparate(makeObb(aEl, aPose.rot), makeObb(bEl, bPose.rot));
      if (!sep) return;

      const a = cards[i];
      const b = cards[j];
      const { ox, oy, nx, ny } = sep;

      if (a.dragging && !b.dragging) {
        b.x -= ox;
        b.y -= oy;
      } else if (b.dragging && !a.dragging) {
        a.x += ox;
        a.y += oy;
      } else if (!a.dragging && !b.dragging) {
        a.x += ox / 2;
        a.y += oy / 2;
        b.x -= ox / 2;
        b.y -= oy / 2;
      } else {
        return;
      }

      applyContactVelocity(a, b, nx, ny);
    };

    const resolveCollisions = (time: number) => {
      const n = countRef.current;
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          resolvePair(i, j, time);
        }
      }
    };

    const tick = (now: number) => {
      const dt = Math.min(32, now - last) / 16.67;
      last = now;
      const n = countRef.current;

      for (let i = 0; i < n; i++) {
        const c = cards[i];
        if (!c || c.dragging) continue;

        c.vx += -c.x * SPRING * dt;
        c.vy += -c.y * SPRING * dt;
        c.vx *= Math.pow(DAMPING, dt);
        c.vy *= Math.pow(DAMPING, dt);
        c.x += c.vx * dt;
        c.y += c.vy * dt;

        const rotErr = c.rot - c.baseRotate;
        c.vr += -rotErr * ROT_SPRING * dt;
        c.vr *= Math.pow(ROT_DAMPING, dt);
        c.rot += c.vr * dt;

        if (Math.abs(c.x) < 0.08 && Math.abs(c.vx) < 0.08) {
          c.x = 0;
          c.vx = 0;
        }
        if (Math.abs(c.y) < 0.08 && Math.abs(c.vy) < 0.08) {
          c.y = 0;
          c.vy = 0;
        }
        if (Math.abs(rotErr) < 0.05 && Math.abs(c.vr) < 0.05) {
          c.rot = c.baseRotate;
          c.vr = 0;
        }
      }

      applyTransforms(now);
      resolveCollisions(now);
      applyTransforms(now);

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [count]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const c = stateRef.current[drag.index];
      if (!c) return;

      const pvx = e.clientX - drag.lastX;
      const pvy = e.clientY - drag.lastY;
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;

      // Rotate around the grab point from the pointer's tangential motion
      const dRot = spinFromDelta(
        drag.grabLocalX,
        drag.grabLocalY,
        c.rot,
        pvx,
        pvy
      );
      c.rot += dRot;
      c.vr = dRot;

      const arm = rotate(drag.grabLocalX, drag.grabLocalY, c.rot);
      c.x = e.clientX - arm.x - drag.restCx;
      c.y = e.clientY - arm.y - drag.restCy;
      c.vx = pvx;
      c.vy = pvy;
    };

    const endDrag = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      const c = stateRef.current[drag.index];
      if (c) {
        c.dragging = false;
        c.vr *= 0.55;
        c.vx *= 0.65;
        c.vy *= 0.65;
      }
      dragRef.current = null;
      const node = cardRefs.current[drag.index];
      try {
        node?.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
    };
  }, []);

  const startDrag = (index: number, e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    const c = stateRef.current[index];
    if (!c) return;
    const center = cardCenter(el);
    const local = unrotate(e.clientX - center.x, e.clientY - center.y, c.rot);

    c.dragging = true;
    c.vx = 0;
    c.vy = 0;
    c.vr = 0;

    dragRef.current = {
      index,
      pointerId: e.pointerId,
      lastX: e.clientX,
      lastY: e.clientY,
      grabLocalX: local.x,
      grabLocalY: local.y,
      restCx: center.x - c.x,
      restCy: center.y - c.y
    };
    el.setPointerCapture(e.pointerId);
  };

  return (
    <div className="home-atmosphere" ref={layerRef} aria-hidden>
      {REPORT_CLASS.slice(0, count).map((cls, i) => (
        <button
          key={cls}
          type="button"
          className={`home-report ${cls}`}
          ref={(node) => {
            cardRefs.current[i] = node;
          }}
          tabIndex={-1}
          onPointerDown={(e) => startDrag(i, e)}
        />
      ))}
    </div>
  );
}
