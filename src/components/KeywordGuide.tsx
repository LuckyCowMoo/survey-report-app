import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { library } from "../lib/matcher";
import type { LibraryParagraph } from "../types";

interface Props {
  onClose: () => void;
}

/**
 * Phrases the matcher understands directly (special rules), beyond plain
 * keyword matching. Keep in sync with specialRules() in src/lib/matcher.ts.
 */
const SMART_PHRASES: Array<{ phrase: string; effect: string }> = [
  {
    phrase: "999",
    effect:
      "Maximum-saturation reading wording; add \"masonry\" or \"brick\" for the masonry-resistance wording instead"
  },
  {
    phrase: "baseline kitchen / baseline landing / ...",
    effect:
      "Baseline moisture reading wording — add a room/area (kitchen, bathroom, landing, bedroom, …) to fill where it was taken"
  },
  {
    phrase: "Dp 8.7 / dew 15.5 / dew point 16°",
    effect:
      "Dew point wording - fills in the temperature (Dp/dew, with or without a ° sign)"
  },
  {
    phrase: "rh 41.6 / rh 65%",
    effect:
      "Relative humidity - fills in the reading (with or without a % sign) and picks above/within-threshold wording (over 55% = high)"
  },
  {
    phrase: "air quality",
    effect:
      "Air quality test wording - add \"no issues\" / \"ok\" for the all-clear wording instead of the high-humidity one"
  },
  {
    phrase: "pin skirting / pin joist / pin subfloor / pin door / pin plaster / pin block",
    effect:
      "Steel-pin reading wording for that location; a bare \"pin\" defaults to the door-frame wording (flagged for review)"
  },
  { phrase: "infrared / laser", effect: "Infrared laser analysis wording" },
  {
    phrase: "thermal ceiling / thermal walls / thermal heat loss",
    effect:
      "Thermal camera wording for that finding; a bare \"thermal\" defaults to the walls wording (flagged for review)"
  },
  {
    phrase: "1.2m (a bare measurement)",
    effect: "Three-readings-at-heights wording with the height filled in"
  },
  {
    phrase: "N / SW / facing north / facing NE / ...",
    effect:
      "Weather-exposure wording for that orientation (single- or double-letter abbreviations work)"
  },
  { phrase: "front / front elevation", effect: "Front elevation photo wording" },
  { phrase: "rear / back / rear elevation", effect: "Rear elevation photo wording" },
  {
    phrase: "reading 1, reading 2, ...",
    effect:
      "Adds a numbered \"Reading N\" heading; following photos without notes continue the numbering"
  }
];

const TIPS: string[] = [
  "Short notes (up to ~11 words) are matched against the keywords below.",
  "Longer notes are kept word-for-word as your own text for that photo.",
  "Photos with no note are flagged for clarification or attention.",
  "Values in the note - like rh 41.6, dew 15.5, 65%, 16° or 1.2m - are automatically filled into the standard wording.",
  "Anything that isn't a confident match is flagged \"needs attention\" on the review screen.",
  "If standard wording needs a meter reading (e.g. relative humidity) and it isn't in the note, Ask AI first tries to read it from the photo; if it cannot, it writes a generic paragraph instead of inventing a number."
];

/** Status pip colours on the review screen (right-hand column). */
const PIP_LEGEND: Array<{ tone: string; label: string; meaning: string }> = [
  {
    tone: "attention",
    label: "Orange",
    meaning:
      "Needs attention — empty, missing readings, or no confident match"
  },
  {
    tone: "noteConfirm",
    label: "Yellow / blue stripes",
    meaning:
      "Long field note — kept as written. Review this section to confirm accuracy and the pip will become blue"
  },
  {
    tone: "manual",
    label: "Blue",
    meaning: "Your wording — confirmed field note, edited text, or a cross-reference"
  },
  {
    tone: "review",
    label: "Yellow / green stripes",
    meaning:
      "Standard text is filled in but confidence is low. Review this section to confirm accuracy and the pip will become green"
  },
  {
    tone: "library",
    label: "Green",
    meaning: "Standard wording — confident library match, or a soft match you've already reviewed"
  },
  {
    tone: "ai",
    label: "Purple",
    meaning:
      "AI written — wording generated using ask AI feature based on picture and notes"
  },
  {
    tone: "error",
    label: "Red",
    meaning:
      "AI error — Ask AI failed on this section; open the card overlay to read the message, dismiss it, or try again"
  },
  {
    tone: "empty",
    label: "Grey",
    meaning: "Empty — no text yet and not otherwise flagged"
  }
];

