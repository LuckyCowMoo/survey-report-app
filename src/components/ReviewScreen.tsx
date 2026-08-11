import { useMemo, useState } from "react";
import EntryCard from "./EntryCard";
import type { SectionState } from "../types";

interface Props {
  sections: SectionState[];
  warnings: string[];
  flaggedCount: number;
  aiConfigured: boolean;
  busy: boolean;
  busySectionIndex: number | null;
  aiErrors: Record<number, string>;
  onChange: (index: number, next: SectionState) => void;
  onAskAi: (index: number) => void;
  onAskAiAll: () => void;
  onStopAiBatch: () => void;
  aiBatchRunning: boolean;
  onDismissAiError: (index: number) => void;
  onContinue: () => void;
  onSaveAndLeave: () => void;
  saveAndLeaveBusy?: boolean;
  onFocusSection: (index: number) => void;
  focusedSectionIndex: number | null;
  /** Section index currently running the review dwell fill, if any. */
  dwellSectionIndex: number | null;
}

export default function ReviewScreen({
  sections,
  warnings,
  flaggedCount,
  aiConfigured,
  busy,
  busySectionIndex,
  aiErrors,
  onChange,
  onAskAi,
  onAskAiAll,
  onStopAiBatch,
  aiBatchRunning,
  onDismissAiError,
  onContinue,
  onSaveAndLeave,
  saveAndLeaveBusy = false,
  onFocusSection,
  focusedSectionIndex,
  dwellSectionIndex
}: Props) {
  const [showWarnings, setShowWarnings] = useState(false);
  const sectionNumbers = useMemo(
    () => sections.map((s) => s.entry.number),
    [sections]
  );

  return (
    <div className="review">
      <div className="review-summary">
        <p>
          <strong>{sections.length}</strong> photo sections found
          {flaggedCount > 0 ? (
            <>
              , <strong>{flaggedCount}</strong> need attention
            </>
          ) : (
            " - all matched"
          )}
          .
        </p>
        {flaggedCount > 0 && (
          aiBatchRunning ? (
            <button type="button" className="btn danger" onClick={onStopAiBatch}>
              Stop AI
            </button>
          ) : (
            <button
              className="btn primary"
              disabled={busy || !aiConfigured}
              title={aiConfigured ? "" : "Add your API key in Settings"}
              onClick={onAskAiAll}
            >
              Ask AI about all flagged ({flaggedCount})
            </button>
          )
        )}
        {warnings.length > 0 && (
          <button className="btn small" onClick={() => setShowWarnings(!showWarnings)}>
            {showWarnings ? "Hide" : "Show"} {warnings.length} parsing warning(s)
          </button>
        )}
        {showWarnings && (
          <ul className="warnings">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
      </div>

      {sections.map((s, i) => (
        <EntryCard
          key={s.entry.number}
          section={s}
          index={i}
          sectionNumbers={sectionNumbers}
          aiConfigured={aiConfigured}
          busy={busy}
          aiWorking={busySectionIndex === i}
          aiError={aiErrors[i] ?? null}
          focused={focusedSectionIndex === i}
          dwelling={dwellSectionIndex === i}
          onChange={onChange}
          onAskAi={onAskAi}
          onDismissAiError={onDismissAiError}
          onActivate={onFocusSection}
        />
      ))}

      <div className="bottom-bar">
        <button
          type="button"
          className="btn big"
          disabled={busy || saveAndLeaveBusy || aiBatchRunning}
          onClick={onSaveAndLeave}
        >
          {saveAndLeaveBusy ? "Saving…" : "Save & leave"}
        </button>
        <button
          type="button"
          className="btn primary big"
          disabled={busy || saveAndLeaveBusy}
          onClick={onContinue}
        >
          Continue to report details
        </button>
      </div>
    </div>
  );
}
