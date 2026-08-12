import {
  useLayoutEffect,
  useRef,
  useState,
  type TextareaHTMLAttributes
} from "react";
import { library } from "../lib/matcher";
import {
  detailsCostsBlockingReason,
  detailsCostsComplete,
  emptyAiSuggested,
  type DetailsSuggestScope,
  type IssueSuggestKey
} from "../lib/detailsSuggest";
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

function AiPickReason({ text }: { text?: string }) {
  const trimmed = text?.trim() || "Suggested from the survey wording.";
  return <p className="ai-pick-reason">{trimmed}</p>;
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
  const allBusy = suggestBusy === "all";
  const issuesError = panelHasError(suggestError, "issues");
  const recsError = panelHasError(suggestError, "recommendations");
  const costsError = panelHasError(suggestError, "costs");
  const aiSuggested = extras.aiSuggested ?? emptyAiSuggested();

  const clearIssueAi = (key: IssueSuggestKey): ReportExtras["aiSuggested"] => {
    const issueReasons = { ...aiSuggested.issueReasons };
    delete issueReasons[key];
    return {
      ...aiSuggested,
      issues: { ...aiSuggested.issues, [key]: false },
      issueReasons
    };
  };

  const toggleIssue = (key: keyof ReportExtras["dampIssues"]) => {
    const nextChecked = !extras.dampIssues[key];
    if (key === "other") {
      onExtras({
        ...extras,
        dampIssues: { ...extras.dampIssues, other: nextChecked }
      });
      return;
    }
    onExtras({
      ...extras,
      dampIssues: { ...extras.dampIssues, [key]: nextChecked },
      aiSuggested: clearIssueAi(key)
    });
  };

  const toggleRec = (id: string) => {
    const has = extras.recommendationIds.includes(id);
    const recommendationReasons = { ...aiSuggested.recommendationReasons };
    delete recommendationReasons[id];
    onExtras({
      ...extras,
      recommendationIds: has
        ? extras.recommendationIds.filter((r) => r !== id)
        : [...extras.recommendationIds, id],
      aiSuggested: {
        ...aiSuggested,
        recommendationIds: aiSuggested.recommendationIds.filter((r) => r !== id),
        recommendationReasons
      }
    });
  };

  const hasCostItem = (itemId: string) =>
    extras.costLines.some((line) => line.itemId === itemId);

  const toggleCostItem = (itemId: string) => {
    const costReasons = { ...aiSuggested.costReasons };
    delete costReasons[itemId];
    const nextAi = {
      ...aiSuggested,
      costItemIds: aiSuggested.costItemIds.filter((id) => id !== itemId),
      costReasons
    };
    if (hasCostItem(itemId)) {
      onExtras({
        ...extras,
        costLines: extras.costLines.filter((line) => line.itemId !== itemId),
        aiSuggested: nextAi
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
    onExtras({
      ...extras,
      costLines: [...extras.costLines, line],
      aiSuggested: nextAi
    });
  };

  const deselectIssues = () => {
    onExtras({
      ...extras,
      dampIssues: {
        risingDamp: false,
        penetratingDamp: false,
        condensation: false,
        other: false
      },
      aiSuggested: {
        ...aiSuggested,
        issues: {
          risingDamp: false,
          penetratingDamp: false,
          condensation: false
        },
        issueReasons: {}
      }
    });
  };

  const deselectRecommendations = () => {
    onExtras({
      ...extras,
      recommendationIds: [],
      otherRecommendation: false,
      aiSuggested: {
        ...aiSuggested,
        recommendationIds: [],
        recommendationReasons: {}
      }
    });
  };

  const deselectCosts = () => {
    onExtras({
      ...extras,
      costLines: [],
      otherCost: false,
      aiSuggested: {
        ...aiSuggested,
        costItemIds: [],
        costReasons: {}
      }
    });
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

  const removeCostLine = (id: string) => {
    const line = extras.costLines.find((l) => l.id === id);
    const costReasons = { ...aiSuggested.costReasons };
    if (line) delete costReasons[line.itemId];
    onExtras({
      ...extras,
      costLines: extras.costLines.filter((l) => l.id !== id),
      aiSuggested: line
        ? {
            ...aiSuggested,
            costItemIds: aiSuggested.costItemIds.filter((cid) => cid !== line.itemId),
            costReasons
          }
        : aiSuggested
    });
  };

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

  const costsComplete = detailsCostsComplete(extras);
  const costsBlockReason = detailsCostsBlockingReason(extras);
  const canContinue = !anyBusy && costsComplete;

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

      <div className="details-ai-toolbar">
        <button
          type="button"
          className={`btn primary details-ask-ai-all${allBusy ? " ai-busy" : ""}`}
          disabled={!aiConfigured || (anyBusy && !allBusy) || allBusy}
          title={aiConfigured ? "" : "Add your API key in Settings"}
          onClick={() => onAskAi("all")}
        >
          {allBusy ? (
            <>
              <span className="ai-spinner" aria-hidden />
              Writing…
            </>
          ) : (
            "Ask AI about all"
          )}
        </button>
      </div>

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
          <div className="details-panel-actions">
            <button
              type="button"
              className="btn small details-deselect"
              disabled={issuesBusy}
              onClick={deselectIssues}
            >
              Deselect
            </button>
            <AskAiButton
              busy={issuesBusy}
              disabled={!aiConfigured || (anyBusy && !issuesBusy)}
              onClick={() => onAskAi("issues")}
            />
          </div>
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
        <div className="details-tick-block">
          <label className="toggle">
            <input
              type="checkbox"
              className={aiSuggested.issues.risingDamp ? "ai-suggested" : undefined}
              checked={extras.dampIssues.risingDamp}
              disabled={issuesBusy}
              onChange={() => toggleIssue("risingDamp")}
            />
            <span>Rising damp</span>
          </label>
          {aiSuggested.issues.risingDamp && (
            <AiPickReason text={aiSuggested.issueReasons.risingDamp} />
          )}
        </div>
        <div className="details-tick-block">
          <label className="toggle">
            <input
              type="checkbox"
              className={
                aiSuggested.issues.penetratingDamp ? "ai-suggested" : undefined
              }
              checked={extras.dampIssues.penetratingDamp}
              disabled={issuesBusy}
              onChange={() => toggleIssue("penetratingDamp")}
            />
            <span>Penetrating damp</span>
          </label>
          {aiSuggested.issues.penetratingDamp && (
            <AiPickReason text={aiSuggested.issueReasons.penetratingDamp} />
          )}
        </div>
        <div className="details-tick-block">
          <label className="toggle">
            <input
              type="checkbox"
              className={aiSuggested.issues.condensation ? "ai-suggested" : undefined}
              checked={extras.dampIssues.condensation}
              disabled={issuesBusy}
              onChange={() => toggleIssue("condensation")}
            />
            <span>Condensation</span>
          </label>
          {aiSuggested.issues.condensation && (
            <AiPickReason text={aiSuggested.issueReasons.condensation} />
          )}
        </div>
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
          <div className="details-panel-actions">
            <button
              type="button"
              className="btn small details-deselect"
              disabled={recsBusy}
              onClick={deselectRecommendations}
            >
              Deselect
            </button>
            <AskAiButton
              busy={recsBusy}
              disabled={!aiConfigured || (anyBusy && !recsBusy)}
              onClick={() => onAskAi("recommendations")}
            />
          </div>
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
                className={
                  aiSuggested.recommendationIds.includes(r.id)
                    ? "ai-suggested"
                    : undefined
                }
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
            {aiSuggested.recommendationIds.includes(r.id) && (
              <AiPickReason text={aiSuggested.recommendationReasons[r.id]} />
            )}
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
          <div className="details-panel-actions">
            <button
              type="button"
              className="btn small details-deselect"
              disabled={costsBusy}
              onClick={deselectCosts}
            >
              Deselect
            </button>
            <AskAiButton
              busy={costsBusy}
              disabled={!aiConfigured || (anyBusy && !costsBusy)}
              onClick={() => onAskAi("costs")}
            />
          </div>
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
          <span>Areas of work (one line per room/area){extras.otherCost ? " *" : ""}</span>
          <textarea
            rows={4}
            placeholder={"Living area: all exterior walls from floor to 1.2 meters\nHallway: interior wall from floor to 1.2 meters"}
            value={extras.projectPlanLines}
            disabled={costsBusy}
            onChange={(e) => onExtras({ ...extras, projectPlanLines: e.target.value })}
          />
        </label>

        <p className="muted">
          Tick the standard cost items. Enter a price and work location for each
          selected item before generating.
        </p>
        {library.costItems.map((c) => (
          <div key={c.id} className="rec-row">
            <label className="toggle">
              <input
                type="checkbox"
                className={
                  aiSuggested.costItemIds.includes(c.id) ? "ai-suggested" : undefined
                }
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
            {aiSuggested.costItemIds.includes(c.id) && (
              <AiPickReason text={aiSuggested.costReasons[c.id]} />
            )}
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
              <span>Where / areas *</span>
              <input
                type="text"
                value={line.location ?? ""}
                placeholder="e.g. rear reception & hallway exterior walls to 1.2m"
                disabled={costsBusy}
                required
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
                £ *
                <input
                  type="text"
                  inputMode="decimal"
                  value={line.amount}
                  placeholder="0"
                  disabled={costsBusy}
                  required
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
                £ *
                <input
                  type="text"
                  inputMode="decimal"
                  value={extras.otherCostAmount}
                  placeholder="0"
                  disabled={costsBusy}
                  required
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
        {!costsComplete && costsBlockReason && (
          <p className="details-continue-hint">{costsBlockReason}</p>
        )}
        <button
          type="button"
          className="btn primary big"
          disabled={!canContinue}
          title={costsBlockReason ?? undefined}
          onClick={onContinue}
        >
          Continue to generate
        </button>
      </div>
    </div>
  );
}
