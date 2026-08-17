import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import { jpegFromSvgElement } from "../lib/imageUtils";
import { nearestCompassIndex } from "../lib/deviceHeading";
import type { LibraryParagraph } from "../types";

export type DirDef = {
  id: string;
  label: string;
  /** Degrees clockwise from north */
  angle: number;
  kind: "cardinal" | "ordinal";
  /** Shorthand stored on a field note when this direction is captured. */
  note: string;
};

export const WEATHER_DIRECTIONS: DirDef[] = [
  { id: "weather-north", label: "N", angle: 0, kind: "cardinal", note: "north facing" },
  {
    id: "weather-northeast",
    label: "NE",
    angle: 45,
    kind: "ordinal",
    note: "northeast facing"
  },
  { id: "weather-east", label: "E", angle: 90, kind: "cardinal", note: "east facing" },
  {
    id: "weather-southeast",
    label: "SE",
    angle: 135,
    kind: "ordinal",
    note: "southeast facing"
  },
  { id: "weather-south", label: "S", angle: 180, kind: "cardinal", note: "south facing" },
  {
    id: "weather-southwest",
    label: "SW",
    angle: 225,
    kind: "ordinal",
    note: "southwest facing"
  },
  { id: "weather-west", label: "W", angle: 270, kind: "cardinal", note: "west facing" },
  {
    id: "weather-northwest",
    label: "NW",
    angle: 315,
    kind: "ordinal",
    note: "northwest facing"
  }
];

const CX = 100;
const CY = 100;
const HIT_SCALE = 1.25;
const DEAD_ZONE_FRAC = 0.05;

function polar(angleDeg: number, radius: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: CX + radius * Math.cos(rad),
    y: CY + radius * Math.sin(rad)
  };
}

function petal(
  angle: number,
  tipR: number,
  baseR: number,
  spreadDeg: number,
  labelR: number
) {
  return {
    tip: polar(angle, tipR),
    left: polar(angle - spreadDeg, baseR),
    right: polar(angle + spreadDeg, baseR),
    label: polar(angle, labelR)
  };
}

function angleDiff(a: number, b: number) {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

function bearingFromNorth(dx: number, dy: number) {
  let deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return deg;
}

function onActivate(e: KeyboardEvent<SVGGElement>, pick: () => void) {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    pick();
  }
}

export function weatherIdForHeading(
  headingDeg: number,
  currentId?: string | null
): string {
  const current = currentId
    ? WEATHER_DIRECTIONS.findIndex((d) => d.id === currentId)
    : -1;
  return WEATHER_DIRECTIONS[
    nearestCompassIndex(headingDeg, current >= 0 ? current : null)
  ]!.id;
}

export function weatherNoteForHeading(
  headingDeg: number,
  currentId?: string | null
): string {
  const id = weatherIdForHeading(headingDeg, currentId);
  return WEATHER_DIRECTIONS.find((d) => d.id === id)?.note ?? "north facing";
}

export type DirectionCompassHandle = {
  captureJpeg: () => Promise<Uint8Array>;
  hotId: () => string | null;
};

type Props = {
  paragraphs: LibraryParagraph[];
  onPick?: (paragraph: LibraryParagraph) => void;
  /** When set, highlight this direction (live compass) instead of pointer hover. */
  hotId?: string | null;
  /** Device heading; rotates the rose so north stays north in the world. */
  headingDeg?: number | null;
  interactive?: boolean;
  showHint?: boolean;
};

