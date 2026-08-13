import { useEffect, useRef, useState, type MutableRefObject } from "react";
import FloatingReports from "./FloatingReports";
import { IconBook, IconGrid, IconSettings } from "./icons";

interface Props {
  onFile: (file: File) => void;
  onCreateFieldNotes: () => void;
  busy: boolean;
  onShowGuide: () => void;
  onShowSettings: () => void;
  onShowPastReports: () => void;
  /** Lets the app trigger Import (e.g. browser/mouse forward on the home page). */
  importTriggerRef?: MutableRefObject<(() => void) | null>;
}

export default function HomeScreen({
  onFile,
  onCreateFieldNotes,
  busy,
  onShowGuide,
  onShowSettings,
  onShowPastReports,
  importTriggerRef
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [ctaSplit, setCtaSplit] = useState(false);

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
    if (!ctaSplit) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCtaSplit(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ctaSplit]);

  const openImport = () => {
    if (busy) return;
    setCtaSplit(false);
    inputRef.current?.click();
  };

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
          className={`home-cta-split${ctaSplit ? " is-split" : ""}${busy ? " is-busy" : ""}`}
        >
          {!ctaSplit ? (
            <button
              type="button"
              className={`btn primary big home-upload${busy ? " is-busy" : ""}`}
              disabled={busy}
              onClick={() => setCtaSplit(true)}
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
          ) : (
            <div className="home-cta-pair" role="group" aria-label="Start new report">
              <button
                type="button"
                className="btn primary big home-cta-half home-cta-import"
                disabled={busy}
                onClick={openImport}
              >
                <span className="home-btn-title">Import field notes</span>
                <span className="home-upload-meta">.DOCX ↗</span>
              </button>
              <button
                type="button"
                className="btn primary big home-cta-half home-cta-create"
                disabled={busy}
                onClick={() => {
                  setCtaSplit(false);
                  onCreateFieldNotes();
                }}
              >
                <span className="home-btn-title">Create new field notes</span>
                <span className="home-upload-meta">Camera</span>
              </button>
            </div>
          )}
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
