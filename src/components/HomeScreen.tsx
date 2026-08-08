import { useRef } from "react";

interface Props {
  onFile: (file: File) => void;
  busy: boolean;
}

export default function HomeScreen({ onFile, busy }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="home">
      <div className="home-hero">
        <div className="home-logo" aria-hidden>
          <svg viewBox="0 0 100 100" width="72" height="72">
            <path
              d="M50 8 C50 8 20 44 20 64 a30 30 0 0 0 60 0 C80 44 50 8 50 8 Z"
              fill="currentColor"
            />
          </svg>
        </div>
        <h2>Damp Survey Report Generator</h2>
        <p>
          Choose the shorthand survey document from your Files. The app reads
          the photos and notes, matches them to your standard wording, and
          builds the finished report - all on this device.
        </p>
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
        className="btn primary big"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? "Reading..." : "Choose shorthand document"}
      </button>

      <ol className="home-steps">
        <li>Pick the shorthand .docx you made on site</li>
        <li>Review the suggested wording for each photo</li>
        <li>Fill in the property details, recommendations and costs</li>
        <li>Generate and share the finished .docx report</li>
      </ol>
    </div>
  );
}
