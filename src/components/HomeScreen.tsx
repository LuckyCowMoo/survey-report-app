import { useRef } from "react";

interface Props {
  onFile: (file: File) => void;
  busy: boolean;
  onShowGuide: () => void;
}

export default function HomeScreen({ onFile, busy, onShowGuide }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="home">
      <div className="home-atmosphere" aria-hidden>
        <span />
        <span />
      </div>

      <div className="home-hero">
        <div className="home-kicker">
          <span className="home-mark" aria-hidden />
          DampMaster / Report studio
        </div>
        <h2>Create<br />report.</h2>
        <p>Start with today&apos;s shorthand document.</p>
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
      <button
        className="btn primary big home-upload"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        <span>{busy ? "Reading document…" : "Import shorthand"}</span>
        <span className="home-upload-meta">{busy ? "Please wait" : ".DOCX  ↗"}</span>
      </button>

      <button className="btn home-guide-btn" onClick={onShowGuide}>
        Keyword guide
      </button>
    </div>
  );
}
