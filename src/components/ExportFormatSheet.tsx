import type { ExportFormat, ExportFormatOption } from "../lib/webShare";

interface Props {
  title?: string;
  options: ExportFormatOption[];
  busy?: boolean;
  onPick: (format: ExportFormat) => void;
  onClose: () => void;
}

export default function ExportFormatSheet({
  title = "Download format",
  options,
  busy = false,
  onPick,
  onClose
}: Props) {
  return (
    <div
      className="sheet-backdrop"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className="sheet export-format-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-format-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="export-format-title">{title}</h2>
        <p className="muted">Choose how you want the report saved.</p>
        <div className="export-format-list">
          {options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className="btn big export-format-option"
              disabled={busy || !opt.available}
              onClick={() => onPick(opt.id)}
            >
              <span className="export-format-label">{opt.label}</span>
              <span className="export-format-hint">{opt.hint}</span>
            </button>
          ))}
        </div>
        <div className="sheet-actions">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
