import { REVIEW_PIP_LEGEND } from "../lib/pipLegend";
import type { CoachSpec } from "../lib/tutorial/flow";

type Props = {
  spec: CoachSpec;
  onNext?: () => void;
  onSkip?: () => void;
  onFinish?: () => void;
};

export default function TutorialCoach({ spec, onNext, onSkip, onFinish }: Props) {
  if (!spec.body && !spec.kicker && !spec.nextLabel) return null;
  return (
    <div className={`tutorial-coach placement-${spec.placement}`}>
      <div className="tutorial-coach-card">
        {spec.kicker ? <p className="tutorial-coach-kicker">{spec.kicker}</p> : null}
        {spec.body
          ? spec.body.split("\n").map((line, i) => (
              <p key={i} className="tutorial-coach-body">
                {line ? renderCoachLine(line) : "\u00a0"}
              </p>
            ))
          : null}
        {spec.showPipLegend ? (
          <ul className="guide-pip-legend tutorial-pip-legend">
            {REVIEW_PIP_LEGEND.map((p) => (
              <li key={p.tone}>
                <span className={`guide-pip-swatch tone-${p.tone}`} aria-hidden />
                <span>
                  <strong>{p.label}</strong> — {p.meaning}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {spec.showSwipeHint ? (
          <div className="tutorial-swipe-ghost" aria-hidden>
            <span className="tutorial-swipe-finger" />
          </div>
        ) : null}
        {(spec.nextLabel || spec.skipLabel || spec.finishLabel) && (
          <div className="tutorial-coach-actions">
            {spec.skipLabel ? (
              <button type="button" className="btn" onClick={onSkip}>
                {spec.skipLabel}
              </button>
            ) : null}
            {spec.nextLabel ? (
              <button type="button" className="btn primary" onClick={onNext}>
                {spec.nextLabel}
              </button>
            ) : null}
            {spec.finishLabel ? (
              <button type="button" className="btn primary" onClick={onFinish}>
                {spec.finishLabel}
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function renderCoachLine(line: string) {
  const parts = line.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    const marked = part.match(/^\*\*([^*]+)\*\*$/);
    if (marked) {
      return (
        <span key={i} className="tutorial-coach-action">
          {marked[1]}
        </span>
      );
    }
    return part;
  });
}
