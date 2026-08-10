import { useEffect } from "react";

type Glow = {
  x: number;
  y: number;
  tx: number;
  ty: number;
};

function randomAnchor(): Pick<Glow, "tx" | "ty"> {
  return {
    tx: 8 + Math.random() * 84,
    ty: 6 + Math.random() * 88
  };
}

function makeGlow(seed?: Partial<Glow>): Glow {
  const target = randomAnchor();
  return {
    x: seed?.x ?? target.tx,
    y: seed?.y ?? target.ty,
    tx: seed?.tx ?? target.tx,
    ty: seed?.ty ?? target.ty
  };
}

/** Soft studio background wash — drifts between random viewport anchors. */
export default function AmbientGlow() {
  useEffect(() => {
    const root = document.documentElement;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const aStart = randomAnchor();
    const bStart = randomAnchor();
    const a = makeGlow({ x: 14, y: 8, tx: aStart.tx, ty: aStart.ty });
    const b = makeGlow({ x: 90, y: 75, tx: bStart.tx, ty: bStart.ty });

    let raf = 0;
    let last = performance.now();
    let nextRetargetA = last + 3500;
    let nextRetargetB = last + 5200;

    const tick = (now: number) => {
      const dt = Math.min(48, now - last) / 1000;
      last = now;

      if (now >= nextRetargetA) {
        Object.assign(a, randomAnchor());
        nextRetargetA = now + 2800 + Math.random() * 3200;
      }
      if (now >= nextRetargetB) {
        Object.assign(b, randomAnchor());
        nextRetargetB = now + 3200 + Math.random() * 4000;
      }

      // Reach a new target in roughly ~2.5–4s
      const ease = 1 - Math.exp(-1.35 * dt);
      a.x += (a.tx - a.x) * ease;
      a.y += (a.ty - a.y) * ease;
      b.x += (b.tx - b.x) * ease;
      b.y += (b.ty - b.y) * ease;

      const gx = `${a.x.toFixed(2)}%`;
      const gy = `${a.y.toFixed(2)}%`;
      const g2x = `${b.x.toFixed(2)}%`;
      const g2y = `${b.y.toFixed(2)}%`;
      // Set on both — body paints the wash and may not live-inherit html updates
      for (const el of [root, document.body]) {
        el.style.setProperty("--glow-x", gx);
        el.style.setProperty("--glow-y", gy);
        el.style.setProperty("--glow2-x", g2x);
        el.style.setProperty("--glow2-y", g2y);
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      for (const el of [root, document.body]) {
        el.style.removeProperty("--glow-x");
        el.style.removeProperty("--glow-y");
        el.style.removeProperty("--glow2-x");
        el.style.removeProperty("--glow2-y");
      }
    };
  }, []);

  return null;
}
