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

const PURPOSE_COPY = [
  "What this tool is for",
  "This app helps a damp and timber surveyor turn a shorthand site document — numbered photos with short field notes — into a polished, client-ready report. You import the .docx from the Files app (on your computer or mobile device); the app reads it entirely on this device.",
  "For each photo it tries to match the note to the firm's approved standard wording, filling in values from the note (such as humidity or pin readings). You then review every section, edit or swap wording, add property and client details, choose which damp issues and recommendations apply, and generate the finished report — cover, contents, photo sections, explainers, costs, and limitations — again entirely on the device."
];

const API_COPY = [
  "AI API keys (Claude or Gemini)",
  "Ask AI needs an external Claude (Anthropic) or Gemini (Google) API key to link those LLM providers to this app. Keys stay on this device only and are never uploaded elsewhere by the app, nor are they necessary for all its functionality.",
  "Link a key in this app",
  "On the home screen, open Settings.",
  "Under AI service, pick Claude or Gemini.",
  "Paste the matching API key into the key field.",
  "Leave the model name as the default unless you know you need a different one, then tap Save.",
  "Get a Claude (Anthropic) key",
  "platform.claude.com",
  "Settings → API keys",
  "Create key",
  "sk-ant-",
  "Plans & Billing",
  "Get a Gemini (Google) key",
  "aistudio.google.com",
  "Create API key",
  "AIza",
  "free tier"
];

const TOPICS_INTRO =
  "All topics & keywords outlined keywords are used by more than one topic - add a context word (e.g. pin skirting rather than just pin) so the right wording is chosen; otherwise the section is flagged for review with all candidates suggested.";

function haystack(...parts: string[]): string {
  return parts.join(" ").toLowerCase();
}

function matchesQuery(q: string, ...parts: string[]): boolean {
  return q === "" || haystack(...parts).includes(q);
}

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

  const showPurpose = matchesQuery(q, ...PURPOSE_COPY);

  const matchingSectionHit = matchesQuery(q, "How matching works");
  const tipHits = TIPS.filter((t) => matchesQuery(q, t));
  const showMatching = q === "" || matchingSectionHit || tipHits.length > 0;

  const showApi = matchesQuery(q, ...API_COPY);

  const pipsSectionHit = matchesQuery(
    q,
    "Review status pips",
    "jump-on-hover",
    "coloured column"
  );
  const pipHits = PIP_LEGEND.filter((p) =>
    matchesQuery(q, p.tone, p.label, p.meaning)
  );
  const showPips = q === "" || pipsSectionHit || pipHits.length > 0;

  const smartSectionHit = matchesQuery(q, "Smart phrases", "misspellings");
  const smartHits = SMART_PHRASES.filter((s) =>
    matchesQuery(q, s.phrase, s.effect)
  );
  const showSmart = q === "" || smartSectionHit || smartHits.length > 0;

  const topicMatch = (p: LibraryParagraph) =>
    q === "" ||
    p.topic.toLowerCase().includes(q) ||
    p.keywords.some((k) => k.toLowerCase().includes(q));

  const visibleGroups = groups
    .map(([group, paragraphs]) => [group, paragraphs.filter(topicMatch)] as const)
    .filter(([, paragraphs]) => paragraphs.length > 0);

  const topicsSectionHit = matchesQuery(q, TOPICS_INTRO);
  const showTopics =
    q === "" || topicsSectionHit || visibleGroups.length > 0;

  const tipsToShow = q === "" || matchingSectionHit ? TIPS : tipHits;
  const pipsToShow = q === "" || pipsSectionHit ? PIP_LEGEND : pipHits;
  const smartToShow = q === "" || smartSectionHit ? SMART_PHRASES : smartHits;

  const anyHit =
    showPurpose ||
    showMatching ||
    showApi ||
    showPips ||
    showSmart ||
    showTopics;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet tall guide" onClick={(e) => e.stopPropagation()}>
        <h2>Guide</h2>
        <p className="muted">
          How this app turns field notes into a finished damp survey report, and
          what to write so the right standard wording is picked automatically.
        </p>

        <input
          ref={searchRef}
          type="search"
          className="guide-search"
          placeholder="Filter guide, topics, and keywords..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        {showPurpose && (
          <>
            <h3 className="guide-heading">What this tool is for</h3>
            <p className="muted">
              This app helps a damp and timber surveyor turn a shorthand site
              document — numbered photos with short field notes — into a
              polished, client-ready report. You import the{" "}
              <code>.docx</code> from the Files app (on your computer or mobile
              device); the app reads it entirely on this device.
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
            <h3 className="guide-heading">AI API keys (Claude or Gemini)</h3>
            <p className="muted">
              Ask AI needs an external Claude (Anthropic) or Gemini (Google) API
              key to link those LLM providers to this app. Keys stay on this
              device only and are never uploaded elsewhere by the app, nor are
              they necessary for all its functionality.
            </p>

            <h4 className="guide-subheading">Link a key in this app</h4>
            <ol className="guide-steps">
              <li>On the home screen, open Settings.</li>
              <li>
                Under <strong>AI service</strong>, pick Claude or Gemini.
              </li>
              <li>Paste the matching API key into the key field.</li>
              <li>
                Leave the model name as the default unless you know you need a
                different one, then tap Save.
              </li>
            </ol>

            <h4 className="guide-subheading">Get a Claude (Anthropic) key</h4>
            <ol className="guide-steps">
              <li>
                Sign in (or create an account) at{" "}
                <a
                  href="https://platform.claude.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  platform.claude.com
                </a>
                .
              </li>
              <li>
                Open{" "}
                <a
                  href="https://platform.claude.com/settings/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Settings → API keys
                </a>
                .
              </li>
              <li>
                Click <strong>Create key</strong>, give it a name, and copy the
                key immediately (it starts with <code>sk-ant-</code> and is only
                shown once).
              </li>
              <li>
                In Anthropic&apos;s console, add billing / credits under Plans
                &amp; Billing — new keys usually will not work until payment is
                set up.
              </li>
              <li>
                Paste the key into Settings here with AI service set to Claude.
              </li>
            </ol>

            <h4 className="guide-subheading">Get a Gemini (Google) key</h4>
            <ol className="guide-steps">
              <li>
                Sign in with a Google account at{" "}
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  aistudio.google.com/app/apikey
                </a>
                .
              </li>
              <li>
                Click <strong>Create API key</strong> and choose (or create) a
                Google Cloud project when asked.
              </li>
              <li>
                Copy the key (often starts with <code>AIza</code>) and store it
                somewhere safe.
              </li>
              <li>
                Paste it into Settings here with AI service set to Gemini. Gemini
                has an extremely limited free tier suitable for some testing;
                check Google AI Studio for current limits and billing if you need
                more.
              </li>
            </ol>
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
                {paragraphs.map((p) => (
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
            ))}
          </>
        )}

        {q !== "" && !anyHit && (
          <p className="muted guide-empty">No guide sections match “{query.trim()}”.</p>
        )}

        <div className="sheet-actions">
          <button className="btn primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
