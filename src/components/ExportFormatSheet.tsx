import type { ExportFormat, ExportFormatOption } from "../lib/webShare";
import SheetShell from "./SheetShell";

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
    <SheetShell
      onClose={onClose}
      sheetClassName="sheet export-format-sheet"
      aria-labelledby="export-format-title"
      disableClose={busy}
    >
      {({ requestClose }) => (
        <>
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
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={requestClose}
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </SheetShell>
  );
}