export default function KeywordGuide({ onClose }: Props) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    searchRef.current?.focus({ preventScroll: true });
  }, []);

  const groups = useMemo(() => {
    const map = new Map<string, LibraryParagraph[]>();
    for (const p of library.photoParagraphs) {
      const list = map.get(p.group) ?? [];
      list.push(p);
      map.set(p.group, list);
    }
    return [...map.entries()];
  }, []);

  // Keywords used by more than one topic - the note needs a context word for
  // these before the matcher can be certain which wording is meant.
  const sharedKeywords = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of library.photoParagraphs) {
      for (const k of p.keywords) {
        const key = k.toLowerCase();
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return new Set([...counts].filter(([, n]) => n > 1).map(([k]) => k));
  }, []);

  const q = query.trim().toLowerCase();
  const matches = (p: LibraryParagraph) =>
    q === "" ||
    p.topic.toLowerCase().includes(q) ||
    p.keywords.some((k) => k.toLowerCase().includes(q));

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet tall guide" onClick={(e) => e.stopPropagation()}>
        <h2>Guide</h2>
        <p className="muted">
          What to write under a photo in the shorthand document so the right
          standard wording is picked automatically.
        </p>

        <input
          ref={searchRef}
          type="search"
          className="guide-search"
          placeholder="Filter topics and keywords..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        {q === "" && (
          <>
            <h3 className="guide-heading">How matching works</h3>
            <ul className="guide-tips">
              {TIPS.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>

            <h3 className="guide-heading">Review status pips</h3>
            <p className="muted">
              On the review screen, the thin coloured column on the right shows
              each photo section&apos;s status at a glance. Colour changes fill
              top-to-bottom (about 0.7s, or ~5s while you review a yellow pip). Tap
              a pip to jump to that section.
            </p>
            <ul className="guide-pip-legend">
              {PIP_LEGEND.map((p) => (
                <li key={p.tone}>
                  <span className={`guide-pip-swatch tone-${p.tone}`} aria-hidden />
                  <span>
                    <strong>{p.label}</strong> — {p.meaning}
                  </span>
                </li>
              ))}
            </ul>

            <h3 className="guide-heading">Smart phrases</h3>
            <p className="muted">
              These are understood directly, including common misspellings
              (e.g. "infa red", "dew piont", "r.h.").
            </p>
            <table className="guide-table">
              <tbody>
                {SMART_PHRASES.map((s) => (
                  <tr key={s.phrase}>
                    <td className="guide-phrase">{s.phrase}</td>
                    <td>{s.effect}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <h3 className="guide-heading">All topics & keywords</h3>
        <p className="muted">
          <span className="chip kw shared">outlined</span> keywords are used by
          more than one topic - add a context word (e.g. "pin skirting" rather
          than just "pin") so the right wording is chosen; otherwise the
          section is flagged for review with all candidates suggested.
        </p>
        {groups.map(([group, paragraphs]) => {
          const visible = paragraphs.filter(matches);
          if (visible.length === 0) return null;
          return (
            <section key={group} className="guide-group">
              <h4>{group}</h4>
              {visible.map((p) => (
                <div key={p.id} className="guide-topic">
                  <span className="guide-topic-name">{p.topic}</span>
                  <span className="guide-keywords">
                    {p.keywords.map((k) => (
                      <span
                        key={k}
                        className={
                          sharedKeywords.has(k.toLowerCase())
                            ? "chip kw shared"
                            : "chip kw"
                        }
                      >
                        {k}
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </section>
          );
        })}

        <div className="sheet-actions">
          <button className="btn primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
