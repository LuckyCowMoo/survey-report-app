import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import { createPortal } from "react-dom";
import {
  currentAppHist,
  dismissAppOverlay,
  pushAppHist
} from "../lib/appHistory";
import { library } from "../lib/matcher";
import { usePointerInputModeValue } from "../lib/pointerInput";
import type { LibraryParagraph } from "../types";
import SheetShell from "./SheetShell";

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
  onPick,
  highlighted = false
}: {
  paragraph: LibraryParagraph;
  onPick: (paragraph: LibraryParagraph) => void;
  highlighted?: boolean;
}) {
  return (
    <button
      type="button"
      className={`picker-item${highlighted ? " is-best" : ""}`}
      onClick={() => onPick(paragraph)}
    >
      <strong>{paragraph.topic}</strong>
      <span>{paragraph.text.slice(0, 110)}...</span>
      {highlighted && (
        <em className="picker-best-hint">Press Enter to select</em>
      )}
    </button>
  );
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function searchTokens(query: string): string[] {
  return normalizeSearchText(query).split(/\s+/).filter(Boolean);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const prev = new Array<number>(cols);
  const cur = new Array<number>(cols);
  for (let j = 0; j < cols; j++) prev[j] = j;
  for (let i = 1; i < rows; i++) {
    cur[0] = i;
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j < cols; j++) prev[j] = cur[j]!;
  }
  return prev[b.length]!;
}

function typoBudget(token: string): number {
  if (token.length >= 7) return 2;
  if (token.length >= 4) return 1;
  return 0;
}

/** True when `token` appears in `hay` exactly, as a prefix, or within typo budget. */
function tokenMatchesHay(hay: string, token: string): boolean {
  if (!token) return true;
  if (hay.includes(token)) return true;

  const words = hay.split(/\s+/).filter(Boolean);
  const budget = typoBudget(token);

  for (const word of words) {
    if (word.startsWith(token) || (token.startsWith(word) && word.length >= 2)) {
      return true;
    }
    if (budget > 0 && Math.abs(word.length - token.length) <= budget) {
      if (levenshtein(word, token) <= budget) return true;
    }
  }

  // Allow fuzzy match against short joined chunks (e.g. "subfloor").
  if (budget > 0 && token.length >= 4) {
    for (let i = 0; i + token.length - budget <= hay.length; i++) {
      const slice = hay.slice(i, i + token.length + budget);
      for (let len = token.length - budget; len <= token.length + budget; len++) {
        if (len < 2) continue;
        const piece = slice.slice(0, len);
        if (!piece || Math.abs(piece.length - token.length) > budget) continue;
        if (levenshtein(piece, token) <= budget) return true;
      }
    }
  }

  return false;
}

function paragraphHaystack(p: LibraryParagraph): string {
  return normalizeSearchText(
    [p.topic, p.group, ...p.keywords, p.text.slice(0, 280)].join(" ")
  );
}

/** Higher = closer match for the search box / Enter-to-pick. */
function searchScore(p: LibraryParagraph, q: string): number {
  const toks = searchTokens(q);
  if (toks.length === 0) return 0;

  const topic = normalizeSearchText(p.topic);
  const group = normalizeSearchText(p.group);
  const keywords = p.keywords.map((k) => normalizeSearchText(k));
  const text = normalizeSearchText(p.text.slice(0, 280));
  const hay = paragraphHaystack(p);
  let s = 0;

  const joined = toks.join(" ");
  if (topic === joined) s += 1000;
  else if (topic.startsWith(joined)) s += 520;
  else if (topic.includes(joined)) s += 320;

  for (const token of toks) {
    if (topic === token) s += 420;
    else if (topic.startsWith(token) || topic.split(/\s+/).some((w) => w.startsWith(token)))
      s += 260;
    else if (tokenMatchesHay(topic, token)) s += 180;

    for (const kw of keywords) {
      if (kw === token) s += 360;
      else if (kw.startsWith(token)) s += 200;
      else if (tokenMatchesHay(kw, token)) s += 120;
    }

    if (tokenMatchesHay(group, token)) s += 40;
    if (tokenMatchesHay(text, token)) s += 10;
    if (tokenMatchesHay(hay, token)) s += 4;
  }

  // Prefer topics that cover every token.
  if (toks.every((t) => tokenMatchesHay(topic, t))) s += 140;

  return s;
}

