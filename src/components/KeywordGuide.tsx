import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { LibraryParagraph } from "../types";
import { library } from "../lib/matcher";
import { AI_PROVIDER_ORDER, AI_PROVIDERS, type AiProvider } from "../lib/aiProviders";
import { PROVIDER_GUIDE } from "../lib/aiProviderGuide";
import { HOME_SCREEN_GUIDE } from "../lib/homeScreenGuide";
import { usePointerInputModeValue } from "../lib/pointerInput";
import HomeScreenGuide from "./HomeScreenGuide";
import ProviderKeyGuide from "./ProviderKeyGuide";
import SheetShell from "./SheetShell";
import { REVIEW_PIP_LEGEND } from "../lib/pipLegend";

/**
 * Compass abbreviations accepted by specialRules() but omitted from library
 * keywords (a bare "w" would false-match notes containing the letter w).
 * Shown in the guide only.
 */
const WEATHER_ABBREV: Record<string, string[]> = {
  "weather-north": ["N"],
  "weather-northeast": ["NE"],
  "weather-east": ["E"],
  "weather-southeast": ["SE"],
  "weather-south": ["S"],
  "weather-southwest": ["SW"],
  "weather-west": ["W"],
  "weather-northwest": ["NW"]
};

function guideKeywordsFor(p: LibraryParagraph): string[] {
  const extra = WEATHER_ABBREV[p.id];
  if (!extra) return p.keywords;
  const seen = new Set(p.keywords.map((k) => k.toLowerCase()));
  const merged = [...p.keywords];
  for (const k of extra) {
    if (!seen.has(k.toLowerCase())) merged.push(k);
  }
  return merged;
}

