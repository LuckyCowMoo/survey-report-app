import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type TransitionEvent as ReactTransitionEvent
} from "react";
import { createPortal } from "react-dom";
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
  /** True when this card is the focused / highlighted section. */
  focused?: boolean;
  onChange: (index: number, next: SectionState) => void;
  onAskAi: (index: number) => void;
  onActivate?: (index: number) => void;
}

type Rect = { top: number; left: number; width: number; height: number };
type ImgBox = { top: number; left: number; width: number; height: number };
type ExpandFrame = { clip: Rect; img: ImgBox; radius: number };

function coverImg(clip: Rect, nw: number, nh: number): ImgBox {
  const scale = Math.max(clip.width / nw, clip.height / nh) || 1;
  const width = nw * scale;
  const height = nh * scale;
  return {
    width,
    height,
    left: (clip.width - width) / 2,
    top: (clip.height - height) / 2
  };
}

function expandedFrame(nw: number, nh: number, pad = 12): ExpandFrame {
  const maxW = window.innerWidth - pad * 2;
  const maxH = window.innerHeight - pad * 2;
  const scale = Math.min(maxW / nw, maxH / nh) || 1;
  const width = nw * scale;
  const height = nh * scale;
  const clip: Rect = {
    left: (window.innerWidth - width) / 2,
    top: (window.innerHeight - height) / 2,
    width,
    height
  };
  return {
    clip,
    img: { left: 0, top: 0, width, height },
    radius: 4
  };
}

function collapsedFrame(thumb: Rect, nw: number, nh: number): ExpandFrame {
  return {
    clip: thumb,
    img: coverImg(thumb, nw, nh),
    radius: 8
  };
}

function Thumb({ bytes, name }: { bytes: Uint8Array; name: string }) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [open, setOpen] = useState(false);
  const [frame, setFrame] = useState<ExpandFrame | null>(null);
  const [withTransition, setWithTransition] = useState(false);
  const naturalRef = useRef({ w: 1, h: 1 });

  useEffect(() => {
    const u = imagePreviewUrl(bytes, name);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [bytes, name]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, open, animating, frame]);

  const measureThumb = (): Rect | null => {
    const el = imgRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top, left: r.left, width: r.width, height: r.height };
  };

  const openLightbox = () => {
    const el = imgRef.current;
    const thumb = measureThumb();
    if (!el || !url || !thumb || expanded || animating) return;
    const nw = el.naturalWidth || thumb.width;
    const nh = el.naturalHeight || thumb.height;
    naturalRef.current = { w: nw, h: nh };

    const start = collapsedFrame(thumb, nw, nh);
    const end = expandedFrame(nw, nh);
    setFrame(start);
    setWithTransition(false);
    setExpanded(true);
    setOpen(false);
    setAnimating(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setWithTransition(true);
        setFrame(end);
        setOpen(true);
      });
    });
  };

  const close = () => {
    if (!expanded || !frame || (animating && !open)) return;
    const thumb = measureThumb();
    if (!thumb) {
      setExpanded(false);
      setFrame(null);
      return;
    }
    const { w: nw, h: nh } = naturalRef.current;
    setAnimating(true);
    setOpen(false);
    setWithTransition(true);
    setFrame(collapsedFrame(thumb, nw, nh));
  };

  const onFrameTransitionEnd = (e: ReactTransitionEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.propertyName !== "width" && e.propertyName !== "transform") return;
    if (open) {
      setAnimating(false);
      return;
    }
    setExpanded(false);
    setAnimating(false);
    setWithTransition(false);
    setFrame(null);
  };

  if (!url) return <div className="thumb placeholder" />;

  return (
    <>
      <button
        type="button"
        className="thumb-btn"
        onClick={openLightbox}
        aria-label={`Enlarge ${name}`}
      >
        <img
          ref={imgRef}
          className={`thumb${expanded ? " is-expanded-source" : ""}`}
          src={url}
          alt={name}
          loading="lazy"
        />
      </button>

      {expanded &&
        frame &&
        createPortal(
          <div
            className={`thumb-lightbox${open ? " is-open" : ""}`}
            onClick={close}
            role="dialog"
            aria-modal="true"
            aria-label={name}
          >
            <div
              className={`thumb-lightbox-clip${withTransition ? " is-animated" : ""}`}
              style={{
                top: frame.clip.top,
                left: frame.clip.left,
                width: frame.clip.width,
                height: frame.clip.height,
                borderRadius: frame.radius
              }}
              onClick={(e) => {
                e.stopPropagation();
                close();
              }}
              onTransitionEnd={onFrameTransitionEnd}
            >
              <img
                className={`thumb-lightbox-img${withTransition ? " is-animated" : ""}`}
                src={url}
                alt={name}
                draggable={false}
                style={{
                  width: frame.img.width,
                  height: frame.img.height,
                  transform: `translate(${frame.img.left}px, ${frame.img.top}px)`
                }}
              />
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

function statusChip(s: SectionState): { label: string; cls: string } {
  if (s.needsAttention) return { label: "Needs attention", cls: "chip warn" };
  if (s.pendingReview) return { label: "Review wording", cls: "chip review" };
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

/** Border tone for the main text box — mirrors pip colours, skips attention/review. */
function textBoxTone(
  s: SectionState
): "library" | "ai" | "manual" | null {
  if (s.needsAttention || s.pendingReview) return null;
  switch (s.source) {
    case "library":
      return "library";
    case "ai":
      return "ai";
    case "manual":
    case "crossref":
      return "manual";
    default:
      return null;
  }
}

export default function EntryCard({
  section,
  index,
  sectionNumbers,
  aiConfigured,
  busy,
  aiWorking,
  focused = false,
  onChange,
  onAskAi,
  onActivate
}: Props) {
  const [showPicker, setShowPicker] = useState(false);
  const chip = statusChip(section);
  const boxTone = textBoxTone(section);
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
      needsAttention: hasMissingPlaceholders(libraryId, values),
      pendingReview: false
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
      needsAttention: hasMissingPlaceholders(libraryId, values),
      pendingReview: false
    });
  };

  const editText = (text: string) => {
    onChange(index, {
      ...section,
      text,
      libraryId: null,
      crossrefSection: null,
      source: "manual",
      needsAttention: text.trim().length === 0,
      pendingReview: false
    });
  };

  const setCrossref = (value: string) => {
    if (value === "") {
      onChange(index, {
        ...section,
        crossrefSection: null,
        text: "",
        source: "empty",
        needsAttention: true,
        pendingReview: false
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
      needsAttention: false,
      pendingReview: false
    });
  };

  return (
    <div
      id={`section-card-${section.entry.number}`}
      className={`card${section.needsAttention ? " attention" : ""}${section.pendingReview ? " pending-review" : ""}${aiWorking ? " ai-working" : ""}${focused || showPicker ? " is-active" : ""}`}
      aria-busy={aiWorking}
      onFocusCapture={() => onActivate?.(index)}
      onPointerDownCapture={() => onActivate?.(index)}
      onMouseEnter={() => onActivate?.(index)}
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
              <p className={`crossref-text${boxTone ? ` tone-${boxTone}` : ""}`}>
                {section.text}
              </p>
            ) : (
              <textarea
                className={`section-text${boxTone ? ` tone-${boxTone}` : ""}`}
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
