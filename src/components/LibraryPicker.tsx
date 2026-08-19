import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";
import {
  currentAppHist,
  dismissAppOverlay,
  pushAppHist
} from "../lib/appHistory";
import { library } from "../lib/matcher";
import { usePointerInputModeValue } from "../lib/pointerInput";
import {
  bestSearchMatch as bestItemMatch,
  matchesQuery as itemMatchesQuery,
  type SearchableItem
} from "../lib/fuzzySearch";
import type { LibraryParagraph } from "../types";
import { DirectionCompass } from "./DirectionCompass";
import SheetShell from "./SheetShell";
import { useT } from "../lib/i18n";

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

function asSearchable(p: LibraryParagraph): SearchableItem & { paragraph: LibraryParagraph } {
  return {
    id: p.id,
    title: p.topic,
    group: p.group,
    keywords: p.keywords,
    text: p.text,
    paragraph: p
  };
}

function matchesQuery(p: LibraryParagraph, q: string): boolean {
  return itemMatchesQuery(asSearchable(p), q);
}

function bestSearchMatch(query: string): LibraryParagraph | null {
  return bestItemMatch(library.photoParagraphs.map(asSearchable), query)?.paragraph ?? null;
}

export default function LibraryPicker({ onPick, onClose }: Props) {
  const t = useT();
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const pointerMode = usePointerInputModeValue();

  useLayoutEffect(() => {
    if (pointerMode !== "fine") return;
    searchRef.current?.focus({ preventScroll: true });
  }, [pointerMode]);

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
            <h2>{t("picker.title")}</h2>
            <input
              ref={searchRef}
              className="search"
              type="search"
              placeholder={t("picker.search")}
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
                <p className="muted">{t("picker.noMatches")}</p>
              )}
            </div>
            <div className="sheet-actions">
              <button className="btn" onClick={requestClose}>
                {t("common.close")}
              </button>
            </div>
          </>
        );
      }}
    </SheetShell>,
    document.body
  );
}
