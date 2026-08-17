import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
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
import { PIP_DWELL_MS, PIP_FLASH_MS, PIP_REVERSE_MS } from "../lib/pipTiming";
import { scrolledRecently } from "../lib/recentScroll";
import {
  getScrollRoot,
  isProgrammaticScroll,
  markProgrammaticScroll,
  readScrollTop,
  writeScrollTop
} from "../lib/scrollRoot";
import type { LibraryParagraph, SectionState } from "../types";

/** Hover must dwell this long before mouse highlights a section. */
const HOVER_ACTIVATE_MS = 500;
const SECTION_DELETE_HOLD_MS = 3000;

interface Props {
  section: SectionState;
  index: number;
  sectionNumbers: number[];
  aiConfigured: boolean;
  busy: boolean;
  aiWorking: boolean;
  /** Error message from the last AI attempt on this section, if any. */
  aiError?: string | null;
  /** True when this card is the focused / highlighted section. */
  focused?: boolean;
  /** True while the review dwell timer is running on this section (pip + chip fill). */
  dwelling?: boolean;
  /** Compact (non-expanded) layout — used while this card is the drag source. */
  liftCompact?: boolean;
  /** Visual-only clone (e.g. drag ghost): no focus chase, no activate, unique DOM id. */
  dragPreview?: boolean;
  onChange: (index: number, next: SectionState) => void;
  onAskAi: (index: number) => void;
  onDismissAiError?: (index: number) => void;
  onActivate?: (index: number) => void;
  onAnnotate?: (index: number) => void;
  onDelete?: (index: number) => void;
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
  /**
   * True when the photo can grow taller than the square thumb without needing
   * more than 20% horizontal crop (see highlight expand logic).
   */
  const [canGrowY, setCanGrowY] = useState(false);
  const naturalRef = useRef({ w: 1, h: 1 });

  const syncGrowAxis = (el: HTMLImageElement) => {
    const nw = el.naturalWidth;
    const nh = el.naturalHeight;
    if (!nw || !nh) return;
    naturalRef.current = { w: nw, h: nh };
    // Square thumb uses cover; growing taller adds horizontal crop once vertical
    // crop is gone. Allow grow only while that stays within 20%.
    setCanGrowY(nh / nw > 0.8);
  };

