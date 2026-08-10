import { useEffect, useMemo, useState } from "react";
import LibraryPicker from "./LibraryPicker";
import {
  extractValues,
  hasMissingPlaceholders,
  libraryParagraph,
  placeholderValuesFromNote,
  renderLibraryText,
  resolveLibraryIdForValues
} from "../lib/matcher";
import { imagePreviewUrl } from "../lib/imageUtils";
import type { LibraryParagraph, SectionState } from "../types";

interface Props {
  section: SectionState;
  index: number;
  sectionNumbers: number[];
  aiConfigured: boolean;
  busy: boolean;
  aiWorking: boolean;
  onChange: (index: number, next: SectionState) => void;
  onAskAi: (index: number) => void;
}

function Thumb({ bytes, name }: { bytes: Uint8Array; name: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = imagePreviewUrl(bytes, name);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [bytes, name]);
  if (!url) return <div className="thumb placeholder" />;
  return <img className="thumb" src={url} alt={name} loading="lazy" />;
}

function statusChip(s: SectionState): { label: string; cls: string } {
  if (s.needsAttention) return { label: "Needs attention", cls: "chip warn" };
  switch (s.source) {
    case "library":
      return { label: "Standard wording", cls: "chip ok" };
    case "ai":
      return {
        label: s.libraryId ? "AI · standard wording" : "AI written",
        cls: "chip ai"
      };
    case "crossref":
      return { label: "Cross-reference", cls: "chip ref" };
    case "manual":
      return { label: "Your wording", cls: "chip manual" };
    default:
      return { label: "Empty", cls: "chip warn" };
  }
}

