import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import FloatingReports from "./FloatingReports";
import HomeCtaMorph from "./HomeCtaMorph";
import { IconBook, IconCamera, IconFileUp, IconGrid, IconSettings } from "./icons";
import { CTA_MERGE_MS } from "../lib/homeCtaMorph";

interface Props {
  onFile: (file: File) => void;
  onCreateFieldNotes: () => void;
  busy: boolean;
  onShowGuide: () => void;
  onShowSettings: () => void;
  onShowPastReports: () => void;
  /** When false, Import / Create are always shown with no morph. */
  ctaMorph?: boolean;
  /** Lets the app trigger Import (e.g. browser/mouse forward on the home page). */
  importTriggerRef?: MutableRefObject<(() => void) | null>;
}

const MERGE_MS = CTA_MERGE_MS;
const AUTO_MERGE_MS = 10_000;

export default function HomeScreen({
  onFile,
  onCreateFieldNotes,
  busy,
  onShowGuide,
  onShowSettings,
  onShowPastReports,
  ctaMorph = true,
  importTriggerRef
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const splitRootRef = useRef<HTMLDivElement>(null);
  const mergeTimerRef = useRef(0);
  const autoMergeTimerRef = useRef(0);
  const [ctaSplit, setCtaSplit] = useState(!ctaMorph);
  const [ctaMerging, setCtaMerging] = useState(false);

  const mergeCta = useCallback(() => {
    if (!ctaMorph || !ctaSplit || ctaMerging) return;
    setCtaMerging(true);
    window.clearTimeout(mergeTimerRef.current);
    mergeTimerRef.current = window.setTimeout(() => {
      setCtaSplit(false);
      setCtaMerging(false);
    }, MERGE_MS);
  }, [ctaMorph, ctaSplit, ctaMerging]);

  useEffect(() => {
    if (!importTriggerRef) return;
    importTriggerRef.current = () => {
      if (busy) return;
      inputRef.current?.click();
    };
    return () => {
      importTriggerRef.current = null;
    };
  }, [importTriggerRef, busy]);

  useEffect(() => {
    return () => {
      window.clearTimeout(mergeTimerRef.current);
      window.clearTimeout(autoMergeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!ctaMorph) {
      window.clearTimeout(mergeTimerRef.current);
      window.clearTimeout(autoMergeTimerRef.current);
      setCtaSplit(true);
      setCtaMerging(false);
      return;
    }
    setCtaSplit(false);
    setCtaMerging(false);
  }, [ctaMorph]);

  useEffect(() => {
    if (!ctaMorph || !ctaSplit || ctaMerging) {
      window.clearTimeout(autoMergeTimerRef.current);
      return;
    }
    autoMergeTimerRef.current = window.setTimeout(() => {
      mergeCta();
    }, AUTO_MERGE_MS);

    const onPointer = (e: PointerEvent) => {
      const root = splitRootRef.current;
      if (root && root.contains(e.target as Node)) return;
      mergeCta();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") mergeCta();
    };
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(autoMergeTimerRef.current);
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [ctaMorph, ctaSplit, ctaMerging, mergeCta]);

  const openSplit = () => {
    if (busy || ctaSplit || ctaMerging) return;
    setCtaSplit(true);
  };

  const openImport = () => {
    if (busy) return;
    if (ctaMorph) {
      setCtaSplit(false);
      setCtaMerging(false);
    }
    inputRef.current?.click();
  };

  const splitLive = ctaMorph ? ctaSplit && !ctaMerging : true;

  return (
    <div className="home">
      <FloatingReports />

      <div className="home-hero">
        <div className="home-kicker">
          <span className="home-mark" aria-hidden />
          DampMaster / Report studio
        </div>
        <h2>
          Create
          <br />
          report.
        </h2>
        <p>Turn field notes into a client-ready report.</p>
        {onShowGuide && (
          <button
            type="button"
            className="home-tutorial-link"
            onClick={onShowGuide}
          >
            Retake the tutorial
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />

      <div className="home-actions">
        <div
          ref={splitRootRef}
          className={`home-cta-split${ctaSplit || !ctaMorph ? " is-split" : ""}${
            ctaMorph && ctaMerging ? " is-merging" : ""
          }${!ctaMorph ? " is-static" : ""}${busy ? " is-busy" : ""}`}
        >
          <HomeCtaMorph
            key={ctaMorph ? "cta-morph" : "cta-static"}
            split={ctaMorph ? ctaSplit : true}
            merging={ctaMorph ? ctaMerging : false}
            radius={24}
            gap={14}
            blob="#151515"
            importFill="#ff5a36"
            createFill="#00e3d4"
          />

          <button
            type="button"
            className={`home-cta-merged${busy ? " is-busy" : ""}`}
            disabled={busy}
            tabIndex={splitLive ? -1 : 0}
            aria-hidden={splitLive}
            aria-expanded={ctaSplit}
            onClick={openSplit}
          >
            <span className="home-btn-label">
              <span className="home-btn-title">
                {busy ? "Reading document…" : "Start new report"}
              </span>
              <span className="home-upload-meta">
                {busy ? "Please wait" : "Import or create"}
              </span>
            </span>
          </button>

          <div className="home-cta-pair" role="group" aria-label="Start new report">
            <button
              type="button"
              className="home-cta-half home-cta-import"
              disabled={busy}
              tabIndex={splitLive ? 0 : -1}
              onClick={openImport}
            >
              <span className="home-cta-glyph" aria-hidden>
                <IconFileUp className="home-cta-glyph-svg" />
              </span>
              <span className="home-cta-copy">
                <span className="home-btn-title">Import field notes</span>
                <span className="home-upload-meta">.DOCX ↗</span>
              </span>
            </button>
            <button
              type="button"
              className="home-cta-half home-cta-create"
              disabled={busy}
              tabIndex={splitLive ? 0 : -1}
              onClick={() => {
                if (ctaMorph) {
                  setCtaSplit(false);
                  setCtaMerging(false);
                }
                onCreateFieldNotes();
              }}
            >
              <span className="home-cta-glyph" aria-hidden>
                <IconCamera className="home-cta-glyph-svg" />
              </span>
              <span className="home-cta-copy">
                <span className="home-btn-title">Create new notes</span>
                <span className="home-upload-meta">Camera</span>
              </span>
            </button>
          </div>
        </div>

        <div className="home-secondary-actions">
          <button
            className="btn home-guide-btn home-past-btn"
            aria-label="Past reports"
            onClick={onShowPastReports}
          >
            <span className="home-btn-icon" aria-hidden>
              <IconGrid className="home-btn-glyph" />
            </span>
            <span className="home-btn-label">Past reports</span>
          </button>
          <button
            className="btn home-guide-btn"
            aria-label="Guide"
            onClick={onShowGuide}
          >
            <span className="home-btn-icon" aria-hidden>
              <IconBook className="home-btn-glyph" />
            </span>
            <span className="home-btn-label">Guide</span>
          </button>
          <button
            className="btn home-guide-btn home-settings-btn"
            aria-label="Settings"
            onClick={onShowSettings}
          >
            <span className="home-btn-icon" aria-hidden>
              <IconSettings className="home-btn-glyph" />
            </span>
            <span className="home-btn-label">Settings</span>
          </button>
        </div>
      </div>
    </div>
  );
}