  useEffect(() => {
    const u = imagePreviewUrl(bytes, name);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [bytes, name]);

  useEffect(() => {
    const el = imgRef.current;
    if (el?.complete) syncGrowAxis(el);
  }, [url]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
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
        className={`thumb-btn${canGrowY ? " can-grow-y" : ""}`}
        onClick={openLightbox}
        aria-label={`Enlarge ${name}`}
      >
        <img
          ref={imgRef}
          className={`thumb${expanded ? " is-expanded-source" : ""}`}
          src={url}
          alt={name}
          loading="lazy"
          onLoad={(e) => syncGrowAxis(e.currentTarget)}
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
  // Classes mirror studio pip tones (see .studio-pip.tone-*).
  if (s.pendingNoteConfirm)
    return { label: "Confirm note", cls: "chip note-confirm" };
  if (s.needsAttention) return { label: "Needs attention", cls: "chip attention" };
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
      return { label: "Empty", cls: "chip empty" };
  }
}

/** Border tone for the main text box — mirrors pip colours, skips attention/review. */
function textBoxTone(
  s: SectionState
): "library" | "ai" | "manual" | null {
  if (s.needsAttention || s.pendingReview || s.pendingNoteConfirm) return null;
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
  aiError = null,
  focused = false,
  dwelling = false,
  liftCompact = false,
  dragPreview = false,
  onChange,
  onAskAi,
  onDismissAiError,
  onActivate,
  onAnnotate,
  onDelete
}: Props) {
  const [showPicker, setShowPicker] = useState(false);
  /** Progressive text shown while a large paste types in; null = show section.text. */
  const [revealDisplay, setRevealDisplay] = useState<string | null>(null);
  const [noteExpanded, setNoteExpanded] = useState(false);
  const [stackText, setStackText] = useState(false);
  const [deleteHolding, setDeleteHolding] = useState(false);
  const [deleteHoldProgress, setDeleteHoldProgress] = useState(0);
  const [showDeleteHint, setShowDeleteHint] = useState(false);
  const deleteHoldRafRef = useRef(0);
  const deleteHoldArmedRef = useRef(false);
  const deleteHintTimerRef = useRef(0);
  const wasAiWorkingRef = useRef(false);
  const textRevealTimerRef = useRef(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const cardMainRef = useRef<HTMLDivElement>(null);
  const sectionTextRef = useRef<HTMLTextAreaElement>(null);
  const statusChipRef = useRef<HTMLSpanElement>(null);
  const chipDwellFillRef = useRef(0);
  const chipDwellActiveRef = useRef(dwelling);
  const chipFlashTimerRef = useRef(0);
  const [chipFlash, setChipFlash] = useState(false);
  /** Compact-mode text height — highlighted area never shrinks below this. */
  const minTextHeightRef = useRef(0);
  /** Last applied text-box height; image is only re-evaluated when this changes. */
  const lastTextBoxHeightRef = useRef(0);
  const lastThumbHeightRef = useRef(0);
  const focusChaseRafRef = useRef(0);
  const focusChaseRef = useRef<{ lastTop: number; lastScroll: number } | null>(
    null
  );
  const hoverActivateTimerRef = useRef(0);
  const clearHoverActivate = () => {
    if (hoverActivateTimerRef.current) {
      window.clearTimeout(hoverActivateTimerRef.current);
      hoverActivateTimerRef.current = 0;
    }
  };
  const flashStatusChip = () => {
    if (chipFlashTimerRef.current) {
      window.clearTimeout(chipFlashTimerRef.current);
    }
    setChipFlash(true);
    chipFlashTimerRef.current = window.setTimeout(() => {
      chipFlashTimerRef.current = 0;
      setChipFlash(false);
    }, PIP_FLASH_MS);
  };

  useEffect(
    () => () => {
      clearHoverActivate();
      if (chipFlashTimerRef.current) {
        window.clearTimeout(chipFlashTimerRef.current);
      }
      if (deleteHoldRafRef.current) {
        cancelAnimationFrame(deleteHoldRafRef.current);
      }
      if (deleteHintTimerRef.current) {
        window.clearTimeout(deleteHintTimerRef.current);
      }
    },
    []
  );

  const cancelDeleteHold = (showHint: boolean) => {
    deleteHoldArmedRef.current = false;
    setDeleteHolding(false);
    setDeleteHoldProgress(0);
    if (deleteHoldRafRef.current) {
      cancelAnimationFrame(deleteHoldRafRef.current);
      deleteHoldRafRef.current = 0;
    }
    if (showHint) {
      setShowDeleteHint(true);
      if (deleteHintTimerRef.current) {
        window.clearTimeout(deleteHintTimerRef.current);
      }
      deleteHintTimerRef.current = window.setTimeout(() => {
        setShowDeleteHint(false);
        deleteHintTimerRef.current = 0;
      }, 2200);
    }
  };

  const onDeletePointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragPreview || !onDelete || aiWorking || busy) return;
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    deleteHoldArmedRef.current = true;
    setDeleteHolding(true);
    setShowDeleteHint(false);
    setDeleteHoldProgress(0);
    const start = performance.now();
    const tick = (now: number) => {
      if (!deleteHoldArmedRef.current) return;
      const p = Math.min(1, (now - start) / SECTION_DELETE_HOLD_MS);
      setDeleteHoldProgress(p);
      if (p >= 1) {
        deleteHoldArmedRef.current = false;
        setDeleteHolding(false);
        setDeleteHoldProgress(0);
        onDelete(index);
        return;
      }
      deleteHoldRafRef.current = requestAnimationFrame(tick);
    };
    deleteHoldRafRef.current = requestAnimationFrame(tick);
  };

  const onDeletePointerUp = () => {
    if (!deleteHoldArmedRef.current) return;
    cancelDeleteHold(true);
  };

  const chipPending =
    section.pendingNoteConfirm || section.pendingReview;
  const chipDwelling = dwelling && chipPending;
  chipDwellActiveRef.current = chipDwelling;

  // Striped status chip: left→right solid fill at the same pace as the pip dwell.
  useEffect(() => {
    const el = statusChipRef.current;
    if (!chipPending) {
      chipDwellFillRef.current = 0;
      el?.style.setProperty("--dwell-fill", "0");
      return;
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced && chipDwelling) {
      chipDwellFillRef.current = 1;
      el?.style.setProperty("--dwell-fill", "1");
      flashStatusChip();
      return;
    }
    if (!chipDwelling && chipDwellFillRef.current <= 0) {
      el?.style.setProperty("--dwell-fill", "0");
      return;
    }
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(48, now - last);
      last = now;
      const prev = chipDwellFillRef.current;
      let next = prev;
      if (chipDwellActiveRef.current) {
        next = Math.min(1, next + dt / PIP_DWELL_MS);
      } else {
        next = Math.max(0, next - dt / PIP_REVERSE_MS);
      }
      if (next !== prev) {
        chipDwellFillRef.current = next;
        statusChipRef.current?.style.setProperty(
          "--dwell-fill",
          next.toFixed(4)
        );
        if (prev < 1 && next >= 1) flashStatusChip();
      }
      if (next > 0 || chipDwellActiveRef.current) {
        raf = requestAnimationFrame(tick);
      }
    };
    el?.style.setProperty("--dwell-fill", chipDwellFillRef.current.toFixed(4));
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [chipPending, chipDwelling, section.entry.number]);

  const chip = statusChip(section);
  const boxTone = textBoxTone(section);
  const paragraph = section.libraryId ? libraryParagraph(section.libraryId) : undefined;
  const bodyExpanded = (focused || showPicker) && !liftCompact;

  const chaseFocusedCard = () => {
    const card = cardRef.current;
    const chase = focusChaseRef.current;
    if (!card || !chase) return;
    // Don't fight pip-driven scroll-to-section animations.
    if (isProgrammaticScroll()) {
      chase.lastTop = card.getBoundingClientRect().top;
      chase.lastScroll = readScrollTop(getScrollRoot());
      return;
    }
    const scrollRoot = getScrollRoot();
    const scrollTop = readScrollTop(scrollRoot);
    const scrollDelta = scrollTop - chase.lastScroll;
    const top = card.getBoundingClientRect().top;
    const expectedTop = chase.lastTop - scrollDelta;
    const layoutDelta = top - expectedTop;
    if (Math.abs(layoutDelta) > 0.5) {
      markProgrammaticScroll(120);
      writeScrollTop(scrollRoot, scrollTop + layoutDelta);
      chase.lastScroll = scrollTop + layoutDelta;
      chase.lastTop = top - layoutDelta;
    } else {
      chase.lastScroll = scrollTop;
      chase.lastTop = top;
    }
  };

  // Highlighted: auto-size text to content (down to compact minimum). Unhighlighted: scroll.
  useLayoutEffect(() => {
    const main = cardMainRef.current;
    const text = sectionTextRef.current;
    if (!main) return;
    const revealing = revealDisplay !== null;

    const mediaSize =
      Number.parseFloat(
        getComputedStyle(main).getPropertyValue("--card-media-size")
      ) || 132;
    const thumb = main.querySelector<HTMLElement>(".thumb-btn.can-grow-y");
    let raf = 0;
    let clearTimer = 0;

    const setMainHeight = (px: number) => {
      main.style.maxHeight = "none";
      main.style.height = `${px}px`;
    };

    const setThumbHeight = (px: number | "") => {
      if (!thumb) return;
      thumb.style.height = px === "" ? "" : `${px}px`;
    };

    const thumbHeightFor = (mainH: number) => {
      const img = thumb?.querySelector("img");
      const nw = img?.naturalWidth ?? 0;
      const nh = img?.naturalHeight ?? 0;
      const maxByCrop =
        nw > 0 && nh > 0 ? (mediaSize * nh) / (nw * 0.8) : mediaSize;
      return Math.max(mediaSize, Math.min(mainH, maxByCrop));
    };

    if (!bodyExpanded) {
      minTextHeightRef.current = 0;
      lastTextBoxHeightRef.current = 0;
      lastThumbHeightRef.current = 0;
      if (stackText) setStackText(false);
      const mainFrom = main.getBoundingClientRect().height;
      const thumbFrom = thumb?.getBoundingClientRect().height ?? mediaSize;
      if (text) {
        text.style.height = `${text.getBoundingClientRect().height}px`;
      }
      setMainHeight(mainFrom);
      setThumbHeight(thumbFrom);
      void main.offsetHeight;
      raf = requestAnimationFrame(() => {
        setMainHeight(mediaSize);
        setThumbHeight(mediaSize);
        clearTimer = window.setTimeout(() => {
          main.style.height = "";
          main.style.maxHeight = "";
          setThumbHeight("");
          if (text) {
            text.style.height = "";
            text.style.minHeight = "";
          }
        }, 300);
      });
      return () => {
        cancelAnimationFrame(raf);
        window.clearTimeout(clearTimer);
      };
    }

    // Lock the compact text height as the minimum the first time we expand.
    if (minTextHeightRef.current <= 0 && text) {
      minTextHeightRef.current = Math.max(
        48,
        text.getBoundingClientRect().height
      );
    }

    const textFrom = text?.getBoundingClientRect().height ?? 0;
    const mainFrom = main.getBoundingClientRect().height;
    const thumbFrom =
      lastThumbHeightRef.current ||
      thumb?.getBoundingClientRect().height ||
      mediaSize;
    const alreadyExpanded = lastTextBoxHeightRef.current > 0;

    const measureAtWidth = (widthPx: number) => {
      if (!text || widthPx < 8) return 0;
      const cs = getComputedStyle(text);
      const probe = document.createElement("textarea");
      probe.value = text.value;
      probe.readOnly = true;
      probe.tabIndex = -1;
      probe.setAttribute("aria-hidden", "true");
      probe.style.cssText = [
        "position:fixed",
        "left:-9999px",
        "top:0",
        "visibility:hidden",
        "pointer-events:none",
        "height:auto",
        "min-height:0",
        "max-height:none",
        "overflow:hidden",
        `width:${widthPx}px`,
        `box-sizing:${cs.boxSizing}`,
        `padding:${cs.padding}`,
        `border:${cs.border}`,
        `font:${cs.font}`,
        `line-height:${cs.lineHeight}`,
        `letter-spacing:${cs.letterSpacing}`
      ].join(";");
      document.body.appendChild(probe);
      const needed = probe.scrollHeight;
      probe.remove();
      return needed;
    };

    const lineHeight = text
      ? Number.parseFloat(getComputedStyle(text).lineHeight) || 19.6
      : 19.6;
    const padY = text
      ? Number.parseFloat(getComputedStyle(text).paddingTop) +
        Number.parseFloat(getComputedStyle(text).paddingBottom)
      : 14;
    const gap = Number.parseFloat(getComputedStyle(main).columnGap) || 12;
    const hasThumb = !!main.querySelector(".thumb-btn");
    const narrowW = hasThumb
      ? Math.max(8, main.clientWidth - mediaSize - gap)
      : Math.max(8, main.clientWidth);
    const neededNarrow = measureAtWidth(narrowW);
    const lineCount = (neededNarrow - padY) / Math.max(1, lineHeight);
    let nextStack = stackText;
    if (!stackText && lineCount > 9) nextStack = true;
    else if (stackText && lineCount <= 8) nextStack = false;
    if (nextStack !== stackText) {
      setStackText(nextStack);
      if (!nextStack) return;
    }

    if (nextStack) {
      const fullW = Math.max(8, text?.clientWidth || main.clientWidth);
      const neededFull = measureAtWidth(fullW);
      if (text) {
        text.style.transition = "";
        text.style.height = `${Math.max(72, neededFull)}px`;
        text.style.minHeight = "";
      }
      main.style.transition = "none";
      main.style.height = "";
      main.style.maxHeight = "";
      setThumbHeight("");
      lastTextBoxHeightRef.current = neededFull;
      lastThumbHeightRef.current = 0;
      return;
    }

    const textNeeded = neededNarrow;
    const textTo = Math.max(minTextHeightRef.current, textNeeded);
    const textBoxResized =
      Math.abs(textTo - lastTextBoxHeightRef.current) > 0.5 || !alreadyExpanded;

    if (text) {
      text.style.height = `${textTo}px`;
      text.style.minHeight = `${minTextHeightRef.current}px`;
    }
    main.style.transition = "none";
    main.style.height = "auto";
    main.style.maxHeight = "none";
    if (thumb) {
      thumb.style.transition = "none";
      setThumbHeight(thumbFrom);
    }
    void main.offsetHeight;
    const mainTo = Math.max(mediaSize, main.scrollHeight);
    const thumbTo = thumbHeightFor(mainTo);

    // Typing that doesn't change the text-box height: leave the image alone.
    if (alreadyExpanded && !textBoxResized) {
      if (text) {
        text.style.height = `${lastTextBoxHeightRef.current}px`;
        text.style.minHeight = `${minTextHeightRef.current}px`;
        text.style.transition = "";
      }
      main.style.transition = "";
      setMainHeight(mainFrom);
      setThumbHeight(thumbFrom);
      if (thumb) {
        void thumb.offsetHeight;
        thumb.style.transition = "";
      }
      return;
    }

    const applyTo = () => {
      if (text) {
        text.style.height = `${textTo}px`;
        text.style.minHeight = `${minTextHeightRef.current}px`;
      }
      setMainHeight(mainTo);
      setThumbHeight(thumbTo);
      lastTextBoxHeightRef.current = textTo;
      lastThumbHeightRef.current = thumbTo;
    };

    // Already open and the text box grew/shrank by a line: update, animate image only if needed.
    // During type-in/erase reveal, skip CSS height easing so the box tracks the visible text.
    if (alreadyExpanded) {
      const thumbChanged = Math.abs(thumbTo - thumbFrom) > 0.5;
      main.style.transition = revealing ? "none" : "";
      if (text) text.style.transition = revealing ? "none" : "";
      if (thumb) {
        thumb.style.transition = revealing || !thumbChanged ? "none" : "";
      }
      if (text) {
        text.style.height = `${textTo}px`;
        text.style.minHeight = `${minTextHeightRef.current}px`;
      }
      setMainHeight(mainTo);
      if (thumbChanged) setThumbHeight(thumbTo);
      else setThumbHeight(thumbFrom);
      lastTextBoxHeightRef.current = textTo;
      if (thumbChanged) lastThumbHeightRef.current = thumbTo;
      if (thumb && (revealing || !thumbChanged)) {
        void thumb.offsetHeight;
        if (!revealing) thumb.style.transition = "";
      }
      return;
    }

    // First highlight: animate from compact sizes up.
    if (text) text.style.height = `${textFrom}px`;
    setMainHeight(mainFrom);
    setThumbHeight(thumbFrom);
    void main.offsetHeight;

    raf = requestAnimationFrame(() => {
      main.style.transition = "";
      if (text) text.style.transition = "";
      if (thumb) thumb.style.transition = "";
      applyTo();
    });

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(clearTimer);
    };
  }, [bodyExpanded, section.text, noteExpanded, section.entry.note, revealDisplay, stackText]);

  // After height layout: pin this card in the viewport while neighbours collapse.
  useLayoutEffect(() => {
    if (dragPreview || !focused) {
      focusChaseRef.current = null;
      return;
    }
    const card = cardRef.current;
    if (!card) return;
    if (!focusChaseRef.current) {
      focusChaseRef.current = {
        lastTop: card.getBoundingClientRect().top,
        lastScroll: readScrollTop(getScrollRoot())
      };
      return;
    }
    chaseFocusedCard();
  }, [dragPreview, focused, bodyExpanded, section.text, noteExpanded, revealDisplay, stackText]);

  useEffect(() => {
    if (dragPreview || !focused) return;
    const card = cardRef.current;
    if (!card) return;
    if (!focusChaseRef.current) {
      focusChaseRef.current = {
        lastTop: card.getBoundingClientRect().top,
        lastScroll: readScrollTop(getScrollRoot())
      };
    }
    const startedAt = performance.now();
    const tick = () => {
      chaseFocusedCard();
      // Cover collapse/expand height (280ms) + highlight scale (180ms).
      if (performance.now() - startedAt < 360) {
        focusChaseRafRef.current = window.requestAnimationFrame(tick);
      }
    };
    focusChaseRafRef.current = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(focusChaseRafRef.current);
  }, [dragPreview, focused]);

  const otherSections = useMemo(
    () => sectionNumbers.filter((n) => n !== section.entry.number),
    [sectionNumbers, section.entry.number]
  );

  const cancelTextReveal = () => {
    window.clearInterval(textRevealTimerRef.current);
    setRevealDisplay(null);
  };

  /**
   * Type new text in (1.5s ease-in-out). With `replace`, first erase the old
   * text with the same motion in reverse at 4× speed, then type the new text.
   * Box height tracks the visible text via the layout effect on `revealDisplay`.
   */
  const triggerTextReveal = (
    prevText: string,
    nextText: string,
    opts?: { replace?: boolean }
  ) => {
    const prev = prevText;
    const next = nextText;
    const prevTrim = prev.trim();
    const nextTrim = next.trim();
    const replace = Boolean(opts?.replace);

    if (replace) {
      if (prevTrim === nextTrim) return;
    } else {
      // Same treatment as AI paste: only for a large block appearing at once.
      const nowLarge = nextTrim.length >= 60;
      const grewALot = nextTrim.length - prevTrim.length >= 40;
      const wasShort = prevTrim.length < 50;
      if (!nowLarge || (!grewALot && !wasShort)) return;
    }

    window.clearInterval(textRevealTimerRef.current);

    const typeMs = 1500;
    const eraseMs = typeMs / 4;
    const tickMs = 16;
    const easeInOut = (t: number) =>
      t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

    const startType = () => {
      if (!next.length) {
        setRevealDisplay(null);
        return;
      }
      const startedAt = performance.now();
      setRevealDisplay("");
      textRevealTimerRef.current = window.setInterval(() => {
        const t = Math.min(1, (performance.now() - startedAt) / typeMs);
        const shown = Math.floor(easeInOut(t) * next.length);
        if (t >= 1) {
          window.clearInterval(textRevealTimerRef.current);
          setRevealDisplay(null);
          return;
        }
        setRevealDisplay(next.slice(0, shown));
      }, tickMs);
    };

    const startErase = () => {
      const startedAt = performance.now();
      setRevealDisplay(prev);
      textRevealTimerRef.current = window.setInterval(() => {
        const t = Math.min(1, (performance.now() - startedAt) / eraseMs);
        // Reverse of the type-in curve: characters disappear from the end.
        const remaining = Math.ceil((1 - easeInOut(t)) * prev.length);
        if (t >= 1) {
          window.clearInterval(textRevealTimerRef.current);
          startType();
          return;
        }
        setRevealDisplay(prev.slice(0, remaining));
      }, tickMs);
    };

    if (replace && prevTrim.length > 0) startErase();
    else startType();
  };

  useEffect(() => {
    return () => window.clearInterval(textRevealTimerRef.current);
  }, []);

  useEffect(() => {
    if (wasAiWorkingRef.current && !aiWorking) {
      triggerTextReveal("", section.text);
      wasAiWorkingRef.current = false;
    }
    wasAiWorkingRef.current = aiWorking;
    // Only react to AI finishing; text content is read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiWorking]);

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
    const nextText = renderLibraryText(libraryId, values);
    triggerTextReveal(section.text, nextText, { replace: true });
    onChange(index, {
      ...section,
      libraryId,
      placeholderValues: values,
      crossrefSection: null,
      text: nextText,
      source: "library",
      needsAttention: hasMissingPlaceholders(libraryId, values),
      pendingReview: false,
      pendingNoteConfirm: false
    });
    setShowPicker(false);
  };

  const setPlaceholder = (key: string, value: string) => {
    if (!section.libraryId) return;
    const values = { ...section.placeholderValues, [key]: value };
    const libraryId = resolveLibraryIdForValues(section.libraryId, values);
    const nextText = renderLibraryText(libraryId, values);
    const wasMissing = hasMissingPlaceholders(
      section.libraryId,
      section.placeholderValues
    );
    const stillMissing = hasMissingPlaceholders(libraryId, values);
    // Reveal when a large block appears, or when the last reading value completes the wording.
    if (wasMissing && !stillMissing) triggerTextReveal("", nextText);
    else triggerTextReveal(section.text, nextText);
    onChange(index, {
      ...section,
      libraryId,
      placeholderValues: values,
      text: nextText,
      needsAttention: stillMissing,
      pendingReview: false,
      pendingNoteConfirm: false
    });
  };

  const editText = (text: string) => {
    cancelTextReveal();
    onChange(index, {
      ...section,
      text,
      libraryId: null,
      crossrefSection: null,
      source: "manual",
      needsAttention: text.trim().length === 0,
      pendingReview: false,
      pendingNoteConfirm: false
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
        pendingReview: false,
        pendingNoteConfirm: false
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
      pendingReview: false,
      pendingNoteConfirm: false
    });
  };

  const textAndPlaceholders = (
    <>
      <div className="section-text-wrap">
        {section.source === "crossref" ? (
          <p className={`crossref-text${boxTone ? ` tone-${boxTone}` : ""}`}>
            {revealDisplay ?? section.text}
          </p>
        ) : (
          <textarea
            ref={sectionTextRef}
            className={`section-text${boxTone ? ` tone-${boxTone}` : ""}`}
            rows={3}
            placeholder={
              paragraph &&
              paragraph.placeholders.length > 0 &&
              hasMissingPlaceholders(section.libraryId!, section.placeholderValues)
                ? "Enter the reading(s) below - wording appears when complete"
                : "Report text for this photo..."
            }
            value={revealDisplay ?? section.text}
            disabled={aiWorking || revealDisplay !== null}
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
    </>
  );

  return (
    <div
      ref={cardRef}
      id={dragPreview ? undefined : `section-card-${section.entry.number}`}
      className={`card${section.needsAttention ? " attention" : ""}${section.pendingReview ? " pending-review" : ""}${aiWorking ? " ai-working" : ""}${aiError ? " ai-error" : ""}${focused || showPicker ? " is-active" : ""}${stackText ? " is-stack-text" : ""}${dragPreview ? " is-drag-preview" : ""}`}
      aria-busy={aiWorking}
      aria-hidden={dragPreview || undefined}
      onFocusCapture={() => {
        if (dragPreview) return;
        clearHoverActivate();
        onActivate?.(index);
      }}
      onPointerDownCapture={(e) => {
        if (dragPreview) return;
        // Touch: wait for tap (click). Pointer-down would highlight mid-scroll.
        if (e.pointerType === "touch") return;
        clearHoverActivate();
        onActivate?.(index);
      }}
      onClick={() => {
        if (dragPreview) return;
        clearHoverActivate();
        onActivate?.(index);
      }}
      onMouseEnter={() => {
        if (dragPreview) return;
        if (document.documentElement.dataset.pointerInput === "coarse") return;
        // After recent scrolling, require a click — hover would catch cards sliding under the cursor.
        if (scrolledRecently(HOVER_ACTIVATE_MS)) return;
        if (focused) return;
        clearHoverActivate();
        hoverActivateTimerRef.current = window.setTimeout(() => {
          hoverActivateTimerRef.current = 0;
          if (scrolledRecently(HOVER_ACTIVATE_MS)) return;
          onActivate?.(index);
        }, HOVER_ACTIVATE_MS);
      }}
      onMouseLeave={dragPreview ? undefined : clearHoverActivate}
    >
      {aiError && (
        <div className="ai-error-overlay" role="alert">
          <p className="ai-error-title">AI couldn’t finish this section</p>
          <p className="ai-error-message">{aiError}</p>
          <div className="ai-error-actions">
            <button
              type="button"
              className="btn small"
              onClick={() => onDismissAiError?.(index)}
            >
              Dismiss
            </button>
            <button
              type="button"
              className="btn small primary"
              disabled={!aiConfigured || busy}
              onClick={() => onAskAi(index)}
            >
              Try again
            </button>
          </div>
        </div>
      )}
      <div className="card-head">
        <span className="card-number">({section.entry.number})</span>
        {aiWorking ? (
          <span className="chip ai writing">
            <span className="ai-spinner" aria-hidden />
            Writing…
          </span>
        ) : (
          <span
            ref={statusChipRef}
            className={`${chip.cls}${chipFlash ? " is-flash" : ""}`}
          >
            {chip.label}
          </span>
        )}
        {section.entry.created && (
          <span className="card-date">{section.entry.created}</span>
        )}
      </div>

      <div className="card-body" ref={cardMainRef}>
        {section.entry.images.length > 0 && (
          <Thumb
            bytes={section.entry.images[0]}
            name={section.entry.imageNames[0]}
          />
        )}
        <div className="card-copy">
          {section.entry.note && (
            <button
              type="button"
              className={`note${noteExpanded ? " is-expanded" : ""}`}
              aria-expanded={noteExpanded || bodyExpanded}
              title={
                noteExpanded || bodyExpanded
                  ? "Collapse field note"
                  : "Expand field note"
              }
              onClick={(e) => {
                e.stopPropagation();
                setNoteExpanded((open) => !open);
              }}
            >
              <strong>Field note:</strong> {section.entry.note}
            </button>
          )}

          <input
            className="heading-input"
            type="text"
            placeholder="Optional heading (e.g. Reading 1)"
            value={section.headingLine}
            disabled={aiWorking}
            onChange={(e) => onChange(index, { ...section, headingLine: e.target.value })}
          />
        </div>
        {textAndPlaceholders}
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
        {section.entry.images[0] && onAnnotate && (
          <button
            type="button"
            className="btn small card-annotate-btn"
            disabled={aiWorking || busy || dragPreview}
            onClick={(e) => {
              e.stopPropagation();
              onAnnotate(index);
            }}
          >
            Annotate
          </button>
        )}
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
        {onDelete && !dragPreview && (
          <span className="card-delete-wrap">
            {showDeleteHint && (
              <span className="card-delete-hint" role="status">
                Hold to delete
              </span>
            )}
            <button
              type="button"
              className={`btn small danger card-delete-btn${
                deleteHolding ? " is-delete-holding" : ""
              }`}
              style={
                {
                  "--delete-hold": deleteHoldProgress
                } as CSSProperties
              }
              disabled={aiWorking || busy}
              aria-label="Hold to delete section"
              onPointerDown={onDeletePointerDown}
              onPointerUp={onDeletePointerUp}
              onPointerCancel={() => cancelDeleteHold(false)}
              onContextMenu={(e) => e.preventDefault()}
            >
              <span className="card-delete-fill" aria-hidden />
              <span className="card-delete-label">Delete</span>
            </button>
          </span>
        )}
      </div>

      {showPicker && (
        <LibraryPicker onPick={pickParagraph} onClose={() => setShowPicker(false)} />
      )}
    </div>
  );
}
