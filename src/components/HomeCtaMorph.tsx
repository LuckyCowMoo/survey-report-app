import { useEffect, useId, useRef } from "react";
import {
  CTA_PARTICLES,
  advanceCtaProgress,
  ctaMergeFrame,
  ctaMorphFrame,
  type CtaMorphFrame
} from "../lib/homeCtaMorph";

type Props = {
  split: boolean;
  merging: boolean;
  radius: number;
  gap: number;
  blob: string;
  importFill: string;
  createFill: string;
};

export default function HomeCtaMorph({
  split,
  merging,
  radius,
  gap,
  blob,
  importFill,
  createFill
}: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const washGradId = `ctaWash${uid}`;
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const peanutRef = useRef<SVGPathElement>(null);
  const leftRef = useRef<SVGPathElement>(null);
  const rightRef = useRef<SVGPathElement>(null);
  const leftSolidRef = useRef<SVGPathElement>(null);
  const rightSolidRef = useRef<SVGPathElement>(null);
  const washGradRef = useRef<SVGLinearGradientElement>(null);
  const washStop0Ref = useRef<SVGStopElement>(null);
  const washStopARef = useRef<SVGStopElement>(null);
  const washStopBRef = useRef<SVGStopElement>(null);
  const washStop1Ref = useRef<SVGStopElement>(null);
  const popRef = useRef<SVGGElement>(null);
  const progressRef = useRef(split && !merging ? 1 : 0);
  const targetRef = useRef(split && !merging ? 1 : 0);
  targetRef.current = split && !merging ? 1 : 0;

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    let raf = 0;
    let last = performance.now();

    const paint = (
      frame: CtaMorphFrame,
      w: number,
      h: number,
      blobC: string,
      importC: string,
      createC: string,
      rad: number
    ) => {
      const peanut = peanutRef.current;
      const left = leftRef.current;
      const right = rightRef.current;
      const leftSolid = leftSolidRef.current;
      const rightSolid = rightSolidRef.current;
      const pop = popRef.current;
      if (!peanut || !left || !right) return;

      const pose = (el: HTMLElement | null) => {
        if (!el) return;
        el.style.setProperty("--cta-label-merged", String(frame.labelMerged));
        el.style.setProperty("--cta-label-split", String(frame.labelSplit));
        el.style.setProperty("--cta-left-x", `${frame.left.x}px`);
        el.style.setProperty("--cta-left-y", `${frame.left.y}px`);
        el.style.setProperty("--cta-left-w", `${frame.left.w}px`);
        el.style.setProperty("--cta-left-h", `${frame.left.h}px`);
        el.style.setProperty("--cta-left-rot", `${frame.left.rot}deg`);
        el.style.setProperty("--cta-right-x", `${frame.right.x}px`);
        el.style.setProperty("--cta-right-y", `${frame.right.y}px`);
        el.style.setProperty("--cta-right-w", `${frame.right.w}px`);
        el.style.setProperty("--cta-right-h", `${frame.right.h}px`);
        el.style.setProperty("--cta-right-rot", `${frame.right.rot}deg`);
      };
      pose(wrap);
      pose(wrap.parentElement);

      svgRef.current?.setAttribute("viewBox", `0 0 ${w} ${h}`);

      washStop0Ref.current?.setAttribute("stop-color", importC);
      washStopARef.current?.setAttribute("stop-color", importC);
      washStopBRef.current?.setAttribute("stop-color", createC);
      washStop1Ref.current?.setAttribute("stop-color", createC);

      const spread = Math.max(0.004, Math.min(0.5, frame.washSpread));
      washStop0Ref.current?.setAttribute("offset", "0");
      washStopARef.current?.setAttribute("offset", String(0.5 - spread));
      washStopBRef.current?.setAttribute("offset", String(0.5 + spread));
      washStop1Ref.current?.setAttribute("offset", "1");

      const washGrad = washGradRef.current;
      if (washGrad) {
        const x1 = frame.joinX0;
        const x2 = Math.max(x1 + 0.5, frame.joinX1);
        washGrad.setAttribute("gradientUnits", "userSpaceOnUse");
        washGrad.setAttribute("x1", String(x1));
        washGrad.setAttribute("y1", "0");
        washGrad.setAttribute("x2", String(x2));
        washGrad.setAttribute("y2", "0");
        washGrad.setAttribute("spreadMethod", "pad");
      }

      const wash = `url(#${washGradId})`;

      peanut.setAttribute("d", frame.peanutD || "M0 0");
      peanut.setAttribute("transform", `translate(${frame.peanutX} 0)`);
      peanut.style.opacity = String(frame.peanutOpacity);
      peanut.setAttribute("fill", wash);

      left.style.opacity = "0";
      right.style.opacity = "0";

      if (leftSolid && rightSolid) {
        const island = Boolean(frame.leftIslandD && frame.rightIslandD);
        leftSolid.setAttribute("d", island ? frame.leftIslandD : "M0 0");
        rightSolid.setAttribute("d", island ? frame.rightIslandD : "M0 0");
        leftSolid.setAttribute("transform", "");
        rightSolid.setAttribute("transform", "");
        leftSolid.setAttribute("fill", importC);
        rightSolid.setAttribute("fill", createC);
        leftSolid.style.opacity = String(island ? frame.solidFade : 0);
        rightSolid.style.opacity = String(island ? frame.solidFade : 0);
      }

      if (pop) {
        pop.style.opacity = String(frame.pop);
        const cx = w / 2;
        const cy = h / 2;
        const dots = pop.querySelectorAll("circle");
        dots.forEach((dot, i) => {
          const p = CTA_PARTICLES[i];
          if (!p) return;
          const u = frame.pop;
          dot.setAttribute("cx", String(cx + p.ox + p.dx * u));
          dot.setAttribute("cy", String(cy + p.oy + p.dy * u));
          dot.setAttribute("r", String(p.r * (0.35 + 0.65 * (1 - u * 0.4))));
          dot.setAttribute("fill", p.side === "left" ? importC : createC);
        });
      }
    };

    const tick = (now: number) => {
      const dt = Math.min(48, now - last);
      last = now;
      const target = targetRef.current;
      const dir = target > progressRef.current ? 1 : target < progressRef.current ? -1 : 0;
      if (dir !== 0) {
        progressRef.current = advanceCtaProgress(
          progressRef.current,
          dt,
          dir
        );
        if (Math.abs(progressRef.current - target) < 0.001) {
          progressRef.current = target;
        }
      }
      const host = wrap.parentElement ?? wrap;
      const cs = getComputedStyle(host);
      const rad =
        parseFloat(cs.getPropertyValue("--cta-radius")) || radius;
      const gp = parseFloat(cs.getPropertyValue("--cta-gap")) || gap;
      const blobC = (cs.getPropertyValue("--cta-blob").trim().startsWith("#")
        ? cs.getPropertyValue("--cta-blob").trim()
        : blob);
      const importC = (cs.getPropertyValue("--cta-import").trim().startsWith("#")
        ? cs.getPropertyValue("--cta-import").trim()
        : importFill);
      const createC = (cs.getPropertyValue("--cta-create").trim().startsWith("#")
        ? cs.getPropertyValue("--cta-create").trim()
        : createFill);
      const rect = wrap.getBoundingClientRect();
      const w = Math.max(1, rect.width);
      const h = Math.max(1, rect.height);
      const frame = (targetRef.current >= 1 ? ctaMorphFrame : ctaMergeFrame)(
        progressRef.current,
        w,
        h,
        rad,
        gp
      );
      paint(frame, w, h, blobC, importC, createC, rad);
      raf = window.requestAnimationFrame(tick);
    };

    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [blob, importFill, createFill, radius, gap]);

  return (
    <div ref={wrapRef} className="home-cta-morph">
      <svg ref={svgRef} className="home-cta-goo" aria-hidden="true">
        <defs>
          <linearGradient
            ref={washGradRef}
            id={washGradId}
            gradientUnits="userSpaceOnUse"
            x1="0"
            y1="0"
            x2="1"
            y2="0"
            spreadMethod="pad"
          >
            <stop ref={washStop0Ref} offset="0" stopColor={importFill} />
            <stop ref={washStopARef} offset="0.5" stopColor={importFill} />
            <stop ref={washStopBRef} offset="0.5" stopColor={createFill} />
            <stop ref={washStop1Ref} offset="1" stopColor={createFill} />
          </linearGradient>
        </defs>
        <path
          ref={peanutRef}
          className="home-cta-peanut"
          fill={`url(#${washGradId})`}
        />
        <path
          ref={leftRef}
          className="home-cta-tile home-cta-tile-left"
          fill={`url(#${washGradId})`}
          opacity={0}
        />
        <path
          ref={rightRef}
          className="home-cta-tile home-cta-tile-right"
          fill={`url(#${washGradId})`}
          opacity={0}
        />
        <path
          ref={leftSolidRef}
          className="home-cta-tile-solid"
          fill={importFill}
          opacity={0}
        />
        <path
          ref={rightSolidRef}
          className="home-cta-tile-solid"
          fill={createFill}
          opacity={0}
        />
        <g ref={popRef} className="home-cta-pop" opacity={0}>
          {CTA_PARTICLES.map((p) => (
            <circle key={p.id} r={p.r} />
          ))}
        </g>
      </svg>
    </div>
  );
}