export default function EntryCard({
  section,
  index,
  sectionNumbers,
  aiConfigured,
  busy,
  aiWorking,
  onChange,
  onAskAi
}: Props) {
  const [showPicker, setShowPicker] = useState(false);
  const chip = statusChip(section);
  const paragraph = section.libraryId ? libraryParagraph(section.libraryId) : undefined;

  const otherSections = useMemo(
    () => sectionNumbers.filter((n) => n !== section.entry.number),
    [sectionNumbers, section.entry.number]
  );

  const pickParagraph = (p: LibraryParagraph) => {
    // Prefer values already typed, else anything parseable from the note.
    // Never seed with library example defaults (e.g. 71.7% RH).
    const fromNote = placeholderValuesFromNote(p, extractValues(section.entry.note));
    const values: Record<string, string> = {};
    for (const ph of p.placeholders) {
      values[ph.key] =
        section.placeholderValues[ph.key]?.trim() || fromNote[ph.key] || "";
    }
    const libraryId = resolveLibraryIdForValues(p.id, values);
    onChange(index, {
      ...section,
      libraryId,
      placeholderValues: values,
      crossrefSection: null,
      text: renderLibraryText(libraryId, values),
      source: "library",
      needsAttention: hasMissingPlaceholders(libraryId, values)
    });
    setShowPicker(false);
  };

  const setPlaceholder = (key: string, value: string) => {
    if (!section.libraryId) return;
    const values = { ...section.placeholderValues, [key]: value };
    const libraryId = resolveLibraryIdForValues(section.libraryId, values);
    onChange(index, {
      ...section,
      libraryId,
      placeholderValues: values,
      text: renderLibraryText(libraryId, values),
      needsAttention: hasMissingPlaceholders(libraryId, values)
    });
  };

  const editText = (text: string) => {
    onChange(index, {
      ...section,
      text,
      libraryId: null,
      crossrefSection: null,
      source: "manual",
      needsAttention: text.trim().length === 0
    });
  };

  const setCrossref = (value: string) => {
    if (value === "") {
      onChange(index, {
        ...section,
        crossrefSection: null,
        text: "",
        source: "empty",
        needsAttention: true
      });
      return;
    }
    const n = Number(value);
    onChange(index, {
      ...section,
      libraryId: null,
      crossrefSection: n,
      text: `As illustrated in section ${n}`,
      source: "crossref",
      needsAttention: false
    });
  };

  return (
    <div
      className={`card${section.needsAttention ? " attention" : ""}${aiWorking ? " ai-working" : ""}`}
      aria-busy={aiWorking}
    >
      <div className="card-head">
        <span className="card-number">({section.entry.number})</span>
        {aiWorking ? (
          <span className="chip ai writing">
            <span className="ai-spinner" aria-hidden />
            Writing…
          </span>
        ) : (
          <span className={chip.cls}>{chip.label}</span>
        )}
        {section.entry.created && (
          <span className="card-date">{section.entry.created}</span>
        )}
      </div>

      <div className="card-body">
        {section.entry.images.length > 0 && (
          <Thumb
            bytes={section.entry.images[0]}
            name={section.entry.imageNames[0]}
          />
        )}
        <div className="card-main">
          {section.entry.note && (
            <p className="note">
              <strong>Field note:</strong> {section.entry.note}
            </p>
          )}

          <input
            className="heading-input"
            type="text"
            placeholder="Optional heading (e.g. Reading 1)"
            value={section.headingLine}
            disabled={aiWorking}
            onChange={(e) => onChange(index, { ...section, headingLine: e.target.value })}
          />

          <div className="section-text-wrap">
            {section.source === "crossref" ? (
              <p className="crossref-text">{section.text}</p>
            ) : (
              <textarea
                className="section-text"
                rows={6}
                placeholder={
                  paragraph &&
                  paragraph.placeholders.length > 0 &&
                  hasMissingPlaceholders(section.libraryId!, section.placeholderValues)
                    ? "Enter the reading(s) below - wording appears when complete"
                    : "Report text for this photo..."
                }
                value={section.text}
                disabled={aiWorking}
                onChange={(e) => editText(e.target.value)}
              />
            )}
            {aiWorking && (
              <div className="ai-writing-overlay" aria-hidden>
                <span className="ai-writing-pulse" />
                <span className="ai-writing-pulse" />
                <span className="ai-writing-pulse" />
                <span className="ai-writing-label">Drafting section…</span>
              </div>
            )}
          </div>

          {paragraph && paragraph.placeholders.length > 0 && (
            <div className="placeholders">
              {paragraph.placeholders.map((ph) => {
                const filled = Boolean(section.placeholderValues[ph.key]?.trim());
                return (
                  <label key={ph.key} className={filled ? undefined : "needs-value"}>
                    <span>{ph.label}</span>
                    <input
                      type="text"
                      value={section.placeholderValues[ph.key] ?? ""}
                      placeholder={ph.default ? `e.g. ${ph.default}` : "Enter value"}
                      disabled={aiWorking}
                      onChange={(e) => setPlaceholder(ph.key, e.target.value)}
                    />
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="card-actions">
        <button className="btn small" disabled={aiWorking} onClick={() => setShowPicker(true)}>
          Standard wording
        </button>
        <button
          className={`btn small${aiWorking ? " ai-busy" : ""}`}
          disabled={!aiConfigured || busy}
          title={aiConfigured ? "" : "Add your API key in Settings"}
          onClick={() => onAskAi(index)}
        >
          {aiWorking ? (
            <>
              <span className="ai-spinner" aria-hidden />
              Writing…
            </>
          ) : (
            "Ask AI"
          )}
        </button>
        <select
          className="crossref-select"
          value={section.crossrefSection ?? ""}
          disabled={aiWorking}
          onChange={(e) => setCrossref(e.target.value)}
        >
          <option value="">Refer to section...</option>
          {otherSections.map((n) => (
            <option key={n} value={n}>
              As illustrated in section {n}
            </option>
          ))}
        </select>
        {section.entry.note && section.text !== section.entry.note && (
          <button className="btn small" onClick={() => editText(section.entry.note)}>
            Use note text
          </button>
        )}
      </div>

      {showPicker && (
        <LibraryPicker onPick={pickParagraph} onClose={() => setShowPicker(false)} />
      )}
    </div>
  );
}
