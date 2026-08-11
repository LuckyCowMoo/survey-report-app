import {
  useLayoutEffect,
  useRef,
  useState,
  type TextareaHTMLAttributes
} from "react";
import { library } from "../lib/matcher";
import type { DetailsSuggestScope } from "../lib/detailsSuggest";
import type { CostLine, ReportExtras, ReportMetadata } from "../types";

interface Props {
  metadata: ReportMetadata;
  extras: ReportExtras;
  onMetadata: (m: ReportMetadata) => void;
  onExtras: (e: ReportExtras) => void;
  onContinue: () => void;
  aiConfigured: boolean;
  /** Which panel(s) are currently drafting. */
  suggestBusy: DetailsSuggestScope | null;
  suggestError: { scope: DetailsSuggestScope; message: string } | null;
  onAskAi: (scope: DetailsSuggestScope) => void;
  onDismissSuggestError: () => void;
}

const PROPERTY_TYPES = [
  "end-of-terrace dwelling",
  "mid-terrace dwelling",
  "detached dwelling",
  "semi-detached dwelling",
  "flat/apartment",
  "commercial premises",
  "hotel"
];

let costIdCounter = 1;

/** Textarea that grows to fit its full content (used for selected cost items). */
function AutoGrowTextarea({
  value,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return <textarea ref={ref} value={value} rows={1} {...rest} />;
}

function AskAiButton({
  busy,
  disabled,
  onClick,
  label = "Ask AI"
}: {
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      className={`btn small details-ask-ai${busy ? " ai-busy" : ""}`}
      disabled={disabled || busy}
      onClick={onClick}
    >
      {busy ? (
        <>
          <span className="ai-spinner" aria-hidden />
          Writing…
        </>
      ) : (
        label
      )}
    </button>
  );
}

function DetailsAiErrorOverlay({
  title,
  message,
  aiConfigured,
  busy,
  onDismiss,
  onRetry
}: {
  title: string;
  message: string;
  aiConfigured: boolean;
  busy: boolean;
  onDismiss: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="ai-error-overlay details-ai-error-overlay" role="alert">
      <p className="ai-error-title">{title}</p>
      <p className="ai-error-message">{message}</p>
      <div className="ai-error-actions">
        <button type="button" className="btn small" onClick={onDismiss}>
          Dismiss
        </button>
        <button
          type="button"
          className="btn small primary"
          disabled={!aiConfigured || busy}
          onClick={onRetry}
        >
          Try again
        </button>
      </div>
    </div>
  );
}

function panelBusy(
  suggestBusy: DetailsSuggestScope | null,
  scope: Exclude<DetailsSuggestScope, "all">
): boolean {
  return suggestBusy === "all" || suggestBusy === scope;
}

function panelHasError(
  suggestError: { scope: DetailsSuggestScope; message: string } | null,
  scope: Exclude<DetailsSuggestScope, "all">
): string | null {
  if (!suggestError) return null;
  if (suggestError.scope === "all" || suggestError.scope === scope) {
    return suggestError.message;
  }
  return null;
}

export default function DetailsScreen({
  metadata,
  extras,
  onMetadata,
  onExtras,
  onContinue,
  aiConfigured,
  suggestBusy,
  suggestError,
  onAskAi,
  onDismissSuggestError
}: Props) {
  const [recPreview, setRecPreview] = useState<string | null>(null);
  const [costPreview, setCostPreview] = useState<string | null>(null);

  const setMeta = <K extends keyof ReportMetadata>(key: K, value: ReportMetadata[K]) =>
    onMetadata({ ...metadata, [key]: value });

  const issuesBusy = panelBusy(suggestBusy, "issues");
  const recsBusy = panelBusy(suggestBusy, "recommendations");
  const costsBusy = panelBusy(suggestBusy, "costs");
  const anyBusy = suggestBusy !== null;
  const issuesError = panelHasError(suggestError, "issues");
  const recsError = panelHasError(suggestError, "recommendations");
  const costsError = panelHasError(suggestError, "costs");

  const toggleIssue = (key: keyof ReportExtras["dampIssues"]) =>
    onExtras({
      ...extras,
      dampIssues: { ...extras.dampIssues, [key]: !extras.dampIssues[key] }
    });

  const toggleRec = (id: string) => {
    const has = extras.recommendationIds.includes(id);
    onExtras({
      ...extras,
      recommendationIds: has
        ? extras.recommendationIds.filter((r) => r !== id)
        : [...extras.recommendationIds, id]
    });
  };

  const hasCostItem = (itemId: string) =>
    extras.costLines.some((line) => line.itemId === itemId);

  const toggleCostItem = (itemId: string) => {
    if (hasCostItem(itemId)) {
      onExtras({
        ...extras,
        costLines: extras.costLines.filter((line) => line.itemId !== itemId)
      });
      return;
    }
    const item = library.costItems.find((c) => c.id === itemId);
    if (!item) return;
    const line: CostLine = {
      id: `cost-${costIdCounter++}`,
      itemId: item.id,
      label: item.label,
      description: item.text,
      amount: "",
      location: ""
    };
    onExtras({ ...extras, costLines: [...extras.costLines, line] });
  };

  const costLineLabel = (line: CostLine) =>
    line.label ||
    library.costItems.find((c) => c.id === line.itemId)?.label ||
    (line.itemId === "custom" ? "Custom item" : "Cost item");

  const updateCostLine = (id: string, patch: Partial<CostLine>) =>
    onExtras({
      ...extras,
      costLines: extras.costLines.map((l) => (l.id === id ? { ...l, ...patch } : l))
    });

  const removeCostLine = (id: string) =>
    onExtras({ ...extras, costLines: extras.costLines.filter((l) => l.id !== id) });

  const pasteStandardText = (line: CostLine) => {
    const item = library.costItems.find((c) => c.id === line.itemId);
    if (!item) return;
    updateCostLine(line.id, { description: item.text });
  };

  const total = [
    ...extras.costLines,
    ...(extras.otherCost
      ? [{ amount: extras.otherCostAmount } as Pick<CostLine, "amount">]
      : [])
  ].reduce((sum, l) => {
    const n = Number(l.amount.replace(/[£,\s]/g, ""));
    return Number.isFinite(n) ? sum + n : sum;
  }, 0);

  return (
    <div className="details">
      <section className="panel">
        <h2>Property & survey</h2>
        <label className="field">
          <span>Property address</span>
          <input
            type="text"
            value={metadata.propertyAddress}
            placeholder="9 Example Road, Cardiff, CF24 ..."
            onChange={(e) => setMeta("propertyAddress", e.target.value)}
          />
        </label>
        <label className="field">
          <span>Client name</span>
          <input
            type="text"
            value={metadata.clientName}
            onChange={(e) => setMeta("clientName", e.target.value)}
          />
        </label>
        <label className="field">
          <span>Contact (page header)</span>
          <input
            type="text"
            value={metadata.contactName}
            placeholder="Property / client contact"
            onChange={(e) => setMeta("contactName", e.target.value)}
          />
        </label>
        <div className="field-row">
          <label className="field">
            <span>Phone (page header)</span>
            <input
              type="tel"
              value={metadata.phone}
              onChange={(e) => setMeta("phone", e.target.value)}
            />
          </label>
          <label className="field">
            <span>Email (page header)</span>
            <input
              type="email"
              value={metadata.email}
              onChange={(e) => setMeta("email", e.target.value)}
            />
          </label>
        </div>
        <label className="field">
          <span>Property type</span>
          <select
            value={metadata.propertyType}
            onChange={(e) => setMeta("propertyType", e.target.value)}
          >
            {PROPERTY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Survey date</span>
          <input
            type="text"
            value={metadata.surveyDate}
            onChange={(e) => setMeta("surveyDate", e.target.value)}
          />
        </label>
        <label className="field">
          <span>Document id (footer, optional)</span>
          <input
            type="text"
            value={metadata.docId}
            placeholder="112.1"
            onChange={(e) => setMeta("docId", e.target.value)}
          />
        </label>
        <div className="field-row">
          <label className="field">
            <span>Weather</span>
            <input
              type="text"
              value={metadata.weatherDesc}
              placeholder="dry conditions"
              onChange={(e) => setMeta("weatherDesc", e.target.value)}
            />
          </label>
          <label className="field narrow">
            <span>Temp (°C)</span>
            <input
              type="text"
              inputMode="decimal"
              value={metadata.temperature}
              onChange={(e) => setMeta("temperature", e.target.value)}
            />
          </label>
        </div>
        <label className="field">
          <span>Sky</span>
          <input
            type="text"
            value={metadata.skyDesc}
            placeholder="intermittent cloud cover"
            onChange={(e) => setMeta("skyDesc", e.target.value)}
          />
        </label>
      </section>

      <section
        className={`panel details-ai-panel${issuesBusy ? " ai-working" : ""}${issuesError ? " ai-error" : ""}`}
      >
        {issuesError && (
          <DetailsAiErrorOverlay
            title="AI couldn’t finish issues"
            message={issuesError}
            aiConfigured={aiConfigured}
            busy={anyBusy}
            onDismiss={onDismissSuggestError}
            onRetry={() => onAskAi(suggestError?.scope === "all" ? "all" : "issues")}
          />
        )}
        <div className="details-panel-head">
          <h2>Issues found at this property</h2>
          <AskAiButton
            busy={issuesBusy}
            disabled={!aiConfigured || (anyBusy && !issuesBusy)}
            onClick={() => onAskAi("issues")}
          />
        </div>
        {issuesBusy && (
          <div className="ai-writing-overlay details-ai-overlay" aria-hidden>
            <span className="ai-writing-pulse" />
            <span className="ai-writing-pulse" />
            <span className="ai-writing-pulse" />
            <span className="ai-writing-label">Drafting issues…</span>
          </div>
        )}
        <p className="muted">Tick the damp issues identified on site.</p>
        <label className="toggle">
          <input
            type="checkbox"
            checked={extras.dampIssues.risingDamp}
            disabled={issuesBusy}
            onChange={() => toggleIssue("risingDamp")}
          />
          <span>Rising damp</span>
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={extras.dampIssues.penetratingDamp}
            disabled={issuesBusy}
            onChange={() => toggleIssue("penetratingDamp")}
          />
          <span>Penetrating damp</span>
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={extras.dampIssues.condensation}
            disabled={issuesBusy}
            onChange={() => toggleIssue("condensation")}
          />
          <span>Condensation</span>
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={extras.dampIssues.other}
            disabled={issuesBusy}
            onChange={() => toggleIssue("other")}
          />
          <span>Other</span>
        </label>
        {extras.dampIssues.other && (
          <label className="field">
            <span>Describe the other issue</span>
            <textarea
              rows={4}
              placeholder="Explain the issue and wording for the report…"
              value={extras.otherIssueText}
              disabled={issuesBusy}
              onChange={(e) => onExtras({ ...extras, otherIssueText: e.target.value })}
            />
          </label>
        )}
      </section>

      <section
        className={`panel details-ai-panel${recsBusy ? " ai-working" : ""}${recsError ? " ai-error" : ""}`}
      >
        {recsError && (
          <DetailsAiErrorOverlay
            title="AI couldn’t finish recommendations"
            message={recsError}
            aiConfigured={aiConfigured}
            busy={anyBusy}
            onDismiss={onDismissSuggestError}
            onRetry={() =>
              onAskAi(suggestError?.scope === "all" ? "all" : "recommendations")
            }
          />
        )}
        <div className="details-panel-head">
          <h2>Recommendations</h2>
          <AskAiButton
            busy={recsBusy}
            disabled={!aiConfigured || (anyBusy && !recsBusy)}
            onClick={() => onAskAi("recommendations")}
          />
        </div>
        {recsBusy && (
          <div className="ai-writing-overlay details-ai-overlay" aria-hidden>
            <span className="ai-writing-pulse" />
            <span className="ai-writing-pulse" />
            <span className="ai-writing-pulse" />
            <span className="ai-writing-label">Drafting recommendations…</span>
          </div>
        )}
        <p className="muted">Tick the standard recommendations to include.</p>
        {library.recommendations.map((r) => (
          <div key={r.id} className="rec-row">
            <label className="toggle">
              <input
                type="checkbox"
                checked={extras.recommendationIds.includes(r.id)}
                disabled={recsBusy}
                onChange={() => toggleRec(r.id)}
              />
              <span>{r.label}</span>
            </label>
            <button
              className="btn tiny"
              disabled={recsBusy}
              onClick={() => setRecPreview(recPreview === r.id ? null : r.id)}
            >
              {recPreview === r.id ? "Hide" : "View"}
            </button>
            {recPreview === r.id && <p className="rec-preview">{r.text}</p>}
          </div>
        ))}
        <label className="toggle">
          <input
            type="checkbox"
            checked={extras.otherRecommendation}
            disabled={recsBusy}
            onChange={() =>
              onExtras({ ...extras, otherRecommendation: !extras.otherRecommendation })
            }
          />
          <span>Other</span>
        </label>
        {extras.otherRecommendation && (
          <label className="field">
            <span>Other recommendation</span>
            <textarea
              rows={4}
              placeholder="Write the recommendation wording for the report…"
              value={extras.otherRecommendationText}
              disabled={recsBusy}
              onChange={(e) =>
                onExtras({ ...extras, otherRecommendationText: e.target.value })
              }
            />
          </label>
        )}
      </section>

      <section
        className={`panel details-ai-panel${costsBusy ? " ai-working" : ""}${costsError ? " ai-error" : ""}`}
      >
        {costsError && (
          <DetailsAiErrorOverlay
            title="AI couldn’t finish project plan & costs"
            message={costsError}
            aiConfigured={aiConfigured}
            busy={anyBusy}
            onDismiss={onDismissSuggestError}
            onRetry={() => onAskAi(suggestError?.scope === "all" ? "all" : "costs")}
          />
        )}
        <div className="details-panel-head">
          <h2>Project plan & costs</h2>
          <AskAiButton
            busy={costsBusy}
            disabled={!aiConfigured || (anyBusy && !costsBusy)}
            onClick={() => onAskAi("costs")}
          />
        </div>
        {costsBusy && (
          <div className="ai-writing-overlay details-ai-overlay" aria-hidden>
            <span className="ai-writing-pulse" />
            <span className="ai-writing-pulse" />
            <span className="ai-writing-pulse" />
            <span className="ai-writing-label">Drafting costs…</span>
          </div>
        )}
        <label className="field">
          <span>Areas of work (one line per room/area)</span>
          <textarea
            rows={4}
            placeholder={"Living area: all exterior walls from floor to 1.2 meters\nHallway: interior wall from floor to 1.2 meters"}
            value={extras.projectPlanLines}
            disabled={costsBusy}
            onChange={(e) => onExtras({ ...extras, projectPlanLines: e.target.value })}
          />
        </label>

        <p className="muted">
          Tick the standard cost items. Use the location box when work is limited
          to specific rooms or elevations — standard wording is pasted for you.
        </p>
        {library.costItems.map((c) => (
          <div key={c.id} className="rec-row">
            <label className="toggle">
              <input
                type="checkbox"
                checked={hasCostItem(c.id)}
                disabled={costsBusy}
                onChange={() => toggleCostItem(c.id)}
              />
              <span>{c.label}</span>
            </label>
            <button
              className="btn tiny"
              disabled={costsBusy}
              onClick={() => setCostPreview(costPreview === c.id ? null : c.id)}
            >
              {costPreview === c.id ? "Hide" : "View"}
            </button>
            {costPreview === c.id && <p className="rec-preview">{c.text}</p>}
          </div>
        ))}
        <label className="toggle">
          <input
            type="checkbox"
            checked={extras.otherCost}
            disabled={costsBusy}
            onChange={() => onExtras({ ...extras, otherCost: !extras.otherCost })}
          />
          <span>Other</span>
        </label>

        {extras.costLines.map((line) => (
          <div key={line.id} className="cost-line">
            <div className="cost-line-label">{costLineLabel(line)}</div>
            <label className="field cost-location-field">
              <span>Where / areas (optional)</span>
              <input
                type="text"
                value={line.location ?? ""}
                placeholder="e.g. rear reception & hallway exterior walls to 1.2m"
                disabled={costsBusy}
                onChange={(e) =>
                  updateCostLine(line.id, { location: e.target.value })
                }
              />
            </label>
            <div className="cost-standard-row">
              <button
                type="button"
                className="btn tiny"
                disabled={costsBusy || line.itemId === "custom"}
                onClick={() => pasteStandardText(line)}
              >
                Paste standard text
              </button>
            </div>
            <AutoGrowTextarea
              value={line.description}
              placeholder="Describe the work item..."
              disabled={costsBusy}
              onChange={(e) => updateCostLine(line.id, { description: e.target.value })}
            />
            <div className="cost-line-foot">
              <label>
                £
                <input
                  type="text"
                  inputMode="decimal"
                  value={line.amount}
                  placeholder="0"
                  disabled={costsBusy}
                  onChange={(e) => updateCostLine(line.id, { amount: e.target.value })}
                />
              </label>
              <button
                className="btn tiny danger"
                disabled={costsBusy}
                onClick={() => removeCostLine(line.id)}
              >
                Remove
              </button>
            </div>
          </div>
        ))}

        {extras.otherCost && (
          <div className="cost-line">
            <div className="cost-line-label">Other</div>
            <AutoGrowTextarea
              value={extras.otherCostDescription}
              placeholder="Describe the other work item..."
              disabled={costsBusy}
              onChange={(e) =>
                onExtras({ ...extras, otherCostDescription: e.target.value })
              }
            />
            <div className="cost-line-foot">
              <label>
                £
                <input
                  type="text"
                  inputMode="decimal"
                  value={extras.otherCostAmount}
                  placeholder="0"
                  disabled={costsBusy}
                  onChange={(e) =>
                    onExtras({ ...extras, otherCostAmount: e.target.value })
                  }
                />
              </label>
            </div>
          </div>
        )}

        {(extras.costLines.length > 0 || extras.otherCost) && (
          <p className="total">
            Total: <strong>£{total}</strong> + VAT
          </p>
        )}

        <div className="field-row">
          <label className="field">
            <span>Survey fee refunded if work goes ahead (£)</span>
            <input
              type="text"
              inputMode="decimal"
              value={extras.surveyDiscount}
              disabled={costsBusy}
              onChange={(e) => onExtras({ ...extras, surveyDiscount: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Estimated duration</span>
            <input
              type="text"
              value={extras.timeEstimate}
              placeholder="5-7 days"
              disabled={costsBusy}
              onChange={(e) => onExtras({ ...extras, timeEstimate: e.target.value })}
            />
          </label>
        </div>
      </section>

      <div className="bottom-bar">
        <button
          className="btn primary big"
          disabled={anyBusy}
          onClick={onContinue}
        >
          Continue to generate
        </button>
      </div>
    </div>
  );
}