function matchesQuery(p: LibraryParagraph, q: string): boolean {
  const toks = searchTokens(q);
  if (toks.length === 0) return true;
  const hay = paragraphHaystack(p);
  return toks.every((token) => tokenMatchesHay(hay, token));
}

function bestSearchMatch(query: string): LibraryParagraph | null {
  const toks = searchTokens(query);
  if (toks.length === 0) return null;
  const candidates = library.photoParagraphs.filter((p) => matchesQuery(p, query));
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  let best = candidates[0];
  let bestS = searchScore(best, query);
  for (let i = 1; i < candidates.length; i++) {
    const p = candidates[i];
    const s = searchScore(p, query);
    if (s > bestS) {
      best = p;
      bestS = s;
    }
  }
  return best;
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
  const searchRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const pointerMode = usePointerInputModeValue();

  useLayoutEffect(() => {
    if (pointerMode !== "fine") return;
    searchRef.current?.focus({ preventScroll: true });
  }, [pointerMode]);

  // Push a history entry so Escape / browser back dismisses this sheet first.
  useEffect(() => {
    const base = currentAppHist();
    pushAppHist({ ...base, overlay: "library" });
    const onPop = () => onCloseRef.current();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const dismiss = () => dismissAppOverlay("library", onClose);

  const groups = useMemo(() => {
    const q = query.toLowerCase().trim();
    const filtered = library.photoParagraphs.filter((p) => matchesQuery(p, q));
    const byGroup = new Map<string, LibraryParagraph[]>();
    for (const p of filtered) {
      const list = byGroup.get(p.group) ?? [];
      list.push(p);
      byGroup.set(p.group, list);
    }
    return [...byGroup.entries()];
  }, [query]);

  const matchCount = useMemo(
    () => groups.reduce((n, [, items]) => n + items.length, 0),
    [groups]
  );

  const best = useMemo(() => bestSearchMatch(query), [query]);
  const qTrim = query.trim();
  const showBest = Boolean(qTrim && best);
  const onlyBest = showBest && matchCount === 1;

  return createPortal(
    <SheetShell onClose={dismiss} sheetClassName="sheet tall">
      {({ requestClose }) => {
        const pickAndDismiss = (p: LibraryParagraph) => {
          onPick(p);
          requestClose();
        };
        return (
          <>
            <h2>Standard wording</h2>
            <input
              ref={searchRef}
              className="search"
              type="search"
              placeholder="Search topics..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                const pick = bestSearchMatch(query);
                if (pick) pickAndDismiss(pick);
              }}
            />
            <div className="picker-list">
              {showBest && best && (
                <div className="picker-best">
                  <PickerItemButton
                    paragraph={best}
                    onPick={pickAndDismiss}
                    highlighted
                  />
                </div>
              )}
              {!onlyBest &&
                groups.map(([group, items]) => (
                  <div key={group} className="picker-group">
                    <h3>{group}</h3>
                    {group === WEATHER_GROUP ? (
                      <DirectionCompass
                        paragraphs={items}
                        onPick={pickAndDismiss}
                      />
                    ) : (
                      toPickerRows(items).map((row) =>
                        row.kind === "pair" ? (
                          <div
                            key={`${row.left.id}|${row.right.id}`}
                            className="picker-choice-row"
                          >
                            <PickerItemButton
                              paragraph={row.left}
                              onPick={pickAndDismiss}
                            />
                            <PickerItemButton
                              paragraph={row.right}
                              onPick={pickAndDismiss}
                            />
                          </div>
                        ) : (
                          <PickerItemButton
                            key={row.item.id}
                            paragraph={row.item}
                            onPick={pickAndDismiss}
                          />
                        )
                      )
                    )}
                  </div>
                ))}
              {!showBest && groups.length === 0 && (
                <p className="muted">No matches.</p>
              )}
            </div>
            <div className="sheet-actions">
              <button className="btn" onClick={requestClose}>
                Close
              </button>
            </div>
          </>
        );
      }}
    </SheetShell>,
    document.body
  );
}