interface Props {
  onClose: () => void;
  apiKeys: Partial<Record<AiProvider, string>>;
  onApiKeyChange: (apiKey: string, provider: AiProvider) => void;
  onStartTutorial?: (opts?: { fromStart?: boolean }) => void;
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
    phrase: "N / E / S / W / NE / NW / SE / SW / facing north / ...",
    effect:
      "Weather-exposure wording for that orientation — bare letters (e.g. W) or “facing …” both work"
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

const PURPOSE_COPY = [
  "What this tool is for",
  "This app helps a damp and timber surveyor turn numbered photo field notes into a polished, client-ready report. Start a new report to create field notes with the device camera, or import a Report and Run .docx. Everything stays on this device.",
  "For each photo it tries to match the note to the firm's approved standard wording, filling in values from the note (such as humidity or pin readings). You then review every section, edit or swap wording, add property and client details, choose which damp issues and recommendations apply, and generate the finished report — cover, contents, photo sections, explainers, costs, and limitations — again entirely on the device."
];

const API_COPY = [
  "AI API keys",
  "Ask AI needs an external LLM API key",
  "Link a key in this app",
  "Settings",
  "Slide to a provider",
  "Supported API key types",
  ...AI_PROVIDER_ORDER.flatMap((id) => {
    const info = AI_PROVIDERS[id];
    const guide = PROVIDER_GUIDE[id];
    return [
      info.label,
      info.keyHint,
      info.keyPrefix,
      guide.brand.shortName,
      guide.brand.company,
      guide.whyChoose,
      ...guide.steps.map((s) => s.text + (s.linkLabel ?? ""))
    ];
  })
];

const HOME_SCREEN_COPY = [
  "Add to Home Screen",
  "Install",
  "homescreen",
  "home screen",
  ...HOME_SCREEN_GUIDE.flatMap((e) => [
    e.shortName,
    e.title,
    e.subtitle,
    ...(e.note ? [e.note] : []),
    ...e.steps.map((s) => s.text)
  ])
];

const TOPICS_INTRO =
  "All topics & keywords outlined keywords are used by more than one topic - add a context word (e.g. pin skirting rather than just pin) so the right wording is chosen; otherwise the section is flagged for review with all candidates suggested.";

function haystack(...parts: string[]): string {
  return parts.join(" ").toLowerCase();
}

function matchesQuery(q: string, ...parts: string[]): boolean {
  return q === "" || haystack(...parts).includes(q);
}

export default function KeywordGuide({
  onClose,
  apiKeys,
  onApiKeyChange,
  onStartTutorial
}: Props) {
  const [query, setQuery] = useState("");
  const [viewingId, setViewingId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const pointerMode = usePointerInputModeValue();
  const tutorialHoldRef = useRef(0);
  const tutorialHoldTimerRef = useRef(0);
  const tutorialShakeRafRef = useRef(0);
  const [tutorialShake, setTutorialShake] = useState(0);

  const stopTutorialHold = () => {
    if (tutorialHoldTimerRef.current) {
      window.clearTimeout(tutorialHoldTimerRef.current);
      tutorialHoldTimerRef.current = 0;
    }
    if (tutorialShakeRafRef.current) {
      window.cancelAnimationFrame(tutorialShakeRafRef.current);
      tutorialShakeRafRef.current = 0;
    }
    setTutorialShake(0);
  };

  useLayoutEffect(() => {
    if (pointerMode !== "fine") return;
    searchRef.current?.focus({ preventScroll: true });
  }, [pointerMode]);

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

  const showPurpose = matchesQuery(q, ...PURPOSE_COPY);

  const matchingSectionHit = matchesQuery(q, "How matching works");
  const tipHits = TIPS.filter((t) => matchesQuery(q, t));
  const showMatching = q === "" || matchingSectionHit || tipHits.length > 0;

  const showApi = matchesQuery(q, ...API_COPY);
  const showHomeScreen = matchesQuery(q, ...HOME_SCREEN_COPY);

  const pipsSectionHit = matchesQuery(
    q,
    "Review status pips",
    "jump-on-hover",
    "coloured column"
  );
  const pipHits = REVIEW_PIP_LEGEND.filter((p) =>
    matchesQuery(q, p.tone, p.label, p.meaning)
  );
  const showPips = q === "" || pipsSectionHit || pipHits.length > 0;

  const smartSectionHit = matchesQuery(q, "Smart phrases", "misspellings");
  const smartHits = SMART_PHRASES.filter((s) =>
    matchesQuery(q, s.phrase, s.effect)
  );
  const showSmart = q === "" || smartSectionHit || smartHits.length > 0;

  const topicMatch = (p: LibraryParagraph) => {
    if (q === "") return true;
    if (p.topic.toLowerCase().includes(q)) return true;
    if (p.text.toLowerCase().includes(q)) return true;
    return guideKeywordsFor(p).some((k) => k.toLowerCase().includes(q));
  };

  const visibleGroups = groups
    .map(([group, paragraphs]) => [group, paragraphs.filter(topicMatch)] as const)
    .filter(([, paragraphs]) => paragraphs.length > 0);

  const topicsSectionHit = matchesQuery(q, TOPICS_INTRO, "standard wording", "view");
  const showTopics =
    q === "" || topicsSectionHit || visibleGroups.length > 0;

  const tipsToShow = q === "" || matchingSectionHit ? TIPS : tipHits;
  const pipsToShow = q === "" || pipsSectionHit ? REVIEW_PIP_LEGEND : pipHits;
  const smartToShow = q === "" || smartSectionHit ? SMART_PHRASES : smartHits;

  const anyHit =
    showPurpose ||
    showMatching ||
    showApi ||
    showHomeScreen ||
    showPips ||
    showSmart ||
    showTopics;

  return (
    <SheetShell onClose={onClose} sheetClassName="sheet tall guide">
      {({ requestClose }) => (
        <>
        <h2>Guide</h2>

        <input
          ref={searchRef}
          type="search"
          className="guide-search"
          placeholder="Filter guide, topics, and keywords..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        {onStartTutorial && (
          <button
            type="button"
            className={`btn primary big guide-tutorial-btn${tutorialShake > 0 ? " is-holding" : ""}`}
            style={{ ["--shake" as string]: String(tutorialShake) }}
            onClick={(e) => {
              if (tutorialHoldRef.current < 0) {
                e.preventDefault();
                tutorialHoldRef.current = 0;
                return;
              }
              onStartTutorial();
            }}
            onPointerDown={() => {
              stopTutorialHold();
              const started = performance.now();
              tutorialHoldRef.current = started;
              const tick = (now: number) => {
                const t = Math.min(1, (now - started) / 3000);
                setTutorialShake(Math.pow(t, 1.55) * 16);
                if (t < 1) {
                  tutorialShakeRafRef.current = window.requestAnimationFrame(tick);
                }
              };
              tutorialShakeRafRef.current = window.requestAnimationFrame(tick);
              tutorialHoldTimerRef.current = window.setTimeout(() => {
                tutorialHoldTimerRef.current = 0;
                tutorialHoldRef.current = -1;
                stopTutorialHold();
                onStartTutorial({ fromStart: true });
              }, 3000);
            }}
            onPointerUp={stopTutorialHold}
            onPointerCancel={stopTutorialHold}
            onContextMenu={(e) => e.preventDefault()}
          >
            Retake the tutorial
          </button>
        )}

        {showPurpose && (
          <>
            <h3 className="guide-heading">What this tool is for</h3>
            <p className="muted">
              This app helps a damp and timber surveyor turn numbered photo field
              notes into a polished, client-ready report. Start a new report to
              create field notes with the device camera, or import a Report and
              Run <code>.docx</code>. Everything stays on this device.
            </p>
            <p className="muted">
              For each photo it tries to match the note to the firm&apos;s
              approved standard wording, filling in values from the note (such
              as humidity or pin readings). You then review every section, edit
              or swap wording, add property and client details, choose which
              damp issues and recommendations apply, and generate the finished
              report — cover, contents, photo sections, explainers, costs, and
              limitations — again entirely on the device.
            </p>
          </>
        )}

        {showMatching && (
          <>
            <h3 className="guide-heading">How matching works</h3>
            <ul className="guide-tips">
              {tipsToShow.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </>
        )}

        {showApi && (
          <>
            <h3 className="guide-heading">AI API keys</h3>
            <ProviderKeyGuide apiKeys={apiKeys} onApiKeyChange={onApiKeyChange} />
          </>
        )}

        {showHomeScreen && (
          <>
            <h3 className="guide-heading">Add to Home Screen</h3>
            <HomeScreenGuide />
          </>
        )}

        {showPips && (
          <>
            <h3 className="guide-heading">Review status pips</h3>
            <p className="muted">
              On the review screen, the thin coloured column on the right shows
              each photo section&apos;s status at a glance. Colour changes fill
              top-to-bottom (about 0.7s, or ~5s while you review a yellow pip). Click
              or tap a pip to jump to that section — or turn on jump-on-hover in
              Settings.
            </p>
            <ul className="guide-pip-legend">
              {pipsToShow.map((p) => (
                <li key={p.tone}>
                  <span className={`guide-pip-swatch tone-${p.tone}`} aria-hidden />
                  <span>
                    <strong>{p.label}</strong> — {p.meaning}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        {showSmart && (
          <>
            <h3 className="guide-heading">Smart phrases</h3>
            <p className="muted">
              These are understood directly, including common misspellings
              (e.g. "infa red", "dew piont", "r.h.").
            </p>
            <table className="guide-table">
              <tbody>
                {smartToShow.map((s) => (
                  <tr key={s.phrase}>
                    <td className="guide-phrase">{s.phrase}</td>
                    <td>{s.effect}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {showTopics && (
          <>
            <h3 className="guide-heading">All topics & keywords</h3>
            <p className="muted">
              <span className="chip kw shared">outlined</span> keywords are used by
              more than one topic - add a context word (e.g. "pin skirting" rather
              than just "pin") so the right wording is chosen; otherwise the
              section is flagged for review with all candidates suggested.
            </p>
            {visibleGroups.map(([group, paragraphs]) => (
              <section key={group} className="guide-group">
                <h4>{group}</h4>
                {paragraphs.map((p) => {
                  const keywords = guideKeywordsFor(p);
                  return (
                    <div key={p.id} className="guide-topic">
                      <div className="guide-topic-main">
                        <span className="guide-topic-name">{p.topic}</span>
                        <span className="guide-keywords">
                          {keywords.map((k) => (
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
                      <button
                        type="button"
                        className="btn tiny guide-topic-view"
                        onClick={() =>
                          setViewingId((cur) => (cur === p.id ? null : p.id))
                        }
                      >
                        {viewingId === p.id ? "Hide text" : "View text"}
                      </button>
                      {viewingId === p.id && (
                        <p className="guide-topic-text">{p.text}</p>
                      )}
                    </div>
                  );
                })}
              </section>
            ))}
          </>
        )}

        {q !== "" && !anyHit && (
          <p className="muted guide-empty">No guide sections match “{query.trim()}”.</p>
        )}

        <div className="sheet-actions">
          <button className="btn primary" onClick={requestClose}>
            Close
          </button>
        </div>
        </>
      )}
    </SheetShell>
  );
}
