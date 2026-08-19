import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { matchOneFieldNote, type FieldNotePipTone } from "../lib/fieldNotes";
import { extractValues, libraryParagraph } from "../lib/matcher";
import { useTextReveal } from "../lib/textReveal";

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizePhrase(s: string) {
  return s.toLowerCase().replace(/[.]/g, "").replace(/\s+/g, " ").trim();
}

/** Short surveyor tokens → longer phrases to mark in library wording. */
const SHORT_EXPAND: Record<string, string[]> = {
  n: ["north-facing", "north facing", "north"],
  ne: ["northeast-facing", "northeast facing", "north-east", "northeast"],
  e: ["east-facing", "east facing", "east"],
  se: ["southeast-facing", "southeast facing", "south-east", "southeast"],
  s: ["south-facing", "south facing", "south"],
  sw: ["southwest-facing", "southwest facing", "south-west", "southwest"],
  w: ["west-facing", "west facing", "west"],
  nw: ["northwest-facing", "northwest facing", "north-west", "northwest"],
  rh: ["relative humidity"],
  dp: ["dew point"],
  dpc: ["damp-proof course", "damp proof course"],
  dpm: ["damp-proof membrane", "damp proof membrane"],
  piv: ["positive input ventilation", "positive input"]
};

function phrasePattern(phrase: string): string {
  const words = phrase
    .trim()
    .split(/[\s-]+/)
    .filter(Boolean)
    .map(escapeRegExp);
  if (words.length === 0) return "";
  return `\\b${words.join("[\\s-]+")}\\b`;
}

function phraseOccursIn(text: string, phrase: string): boolean {
  const source = phrasePattern(phrase);
  if (!source) return false;
  return new RegExp(source, "i").test(text);
}

function expandNoteTokens(note: string): string[] {
  const tokens = normalizePhrase(note).split(" ").filter(Boolean);
  const out: string[] = [];
  for (const token of tokens) {
    const mapped = SHORT_EXPAND[token];
    if (mapped) out.push(...mapped);
  }
  return out;
}

function valueHighlightPhrases(
  note: string,
  placeholderValues: Record<string, string>
): string[] {
  const extracted = extractValues(note);
  const raw = [
    extracted.percent,
    extracted.temperature,
    extracted.height,
    extracted.location,
    ...Object.values(placeholderValues)
  ].filter((v): v is string => Boolean(v?.trim()));

  const out: string[] = [];
  for (const value of raw) {
    const v = value.trim();
    out.push(v);
    if (extracted.percent && v === extracted.percent) {
      out.push(`${v}%`, `${v} %`);
    }
    if (extracted.temperature && v === extracted.temperature) {
      out.push(`${v}°`, `${v} °`, `${v}°C`, `${v} °C`);
    }
  }
  return out;
}

function previewHighlightPhrases(
  note: string,
  libraryKeywords: string[],
  libraryText: string,
  placeholderValues: Record<string, string>
): string[] {
  const expansions = expandNoteTokens(note);
  const noteNorm = normalizePhrase(note);
  const candidates = [
    ...expansions,
    ...libraryKeywords,
    ...valueHighlightPhrases(note, placeholderValues)
  ];
  const picked: string[] = [];

  const valueSet = new Set(
    valueHighlightPhrases(note, placeholderValues).map(normalizePhrase)
  );
  const triggered = (phrase: string) => {
    const p = normalizePhrase(phrase);
    if (expansions.some((e) => normalizePhrase(e) === p)) return true;
    if (valueSet.has(p)) return true;
    if (p.length < 3) return false;
    return noteNorm.includes(p);
  };

  for (const phrase of candidates.sort((a, b) => b.length - a.length)) {
    if (!triggered(phrase) || !phraseOccursIn(libraryText, phrase)) continue;
    const p = normalizePhrase(phrase);
    if (
      picked.some(
        (m) =>
          normalizePhrase(m).includes(p) && normalizePhrase(m).length > p.length
      )
    ) {
      continue;
    }
    picked.push(phrase);
  }
  return picked;
}

function highlightKeywords(text: string, keywords: string[]): ReactNode {
  const hits = [...new Set(keywords.map((k) => k.trim()).filter(Boolean))].sort(
    (a, b) => b.length - a.length
  );
  if (hits.length === 0) return text;
  const source = hits.map(phrasePattern).filter(Boolean).join("|");
  if (!source) return text;
  const re = new RegExp(`(${source})`, "gi");
  const whole = new RegExp(`^(?:${source})$`, "i");
  const parts = text.split(re);
  return parts.map((part, i) =>
    part && whole.test(part) ? (
      <mark key={i} className="field-notes-kw">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

type Props = {
  note: string;
  tone: FieldNotePipTone;
  disabled: boolean;
  ariaLabel: string;
  placeholder: string;
  onChange: (note: string) => void;
};

export default function FieldNotesNoteField({
  note,
  tone,
  disabled,
  ariaLabel,
  placeholder,
  onChange
}: Props) {
  const [focused, setFocused] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const { revealDisplay, triggerTextReveal, cancelTextReveal } = useTextReveal();

  const match = useMemo(() => matchOneFieldNote(note), [note]);
  const libraryText =
    match.source === "library" && match.text.trim() ? match.text : null;
  const keywords = useMemo(() => {
    if (!libraryText || !match.libraryId) return [] as string[];
    const p = libraryParagraph(match.libraryId);
    return previewHighlightPhrases(
      note,
      p?.keywords ?? [],
      libraryText,
      match.placeholderValues ?? {}
    );
  }, [libraryText, match.libraryId, match.placeholderValues, note]);

  const showPreview = !focused && Boolean(libraryText);
  const previewBody = revealDisplay ?? libraryText ?? note;

  useEffect(() => () => cancelTextReveal(), [cancelTextReveal]);

  return (
    <div className={`field-notes-note-wrap tone-${tone}${focused ? " is-focused" : ""}`}>
      <textarea
        ref={areaRef}
        className={`field-notes-textarea${showPreview ? " is-under-preview" : ""}`}
        placeholder={placeholder}
        value={revealDisplay ?? note}
        disabled={disabled || revealDisplay !== null}
        tabIndex={showPreview ? -1 : undefined}
        aria-hidden={showPreview || undefined}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => {
          setFocused(true);
          cancelTextReveal();
        }}
        onBlur={() => {
          if (libraryText) {
            triggerTextReveal(note, libraryText, { replace: true });
          }
          setFocused(false);
        }}
      />
      {showPreview ? (
        <button
          type="button"
          className="field-notes-note-preview"
          aria-label={ariaLabel}
          onClick={() => {
            if (libraryText) {
              triggerTextReveal(libraryText, note, {
                eraseOnly: true,
                onDone: () => {
                  setFocused(true);
                  window.setTimeout(() => areaRef.current?.focus(), 0);
                }
              });
            } else {
              setFocused(true);
              window.setTimeout(() => areaRef.current?.focus(), 0);
            }
          }}
        >
          {highlightKeywords(previewBody, keywords)}
        </button>
      ) : null}
    </div>
  );
}
