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
  onChange: (index: number, next: SectionState) => void;
  onAskAi: (index: number) => void;
  onAskAiAll: () => void;
  onContinue: () => void;
}

export default function ReviewScreen({
  sections,
  warnings,
  flaggedCount,
  aiConfigured,
  busy,
  busySectionIndex,
  onChange,
  onAskAi,
  onAskAiAll,
  onContinue
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
          <button
            className="btn primary"
            disabled={busy || !aiConfigured}
            title={aiConfigured ? "" : "Add your API key in Settings"}
            onClick={onAskAiAll}
          >
            Ask AI about all flagged ({flaggedCount})
          </button>
        )}
        {!aiConfigured && flaggedCount > 0 && (
          <p className="muted">
            Tip: add your Claude API key in Settings to resolve flagged
            sections automatically, or edit them by hand below.
          </p>
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
          onChange={onChange}
          onAskAi={onAskAi}
        />
      ))}

      <div className="bottom-bar">
        <button className="btn primary big" onClick={onContinue}>
          Continue to report details
        </button>
      </div>
    </div>
  );
}
