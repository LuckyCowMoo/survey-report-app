import SheetShell, { type SheetExitApi } from "./SheetShell";

type Props = {
  onClose: () => void;
  shotCount: number;
  busy: boolean;
  onSaveInApp: () => void;
  onExportDocx: () => void;
};

/** Save options — both paths persist an in-app draft; export also downloads .docx. */
export default function FieldNotesFinishSheet({
  onClose,
  shotCount,
  busy,
  onSaveInApp,
  onExportDocx
}: Props) {
  const empty = shotCount === 0;

  return (
    <SheetShell onClose={onClose} aria-labelledby="field-notes-save-title">
      {({ requestClose }: SheetExitApi) => (
        <>
          <div className="sheet-header">
            <h2 id="field-notes-save-title">Save & leave</h2>
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
              ? "Take at least one photo before saving."
              : `${shotCount} photo${shotCount === 1 ? "" : "s"} will be saved in the app.`}
          </p>
          <div className="field-notes-finish-actions">
            <button
              type="button"
              className="btn primary big"
              disabled={busy || empty}
              onClick={onSaveInApp}
            >
              Save in app & leave
            </button>
            <button
              type="button"
              className="btn big"
              disabled={busy || empty}
              onClick={onExportDocx}
            >
              Export .docx & leave
            </button>
          </div>
        </>
      )}
    </SheetShell>
  );
}
