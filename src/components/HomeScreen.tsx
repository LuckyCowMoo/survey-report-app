import { useEffect, useRef, type MutableRefObject } from "react";
import FloatingReports from "./FloatingReports";
import { IconBook, IconSettings } from "./icons";

interface Props {
  onFile: (file: File) => void;
  busy: boolean;
  onShowGuide: () => void;
  onShowSettings: () => void;
  /** Lets the app trigger Import (e.g. browser/mouse forward on the home page). */
  importTriggerRef?: MutableRefObject<(() => void) | null>;
}

export default function HomeScreen({
  onFile,
  busy,
  onShowGuide,
  onShowSettings,
  importTriggerRef
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

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

  return (
    <div className="home">
      <FloatingReports />

      <div className="home-hero">
        <div className="home-kicker">
          <span className="home-mark" aria-hidden />
          DampMaster / Report studio
        </div>
        <h2>Create<br />report.</h2>
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
        <button
          className={`btn primary big home-upload${busy ? " is-busy" : ""}`}
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          <span className="home-btn-label">
            <span className="home-btn-title">
              {busy ? "Reading document…" : "Import field notes"}
            </span>
            <span className="home-upload-meta">{busy ? "Please wait" : ".DOCX  ↗"}</span>
          </span>
        </button>

        <div className="home-secondary-actions">
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