export const DirectionCompass = forwardRef<DirectionCompassHandle, Props>(
  function DirectionCompass(
    {
      paragraphs,
      onPick,
      hotId: hotIdProp,
      headingDeg = null,
      interactive = true,
      showHint = true
    },
    ref
  ) {
    const padRef = useRef<HTMLDivElement>(null);
    const svgRef = useRef<SVGSVGElement>(null);
    const frameRef = useRef<HTMLDivElement>(null);
    const [hoverId, setHoverId] = useState<string | null>(null);

    const byId = useMemo(() => {
      const map = new Map<string, LibraryParagraph>();
      for (const p of paragraphs) map.set(p.id, p);
      return map;
    }, [paragraphs]);

    const available = useMemo(
      () => WEATHER_DIRECTIONS.filter((d) => byId.has(d.id)),
      [byId]
    );

    const lastLiveIdRef = useRef<string | null>(null);
    const liveHot =
      hotIdProp ??
      (headingDeg != null
        ? weatherIdForHeading(headingDeg, lastLiveIdRef.current)
        : null);
    if (liveHot) lastLiveIdRef.current = liveHot;
    const hotId = liveHot ?? hoverId;
    const hotIdRef = useRef(hotId);
    hotIdRef.current = hotId;

    useImperativeHandle(ref, () => ({
      captureJpeg: async () => {
        const svg = svgRef.current;
        if (!svg) throw new Error("Compass is not ready yet.");
        const paper =
          getComputedStyle(frameRef.current ?? svg)
            .getPropertyValue("--compass-paper")
            .trim() || "#f7f5f1";
        return jpegFromSvgElement(svg, 1200, paper);
      },
      hotId: () => hotIdRef.current
    }));

    const nearestFromPointer = (e: ReactPointerEvent) => {
      const pad = padRef.current;
      if (!pad || available.length === 0) return null;
      const rect = pad.getBoundingClientRect();
      const dx = e.clientX - (rect.left + rect.width / 2);
      const dy = e.clientY - (rect.top + rect.height / 2);
      const dist = Math.hypot(dx, dy);
      const maxR = rect.width / 2;
      if (dist < maxR * DEAD_ZONE_FRAC || dist > maxR) return null;
      const bearing = bearingFromNorth(dx, dy);
      let best = available[0];
      let bestDiff = Infinity;
      for (const d of available) {
        const diff = angleDiff(d.angle, bearing);
        if (diff < bestDiff) {
          bestDiff = diff;
          best = d;
        }
      }
      return best;
    };

    const onPadMove = (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!interactive || liveHot) return;
      const nearest = nearestFromPointer(e);
      setHoverId(nearest?.id ?? null);
    };

    const onPadLeave = () => {
      if (!interactive) return;
      setHoverId(null);
    };

    const onPadClick = (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!interactive || !onPick) return;
      const nearest = nearestFromPointer(e);
      if (!nearest) return;
      const paragraph = byId.get(nearest.id);
      if (paragraph) onPick(paragraph);
    };

    if (available.length === 0) return null;

    const hotTopic = hotId ? byId.get(hotId)?.topic : undefined;
    const roseRotate =
      headingDeg != null && Number.isFinite(headingDeg) ? -headingDeg : 0;

    return (
      <div
        className="direction-compass"
        role="group"
        aria-label="Property orientation"
      >
        <div className="direction-compass-frame" ref={frameRef}>
          <svg
            ref={svgRef}
            className="direction-compass-svg"
            viewBox="-24 -24 248 248"
            style={{ transform: `rotate(${roseRotate}deg)` }}
          >
            <circle className="compass-ring" cx={CX} cy={CY} r={74} />
            <circle className="compass-ring" cx={CX} cy={CY} r={60} />

            {available
              .filter((d) => d.kind === "ordinal")
              .map((d) => {
                const paragraph = byId.get(d.id)!;
                const { tip, left, right, label } = petal(d.angle, 46, 16, 28, 98);
                const pick = () => onPick?.(paragraph);
                const hot = hotId === d.id;
                return (
                  <g
                    key={d.id}
                    className={`compass-point ordinal${hot ? " is-hot" : ""}`}
                    role={interactive ? "button" : "img"}
                    tabIndex={interactive ? 0 : undefined}
                    aria-label={paragraph.topic}
                    aria-current={hot ? "true" : undefined}
                    onKeyDown={
                      interactive ? (e) => onActivate(e, pick) : undefined
                    }
                  >
                    <polygon
                      className="compass-petal solid"
                      points={`${tip.x},${tip.y} ${left.x},${left.y} ${CX},${CY} ${right.x},${right.y}`}
                    />
                    <text
                      className="compass-letter ordinal"
                      x={label.x}
                      y={label.y}
                      textAnchor="middle"
                      dominantBaseline="central"
                    >
                      {d.label}
                    </text>
                    <title>{paragraph.topic}</title>
                  </g>
                );
              })}

            {available
              .filter((d) => d.kind === "cardinal")
              .map((d) => {
                const paragraph = byId.get(d.id)!;
                const { tip, left, right, label } = petal(d.angle, 64, 14, 32, 102);
                const pick = () => onPick?.(paragraph);
                const hot = hotId === d.id;
                return (
                  <g
                    key={d.id}
                    className={`compass-point cardinal${hot ? " is-hot" : ""}`}
                    role={interactive ? "button" : "img"}
                    tabIndex={interactive ? 0 : undefined}
                    aria-label={paragraph.topic}
                    aria-current={hot ? "true" : undefined}
                    onKeyDown={
                      interactive ? (e) => onActivate(e, pick) : undefined
                    }
                  >
                    <polygon
                      className="compass-petal dark"
                      points={`${tip.x},${tip.y} ${left.x},${left.y} ${CX},${CY}`}
                    />
                    <polygon
                      className="compass-petal light"
                      points={`${tip.x},${tip.y} ${CX},${CY} ${right.x},${right.y}`}
                    />
                    <text
                      className="compass-letter cardinal"
                      x={label.x}
                      y={label.y}
                      textAnchor="middle"
                      dominantBaseline="central"
                    >
                      {d.label}
                    </text>
                    <title>{paragraph.topic}</title>
                  </g>
                );
              })}

            <circle className="compass-hub" cx={CX} cy={CY} r={4.5} />
          </svg>
          {interactive ? (
            <div
              ref={padRef}
              className="compass-pad"
              style={{ ["--hit-scale" as string]: String(HIT_SCALE) }}
              onPointerMove={onPadMove}
              onPointerLeave={onPadLeave}
              onClick={onPadClick}
              title={
                hotTopic
                  ? `${hotTopic} — click to select`
                  : "Move toward a direction, then click to select"
              }
            />
          ) : null}
        </div>
        {showHint && hotTopic && (
          <p className="direction-compass-hint">{hotTopic}</p>
        )}
      </div>
    );
  }
);
