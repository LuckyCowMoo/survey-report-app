import SheetShell, { type SheetExitApi } from "./SheetShell";

type Props = {
  onClose: () => void;
  busy: boolean;
  title?: string;
  summary: string;
  /** When true, export/save actions are disabled (e.g. no photos yet). */
  actionsDisabled?: boolean;
  /** Omit to hide “Save in app”. */
  onSaveInApp?: () => void;
  onExportDocx: () => void;
  onExportDmsr: () => void;
  docxDisabled?: boolean;
  dmsrDisabled?: boolean;
  /** Append “ & leave” to action labels. */
  leave?: boolean;
};

/** Save / export options — in-app draft, Word shorthand, and reopenable .dmsr. */
export default function FieldNotesFinishSheet({
  onClose,
  busy,
  title = "Save & leave",
  summary,
  actionsDisabled = false,
  onSaveInApp,
  onExportDocx,
  onExportDmsr,
  docxDisabled = false,
  dmsrDisabled = false,
  leave = true
}: Props) {
  const suffix = leave ? " & leave" : "";
  const blocked = busy || actionsDisabled;

  return (
    <SheetShell onClose={onClose} aria-labelledby="field-notes-save-title">
      {({ requestClose }: SheetExitApi) => (
        <>
          <div className="sheet-header">
            <h2 id="field-notes-save-title">{title}</h2>
            <button
              type="button"
              className="btn small"
              disabled={busy}
              onClick={requestClose}
            >
              Close
            </button>
          </div>
          <p className="muted field-notes-finish-summary">{summary}</p>
          <div className="field-notes-finish-actions">
            {onSaveInApp ? (
              <button
                type="button"
                className="btn primary big"
                disabled={blocked}
                onClick={onSaveInApp}
              >
                {`Save in app${suffix}`}
              </button>
            ) : null}
            <button
              type="button"
              className="btn big"
              disabled={blocked || docxDisabled}
              onClick={onExportDocx}
            >
              {`Export .docx${suffix}`}
            </button>
            <button
              type="button"
              className="btn big"
              disabled={blocked || dmsrDisabled}
              onClick={onExportDmsr}
            >
              {`Export .dmsr${suffix}`}
            </button>
          </div>
        </>
      )}
    </SheetShell>
  );
}
