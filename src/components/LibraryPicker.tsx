import {
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import { createPortal } from "react-dom";
import { library } from "../lib/matcher";
import type { LibraryParagraph } from "../types";

interface Props {
  onPick: (paragraph: LibraryParagraph) => void;
  onClose: () => void;
}

const WEATHER_GROUP = "Weather / orientation";

/**
 * Binary choices shown side-by-side in the picker (yes/no, above/within, etc.).
 * Order is left → right.
 */
const CHOICE_PAIRS: Array<[string, string]> = [
  ["front-elevation", "rear-elevation"],
  ["air-quality-high-humidity", "air-quality-no-issues"],
  ["rh-high", "rh-low"],
  ["reading-999-saturation", "reading-999-resistance"]
];

const CHOICE_MATE = new Map<string, string>();
for (const [a, b] of CHOICE_PAIRS) {
  CHOICE_MATE.set(a, b);
  CHOICE_MATE.set(b, a);
}

type PickerRow =
  | { kind: "single"; item: LibraryParagraph }
  | { kind: "pair"; left: LibraryParagraph; right: LibraryParagraph };

function toPickerRows(items: LibraryParagraph[]): PickerRow[] {
  const byId = new Map(items.map((p) => [p.id, p]));
  const used = new Set<string>();
  const rows: PickerRow[] = [];

  for (const p of items) {
    if (used.has(p.id)) continue;
    const mateId = CHOICE_MATE.get(p.id);
    const mate = mateId ? byId.get(mateId) : undefined;
    if (mate) {
      const pair = CHOICE_PAIRS.find(
        ([a, b]) => a === p.id || b === p.id
      )!;
      const left = byId.get(pair[0])!;
      const right = byId.get(pair[1])!;
      used.add(left.id);
      used.add(right.id);
      rows.push({ kind: "pair", left, right });
      continue;
    }
    used.add(p.id);
    rows.push({ kind: "single", item: p });
  }
  return rows;
}

function PickerItemButton({
  paragraph,
  onPick
}: {
  paragraph: LibraryParagraph;
  onPick: (paragraph: LibraryParagraph) => void;
}) {
  return (
    <button
      type="button"
      className="picker-item"
      onClick={() => onPick(paragraph)}
    >
      <strong>{paragraph.topic}</strong>
      <span>{paragraph.text.slice(0, 110)}...</span>
    </button>
  );
}

type DirDef = {
  id: string;
  label: string;
  /** Degrees clockwise from north */
  angle: number;
  kind: "cardinal" | "ordinal";
};

const DIRECTIONS: DirDef[] = [
  { id: "weather-north", label: "N", angle: 0, kind: "cardinal" },
  { id: "weather-northeast", label: "NE", angle: 45, kind: "ordinal" },
  { id: "weather-east", label: "E", angle: 90, kind: "cardinal" },
  { id: "weather-southeast", label: "SE", angle: 135, kind: "ordinal" },
  { id: "weather-south", label: "S", angle: 180, kind: "cardinal" },
  { id: "weather-southwest", label: "SW", angle: 225, kind: "ordinal" },
  { id: "weather-west", label: "W", angle: 270, kind: "cardinal" },
  { id: "weather-northwest", label: "NW", angle: 315, kind: "ordinal" }
];

const CX = 100;
const CY = 100;
/** Hit disk is 25% larger than the visible compass (layout stays tight). */
const HIT_SCALE = 1.25;
const DEAD_ZONE_FRAC = 0.05;

function polar(angleDeg: number, radius: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: CX + radius * Math.cos(rad),
    y: CY + radius * Math.sin(rad)
  };
}

/** Tip + two base points near the hub for a compass petal. */
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

/** Bearing clockwise from north in degrees [0, 360). */
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

