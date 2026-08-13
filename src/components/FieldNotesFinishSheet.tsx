import SheetShell, { type SheetExitApi } from "./SheetShell";

type Props = {
  onClose: () => void;
  shotCount: number;
  busy: boolean;
  onSaveAndLeave: () => void;
  onContinueToReport: () => void;
  onExportDocx: () => void;
};

export default function FieldNotesFinishSheet({
  onClose,
  shotCount,
  busy,
  onSaveAndLeave,
  onContinueToReport,
  onExportDocx
}: Props) {
  const empty = shotCount === 0;

  return (
    <SheetShell onClose={onClose} aria-labelledby="field-notes-finish-title">
      {({ requestClose }: SheetExitApi) => (
        <>
          <div className="sheet-header">
            <h2 id="field-notes-finish-title">Finish field notes</h2>
            <button
              type="button"
              className="btn small"
              disabled={busy}
              onClick={requestClose}
            >
              Close
            </button>
          </div>
          <p className="muted field-notes-finish-summary">
            {empty
              ? "Take at least one photo before finishing."
              : `${shotCount} photo${shotCount === 1 ? "" : "s"} ready.`}
          </p>
          <div className="field-notes-finish-actions">
            <button
              type="button"
              className="btn primary big"
              disabled={busy || empty}
              onClick={onContinueToReport}
            >
              Continue to report
            </button>
            <button
              type="button"
              className="btn big"
              disabled={busy || empty}
              onClick={onSaveAndLeave}
            >
              Save and leave
            </button>
            <button
              type="button"
              className="btn big"
              disabled={busy || empty}
              onClick={onExportDocx}
            >
              Export shorthand .docx
            </button>
          </div>
        </>
      )}
    </SheetShell>
  );
}
