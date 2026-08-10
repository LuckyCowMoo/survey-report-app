import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

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

/** Soft home — slow settle, little overshoot */
const SPRING = 0.011 * 0.05;
const DAMPING = 0.945;
const ROT_SPRING = 0.009 * 0.05;
const ROT_DAMPING = 0.94;
const ANGULAR_GAIN = 0.85;
const COLLISION_BOUNCE = 0.4;
const FLOAT_AMP_Y = 7;
const FLOAT_AMP_X = 5;
const FLOAT_AMP_R = 1.8;

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
  }
];

function degToRad(d: number) {
  return (d * Math.PI) / 180;
}

function rotate(x: number, y: number, deg: number) {
  const r = degToRad(deg);
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: x * c - y * s, y: x * s + y * c };
}

function unrotate(x: number, y: number, deg: number) {
  return rotate(x, y, -deg);
}

function cardCenter(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
}

function overlapSeparate(
  a: DOMRect,
  b: DOMRect
): { ox: number; oy: number } | null {
  const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  if (overlapX <= 0 || overlapY <= 0) return null;

  const aCx = (a.left + a.right) / 2;
  const bCx = (b.left + b.right) / 2;
  const aCy = (a.top + a.bottom) / 2;
  const bCy = (b.top + b.bottom) / 2;

  if (overlapX < overlapY) {
    const dir = aCx < bCx ? -1 : 1;
    return { ox: dir * overlapX, oy: 0 };
  }
  const dir = aCy < bCy ? -1 : 1;
  return { ox: 0, oy: dir * overlapY };
}

/** Decorative floating report cards — draggable, spring home, soft collide. */
export default function FloatingReports() {
  const layerRef = useRef<HTMLDivElement>(null);
  const cardARef = useRef<HTMLButtonElement>(null);
  const cardBRef = useRef<HTMLButtonElement>(null);
  const stateRef = useRef<CardState[]>(INITIAL.map((c) => ({ ...c })));
  const dragRef = useRef<DragState | null>(null);
  const reduceMotionRef = useRef(false);

  useEffect(() => {
    reduceMotionRef.current = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const cards = stateRef.current;
    const els = () => [cardARef.current, cardBRef.current] as const;
    let raf = 0;
    let last = performance.now();

    const applyTransforms = (time: number) => {
      const t = time / 1000;
      const nodes = els();
      for (let i = 0; i < 2; i++) {
        const el = nodes[i];
        const c = cards[i];
        if (!el) continue;

        let bobX = 0;
        let bobY = 0;
        let bobR = 0;
        if (!reduceMotionRef.current && !c.dragging) {
          const p = c.phase + t * (0.55 + i * 0.12);
          bobX = Math.sin(p) * FLOAT_AMP_X;
          bobY = Math.cos(p * 0.85) * FLOAT_AMP_Y;
          bobR = Math.sin(p * 0.7) * FLOAT_AMP_R;
        }

        el.style.transform = `translate3d(${c.x + bobX}px, ${c.y + bobY}px, 0) rotate(${c.rot + bobR}deg)`;
        el.classList.toggle("is-dragging", c.dragging);
      }
    };

    const resolveCollision = () => {
      const [aEl, bEl] = els();
      if (!aEl || !bEl) return;

      const sep = overlapSeparate(
        aEl.getBoundingClientRect(),
        bEl.getBoundingClientRect()
      );
      if (!sep) return;

      const a = cards[0];
      const b = cards[1];
      const { ox, oy } = sep;

      if (a.dragging && !b.dragging) {
        b.x -= ox;
        b.y -= oy;
        if (ox) b.vx = a.vx * COLLISION_BOUNCE;
        if (oy) b.vy = a.vy * COLLISION_BOUNCE;
        b.vr += (a.vr - b.vr) * 0.2;
      } else if (b.dragging && !a.dragging) {
        a.x += ox;
        a.y += oy;
        if (ox) a.vx = b.vx * COLLISION_BOUNCE;
        if (oy) a.vy = b.vy * COLLISION_BOUNCE;
        a.vr += (b.vr - a.vr) * 0.2;
      } else if (!a.dragging && !b.dragging) {
        a.x += ox / 2;
        a.y += oy / 2;
        b.x -= ox / 2;
        b.y -= oy / 2;
        if (ox) {
          const av = a.vx;
          a.vx = b.vx * COLLISION_BOUNCE;
          b.vx = av * COLLISION_BOUNCE;
        }
        if (oy) {
          const av = a.vy;
          a.vy = b.vy * COLLISION_BOUNCE;
          b.vy = av * COLLISION_BOUNCE;
        }
      }
    };

    const tick = (now: number) => {
      const dt = Math.min(32, now - last) / 16.67;
      last = now;

      for (const c of cards) {
        if (c.dragging) continue;

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
      resolveCollision();
      applyTransforms(now);

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const c = stateRef.current[drag.index];

      const pvx = e.clientX - drag.lastX;
      const pvy = e.clientY - drag.lastY;
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;

      // Rotate around the grab point from the pointer's tangential motion
      const lever = rotate(drag.grabLocalX, drag.grabLocalY, c.rot);
      const leverLen2 = lever.x * lever.x + lever.y * lever.y;
      let dRot = 0;
      if (leverLen2 > 36) {
        const torque = lever.x * pvy - lever.y * pvx;
        dRot = (torque / leverLen2) * ANGULAR_GAIN * (180 / Math.PI);
        // Soft clamp so a flick doesn't hard-spin the card
        dRot = Math.max(-12, Math.min(12, dRot));
      }
      c.rot += dRot;
      c.vr = dRot;

      // Keep the grab point glued under the cursor
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
      c.dragging = false;
      // Keep a little spin / throw, but soft
      c.vr *= 0.55;
      c.vx *= 0.65;
      c.vy *= 0.65;
      dragRef.current = null;
      const node = drag.index === 0 ? cardARef.current : cardBRef.current;
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
    const center = cardCenter(el);
    // Strip idle bob from the grab math by using physics pose only
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
      <button
        type="button"
        className="home-report home-report-a"
        ref={cardARef}
        tabIndex={-1}
        onPointerDown={(e) => startDrag(0, e)}
      />
      <button
        type="button"
        className="home-report home-report-b"
        ref={cardBRef}
        tabIndex={-1}
        onPointerDown={(e) => startDrag(1, e)}
      />
    </div>
  );
}
