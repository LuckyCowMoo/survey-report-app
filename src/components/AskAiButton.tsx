import { useEffect, useRef, useState } from "react";
import { useT } from "../lib/i18n";

type Props = {
  configured: boolean;
  busy?: boolean;
  disabled?: boolean;
  onAsk: () => void;
  label?: string;
  className?: string;
};

/** Ask AI control — visually muted without a key, but still tappable for a hint. */
export default function AskAiButton({
  configured,
  busy = false,
  disabled = false,
  onAsk,
  label,
  className = "btn small"
}: Props) {
  const t = useT();
  const [hint, setHint] = useState(false);
  const timerRef = useRef(0);

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    },
    []
  );

  const showHint = () => {
    setHint(true);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setHint(false);
      timerRef.current = 0;
    }, 2400);
  };

  return (
    <span className="ask-ai-wrap">
      {hint && (
        <span className="card-delete-hint ask-ai-hint" role="status">
          {t("askAi.addKey")}
        </span>
      )}
      <button
        type="button"
        className={`${className}${busy ? " ai-busy" : ""}${
          configured ? "" : " is-ask-ai-muted"
        }`}
        aria-disabled={!configured || disabled || busy}
        onClick={() => {
          if (disabled || busy) return;
          if (!configured) {
            showHint();
            return;
          }
          onAsk();
        }}
      >
        {busy ? (
          <>
            <span className="ai-spinner" aria-hidden />
            {t("common.writing")}
          </>
        ) : (
          label ?? t("askAi.label")
        )}
      </button>
    </span>
  );
}