function DirectionCompass({
  paragraphs,
  onPick
}: {
  paragraphs: LibraryParagraph[];
  onPick: (paragraph: LibraryParagraph) => void;
}) {
  const padRef = useRef<HTMLDivElement>(null);
  const [hotId, setHotId] = useState<string | null>(null);

  const byId = useMemo(() => {
    const map = new Map<string, LibraryParagraph>();
    for (const p of paragraphs) map.set(p.id, p);
    return map;
  }, [paragraphs]);

  const available = useMemo(
    () => DIRECTIONS.filter((d) => byId.has(d.id)),
    [byId]
  );

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
    const nearest = nearestFromPointer(e);
    setHotId(nearest?.id ?? null);
  };

  const onPadLeave = () => setHotId(null);

  const onPadClick = (e: ReactPointerEvent<HTMLDivElement>) => {
    const nearest = nearestFromPointer(e);
    if (!nearest) return;
    const paragraph = byId.get(nearest.id);
    if (paragraph) onPick(paragraph);
  };

  if (available.length === 0) return null;

  const hotTopic = hotId ? byId.get(hotId)?.topic : undefined;

  return (
    <div className="direction-compass" role="group" aria-label="Property orientation">
      <div className="direction-compass-frame">
      <svg className="direction-compass-svg" viewBox="-24 -24 248 248">
        <circle className="compass-ring" cx={CX} cy={CY} r={74} />
        <circle className="compass-ring" cx={CX} cy={CY} r={60} />

        {/* Ordinal points — shorter solid diamonds behind the cardinals */}
        {available
          .filter((d) => d.kind === "ordinal")
          .map((d) => {
            const paragraph = byId.get(d.id)!;
            const { tip, left, right, label } = petal(d.angle, 46, 16, 28, 98);
            const pick = () => onPick(paragraph);
            const hot = hotId === d.id;
            return (
              <g
                key={d.id}
                className={`compass-point ordinal${hot ? " is-hot" : ""}`}
                role="button"
                tabIndex={0}
                aria-label={paragraph.topic}
                aria-current={hot ? "true" : undefined}
                onKeyDown={(e) => onActivate(e, pick)}
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

        {/* Cardinal points — longer, split light/dark */}
        {available
          .filter((d) => d.kind === "cardinal")
          .map((d) => {
            const paragraph = byId.get(d.id)!;
            const { tip, left, right, label } = petal(d.angle, 64, 14, 32, 102);
            const pick = () => onPick(paragraph);
            const hot = hotId === d.id;
            return (
              <g
                key={d.id}
                className={`compass-point cardinal${hot ? " is-hot" : ""}`}
                role="button"
                tabIndex={0}
                aria-label={paragraph.topic}
                aria-current={hot ? "true" : undefined}
                onKeyDown={(e) => onActivate(e, pick)}
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
      {/* Larger hit disk overlays the rose without adding list spacing */}
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
      </div>
      {hotTopic && <p className="direction-compass-hint">{hotTopic}</p>}
    </div>
  );
}

export default function LibraryPicker({ onPick, onClose }: Props) {
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const q = query.toLowerCase().trim();
    const filtered = library.photoParagraphs.filter(
      (p) =>
        q === "" ||
        p.topic.toLowerCase().includes(q) ||
        p.group.toLowerCase().includes(q) ||
        p.text.toLowerCase().includes(q) ||
        p.keywords.some((k) => k.toLowerCase().includes(q))
    );
    const byGroup = new Map<string, LibraryParagraph[]>();
    for (const p of filtered) {
      const list = byGroup.get(p.group) ?? [];
      list.push(p);
      byGroup.set(p.group, list);
    }
    return [...byGroup.entries()];
  }, [query]);

  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet tall" onClick={(e) => e.stopPropagation()}>
        <h2>Standard wording</h2>
        <input
          className="search"
          type="search"
          placeholder="Search topics..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="picker-list">
          {groups.map(([group, items]) => (
            <div key={group} className="picker-group">
              <h3>{group}</h3>
              {group === WEATHER_GROUP ? (
                <DirectionCompass paragraphs={items} onPick={onPick} />
              ) : (
                toPickerRows(items).map((row) =>
                  row.kind === "pair" ? (
                    <div
                      key={`${row.left.id}|${row.right.id}`}
                      className="picker-choice-row"
                    >
                      <PickerItemButton paragraph={row.left} onPick={onPick} />
                      <PickerItemButton paragraph={row.right} onPick={onPick} />
                    </div>
                  ) : (
                    <PickerItemButton
                      key={row.item.id}
                      paragraph={row.item}
                      onPick={onPick}
                    />
                  )
                )
              )}
            </div>
          ))}
          {groups.length === 0 && <p className="muted">No matches.</p>}
        </div>
        <div className="sheet-actions">
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
