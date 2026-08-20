import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type TextareaHTMLAttributes
} from "react";
import { library } from "../lib/matcher";
import {
  costItemNeedsLocation,
  detailsCostsBlockingReason,
  detailsCostsComplete,
  detailsFirstIncompleteId,
  emptyAiSuggested,
  type DetailsSuggestScope,
  type IssueSuggestKey
} from "../lib/detailsSuggest";
import {
  bestSearchMatch,
  rankedMatches,
  selectedThenAlpha,
  type SearchableItem
} from "../lib/fuzzySearch";
import { scrollElementIntoViewCentered } from "../lib/scrollRoot";
import type { CostLine, LibraryCostItem, LibraryRecommendation, PropertyEpcSummary, ReportExtras, ReportMetadata } from "../types";
import SheetShell from "./SheetShell";
import FieldNotesFinishSheet from "./FieldNotesFinishSheet";
import PropertyAddressForm from "./PropertyAddressForm";
import PropertyEpcPanel from "./PropertyEpcPanel";
import AskAiButton from "./AskAiButton";
import { useT } from "../lib/i18n";

interface Props {
  metadata: ReportMetadata;
  extras: ReportExtras;
  onMetadata: (m: ReportMetadata) => void;
  onExtras: (e: ReportExtras) => void;
  onContinue: () => void;
  onSaveInApp: () => void;
  onExportDocx: () => void;
  onExportDmsr: () => void;
  busy?: boolean;
  aiConfigured: boolean;
  /** Which panel(s) are currently drafting. */
  suggestBusy: DetailsSuggestScope | null;
  suggestError: { scope: DetailsSuggestScope; message: string } | null;
  onAskAi: (scope: DetailsSuggestScope) => void;
  onAskCleanup: () => void;
  onDismissSuggestError: () => void;
  tutorial?: boolean;
  lockContinue?: boolean;
  epc?: PropertyEpcSummary | null;
  epcLoading?: boolean;
  epcError?: string | null;
  onRefreshEpc?: () => void;
}

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
  const t = useT();
  const trimmed = text?.trim() || t("details.aiPickFallback");
  return <p className="ai-pick-reason">{trimmed}</p>;
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
  const t = useT();
  return (
    <div className="ai-error-overlay details-ai-error-overlay" role="alert">
      <p className="ai-error-title">{title}</p>
      <p className="ai-error-message">{message}</p>
      <div className="ai-error-actions">
        <button type="button" className="btn small" onClick={onDismiss}>
          {t("common.dismiss")}
        </button>
        <button
          type="button"
          className="btn small primary"
          disabled={!aiConfigured || busy}
          onClick={onRetry}
        >
          {t("details.tryAgain")}
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
  onSaveInApp,
  onExportDocx,
  onExportDmsr,
  busy = false,
  aiConfigured,
  suggestBusy,
  suggestError,
  onAskAi,
  onAskCleanup,
  onDismissSuggestError,
  tutorial = false,
  lockContinue = false,
  epc = null,
  epcLoading = false,
  epcError = null,
  onRefreshEpc
}: Props) {
  const t = useT();
  const [recPreview, setRecPreview] = useState<string | null>(null);
  const [costPreview, setCostPreview] = useState<string | null>(null);
  const [recQuery, setRecQuery] = useState("");
  const [costQuery, setCostQuery] = useState("");
  const [incompleteOpen, setIncompleteOpen] = useState(false);
  const [showSave, setShowSave] = useState(false);

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
        woodworm: false,
        other: false
      },
      aiSuggested: {
        ...aiSuggested,
        issues: {
          risingDamp: false,
          penetratingDamp: false,
          condensation: false,
          woodworm: false
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
    (line.itemId === "custom" ? t("details.customItem") : t("details.costItem"));

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
  const canContinue = !anyBusy && !lockContinue;
  const excludePlanCosts = extras.excludePlanCosts;

  const recItems: SearchableItem[] = useMemo(
    () =>
      library.recommendations.map((r) => ({
        id: r.id,
        title: r.label,
        keywords: r.keywords,
        text: r.text
      })),
    []
  );
  const costItems: SearchableItem[] = useMemo(
    () =>
      library.costItems.map((c) => ({
        id: c.id,
        title: c.label,
        text: c.text
      })),
    []
  );

  const recsToShow = useMemo(() => {
    const q = recQuery.trim();
    if (q) return rankedMatches(recItems, q);
    return selectedThenAlpha(
      recItems,
      (item) => extras.recommendationIds.includes(item.id),
      (item) => item.title
    );
  }, [recItems, recQuery, extras.recommendationIds]);

  const costsToShow = useMemo(() => {
    const q = costQuery.trim();
    if (q) return rankedMatches(costItems, q);
    return selectedThenAlpha(
      costItems,
      (item) => hasCostItem(item.id),
      (item) => item.title
    );
  }, [costItems, costQuery, extras.costLines]);

  const bestRec = useMemo(
    () => (recQuery.trim() ? bestSearchMatch(recItems, recQuery) : null),
    [recItems, recQuery]
  );
  const bestCost = useMemo(
    () => (costQuery.trim() ? bestSearchMatch(costItems, costQuery) : null),
    [costItems, costQuery]
  );

  const recById = useMemo(() => {
    const map = new Map<string, LibraryRecommendation>();
    for (const r of library.recommendations) map.set(r.id, r);
    return map;
  }, []);
  const costById = useMemo(() => {
    const map = new Map<string, LibraryCostItem>();
    for (const c of library.costItems) map.set(c.id, c);
    return map;
  }, []);

  const jumpToIncomplete = () => {
    const id = detailsFirstIncompleteId(extras);
    setIncompleteOpen(false);
    if (!id) return;
    const el = document.getElementById(id);
    if (el) scrollElementIntoViewCentered(el);
  };

  const requestContinue = () => {
    if (tutorial || costsComplete) {
      onContinue();
      return;
    }
    setIncompleteOpen(true);
  };

  return (
    <div className="details">
      <section className="panel">
        <h2>{t("address.title")}</h2>
        <PropertyAddressForm metadata={metadata} onMetadata={onMetadata} />
        <label className="field">
          <span>{t("details.surveyDate")}</span>
          <input
            type="text"
            value={metadata.surveyDate}
            onChange={(e) => setMeta("surveyDate", e.target.value)}
          />
        </label>
        <label className="field">
          <span>{t("details.docId")}</span>
          <input
            type="text"
            value={metadata.docId}
            placeholder={t("details.docIdPlaceholder")}
            onChange={(e) => setMeta("docId", e.target.value)}
          />
        </label>
        <div className="field-row">
          <label className="field">
            <span>{t("details.weather")}</span>
            <input
              type="text"
              value={metadata.weatherDesc}
              placeholder={t("details.weatherPlaceholder")}
              onChange={(e) => setMeta("weatherDesc", e.target.value)}
            />
          </label>
          <label className="field narrow">
            <span>{t("details.temp")}</span>
            <input
              type="text"
              inputMode="decimal"
              value={metadata.temperature}
              onChange={(e) => setMeta("temperature", e.target.value)}
            />
          </label>
        </div>
        <label className="field">
          <span>{t("details.sky")}</span>
          <input
            type="text"
            value={metadata.skyDesc}
            placeholder={t("details.skyPlaceholder")}
            onChange={(e) => setMeta("skyDesc", e.target.value)}
          />
        </label>
      </section>

      <PropertyEpcPanel
        epc={epc}
        loading={epcLoading}
        error={epcError}
        onRefresh={onRefreshEpc}
      />

      <div className="details-ai-toolbar">
        <AskAiButton
          configured={aiConfigured}
          busy={allBusy}
          disabled={anyBusy && !allBusy}
          onAsk={() => onAskAi("all")}
          label={t("askAi.aboutAll")}
          className="btn primary details-ask-ai-all"
        />
      </div>

      <section
        className={`panel details-ai-panel${issuesBusy ? " ai-working" : ""}${issuesError ? " ai-error" : ""}`}
      >
        {issuesError && (
          <DetailsAiErrorOverlay
            title={t("details.issuesError")}
            message={issuesError}
            aiConfigured={aiConfigured}
            busy={anyBusy}
            onDismiss={onDismissSuggestError}
            onRetry={() => onAskAi(suggestError?.scope === "all" ? "all" : "issues")}
          />
        )}
        <div className="details-panel-head">
          <h2>{t("details.issuesTitle")}</h2>
          <div className="details-panel-actions">
            <button
              type="button"
              className="btn small details-deselect"
              disabled={issuesBusy}
              onClick={deselectIssues}
            >
              {t("details.deselect")}
            </button>
            <AskAiButton
              configured={aiConfigured}
              busy={issuesBusy}
              disabled={anyBusy && !issuesBusy}
              onAsk={() => onAskAi("issues")}
              className="btn small details-ask-ai"
            />
          </div>
        </div>
        {issuesBusy && (
          <div className="ai-writing-overlay details-ai-overlay" aria-hidden>
            <span className="ai-writing-pulse" />
            <span className="ai-writing-pulse" />
            <span className="ai-writing-pulse" />
            <span className="ai-writing-label">{t("details.draftingIssues")}</span>
          </div>
        )}
        <p className="muted">{t("details.issuesHint")}</p>
        <div className="details-tick-block">
          <label className="toggle">
            <input
              type="checkbox"
              className={aiSuggested.issues.risingDamp ? "ai-suggested" : undefined}
              checked={extras.dampIssues.risingDamp}
              disabled={issuesBusy}
              onChange={() => toggleIssue("risingDamp")}
            />
            <span>{t("details.risingDamp")}</span>
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
            <span>{t("details.penetratingDamp")}</span>
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
            <span>{t("details.condensation")}</span>
          </label>
          {aiSuggested.issues.condensation && (
            <AiPickReason text={aiSuggested.issueReasons.condensation} />
          )}
        </div>
        <div className="details-tick-block">
          <label className="toggle">
            <input
              type="checkbox"
              className={aiSuggested.issues.woodworm ? "ai-suggested" : undefined}
              checked={extras.dampIssues.woodworm}
              disabled={issuesBusy}
              onChange={() => toggleIssue("woodworm")}
            />
            <span>{t("details.woodworm")}</span>
          </label>
          {aiSuggested.issues.woodworm && (
            <AiPickReason text={aiSuggested.issueReasons.woodworm} />
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
            <span>{t("details.otherIssue")}</span>
            <textarea
              rows={4}
              placeholder={t("details.otherIssuePlaceholder")}
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
            title={t("details.recsError")}
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
          <h2>{t("details.recsTitle")}</h2>
          <div className="details-panel-actions">
            <button
              type="button"
              className="btn small details-deselect"
              disabled={recsBusy}
              onClick={deselectRecommendations}
            >
              {t("details.deselect")}
            </button>
            <AskAiButton
              configured={aiConfigured}
              busy={recsBusy}
              disabled={anyBusy && !recsBusy}
              onAsk={() => onAskAi("recommendations")}
              className="btn small details-ask-ai"
            />
          </div>
        </div>
        {recsBusy && (
          <div className="ai-writing-overlay details-ai-overlay" aria-hidden>
            <span className="ai-writing-pulse" />
            <span className="ai-writing-pulse" />
            <span className="ai-writing-pulse" />
            <span className="ai-writing-label">{t("details.draftingRecs")}</span>
          </div>
        )}
        <p className="muted">{t("details.recsHint")}</p>
        <input
          className="search details-list-search"
          type="search"
          placeholder={t("details.recsSearch")}
          value={recQuery}
          onChange={(e) => setRecQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            const pick = bestRec;
            if (!pick) return;
            if (!extras.recommendationIds.includes(pick.id)) toggleRec(pick.id);
            setRecQuery("");
          }}
        />
        {recsToShow.map((item) => {
          const r = recById.get(item.id);
          if (!r) return null;
          const highlighted = Boolean(recQuery.trim() && bestRec?.id === r.id);
          return (
          <div key={r.id} className={`rec-row${highlighted ? " is-best" : ""}`}>
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
                onChange={() => {
                  toggleRec(r.id);
                  if (recQuery.trim()) setRecQuery("");
                }}
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
            {highlighted && (
              <em className="picker-best-hint">{t("details.enterToSelect")}</em>
            )}
            {aiSuggested.recommendationIds.includes(r.id) && (
              <AiPickReason text={aiSuggested.recommendationReasons[r.id]} />
            )}
            {recPreview === r.id && <p className="rec-preview">{r.text}</p>}
          </div>
          );
        })}
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
            <span>{t("details.otherRec")}</span>
            <textarea
              rows={4}
              placeholder={t("details.otherRecPlaceholder")}
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
        id="details-plan-costs"
        className={`panel details-ai-panel${costsBusy ? " ai-working" : ""}${costsError ? " ai-error" : ""}${excludePlanCosts ? " is-plan-excluded" : ""}`}
      >
        {costsError && !excludePlanCosts && (
          <DetailsAiErrorOverlay
            title={t("details.costsError")}
            message={costsError}
            aiConfigured={aiConfigured}
            busy={anyBusy}
            onDismiss={onDismissSuggestError}
            onRetry={() => onAskAi(suggestError?.scope === "all" ? "all" : "costs")}
          />
        )}
        <div className="details-panel-head">
          <h2>{t("details.planTitle")}</h2>
          <div className="details-panel-actions">
            {!excludePlanCosts && (
              <>
                <button
                  type="button"
                  className="btn small details-deselect"
                  disabled={costsBusy}
                  onClick={deselectCosts}
                >
                  {t("details.deselect")}
                </button>
                <AskAiButton
                  configured={aiConfigured}
                  busy={costsBusy}
                  disabled={anyBusy && !costsBusy}
                  onAsk={() => onAskAi("costs")}
                  className="btn small details-ask-ai"
                />
              </>
            )}
          </div>
        </div>

        <div className="details-exclude-row">
          <button
            type="button"
            className={`pill-switch${excludePlanCosts ? " is-on" : ""}`}
            role="switch"
            aria-checked={excludePlanCosts}
            disabled={costsBusy}
            onClick={() =>
              onExtras({ ...extras, excludePlanCosts: !excludePlanCosts })
            }
          >
            <span className="pill-switch-thumb" aria-hidden />
          </button>
          <div className="details-exclude-copy">
            <span className="details-exclude-label">{t("details.excludePlan")}</span>
            <span className="details-exclude-hint">{t("details.excludeHint")}</span>
          </div>
        </div>

        {costsBusy && !excludePlanCosts && (
          <div className="ai-writing-overlay details-ai-overlay" aria-hidden>
            <span className="ai-writing-pulse" />
            <span className="ai-writing-pulse" />
            <span className="ai-writing-pulse" />
            <span className="ai-writing-label">{t("details.draftingCosts")}</span>
          </div>
        )}

        <div
          className={`details-costs-collapse${excludePlanCosts ? " is-collapsed" : ""}`}
          aria-hidden={excludePlanCosts}
        >
          <div className="details-costs-collapse-inner">
        <label className="field">
          <span>{t("details.areasOfWork")}</span>
          <textarea
            rows={4}
            placeholder={"Living area: all exterior walls from floor to 1.2 meters\nHallway: interior wall from floor to 1.2 meters"}
            value={extras.projectPlanLines}
            disabled={costsBusy || excludePlanCosts}
            onChange={(e) => onExtras({ ...extras, projectPlanLines: e.target.value })}
          />
        </label>

        <p className="muted">{t("details.costsHint")}</p>
        <input
          className="search details-list-search"
          type="search"
          placeholder={t("details.costsSearch")}
          value={costQuery}
          disabled={costsBusy || excludePlanCosts}
          onChange={(e) => setCostQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            const pick = bestCost;
            if (!pick) return;
            if (!hasCostItem(pick.id)) toggleCostItem(pick.id);
            setCostQuery("");
          }}
        />
        {costsToShow.map((item) => {
          const c = costById.get(item.id);
          if (!c) return null;
          const highlighted = Boolean(costQuery.trim() && bestCost?.id === c.id);
          return (
          <div key={c.id} className={`rec-row${highlighted ? " is-best" : ""}`}>
            <label className="toggle">
              <input
                type="checkbox"
                className={
                  aiSuggested.costItemIds.includes(c.id) ? "ai-suggested" : undefined
                }
                checked={hasCostItem(c.id)}
                disabled={costsBusy || excludePlanCosts}
                onChange={() => {
                  toggleCostItem(c.id);
                  if (costQuery.trim()) setCostQuery("");
                }}
              />
              <span>{c.label}</span>
            </label>
            <button
              className="btn tiny"
              disabled={costsBusy || excludePlanCosts}
              onClick={() => setCostPreview(costPreview === c.id ? null : c.id)}
            >
              {costPreview === c.id ? "Hide" : "View"}
            </button>
            {highlighted && (
              <em className="picker-best-hint">{t("details.enterToSelect")}</em>
            )}
            {aiSuggested.costItemIds.includes(c.id) && (
              <AiPickReason text={aiSuggested.costReasons[c.id]} />
            )}
            {costPreview === c.id && <p className="rec-preview">{c.text}</p>}
          </div>
          );
        })}
        <label className="toggle">
          <input
            type="checkbox"
            checked={extras.otherCost}
            disabled={costsBusy || excludePlanCosts}
            onChange={() => onExtras({ ...extras, otherCost: !extras.otherCost })}
          />
          <span>Other</span>
        </label>

        {extras.costLines.map((line) => (
          <div key={line.id} className="cost-line">
            <div className="cost-line-label">{costLineLabel(line)}</div>
            {costItemNeedsLocation(line.itemId) ? (
            <label className="field cost-location-field">
              <span>{t("details.whereAreas")}</span>
              <input
                id={`cost-${line.id}-location`}
                type="text"
                value={line.location ?? ""}
                placeholder={t("details.wherePlaceholder")}
                disabled={costsBusy || excludePlanCosts}
                required
                onChange={(e) =>
                  updateCostLine(line.id, { location: e.target.value })
                }
              />
            </label>
            ) : null}
            <div className="cost-standard-row">
              <button
                type="button"
                className="btn tiny"
                disabled={costsBusy || excludePlanCosts || line.itemId === "custom"}
                onClick={() => pasteStandardText(line)}
              >
                Paste standard text
              </button>
            </div>
            <AutoGrowTextarea
              value={line.description}
              placeholder={t("details.describeWork")}
              disabled={costsBusy || excludePlanCosts}
              onChange={(e) => updateCostLine(line.id, { description: e.target.value })}
            />
            <div className="cost-line-foot">
              <label>
                £ *
                <input
                  id={`cost-${line.id}-amount`}
                  type="text"
                  inputMode="decimal"
                  value={line.amount}
                  placeholder="0"
                  disabled={costsBusy || excludePlanCosts}
                  required
                  onChange={(e) => updateCostLine(line.id, { amount: e.target.value })}
                />
              </label>
              <button
                className="btn tiny danger"
                disabled={costsBusy || excludePlanCosts}
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
              placeholder={t("details.otherWork")}
              disabled={costsBusy || excludePlanCosts}
              onChange={(e) =>
                onExtras({ ...extras, otherCostDescription: e.target.value })
              }
            />
            <div className="cost-line-foot">
              <label>
                £ *
                <input
                  id="cost-other-amount"
                  type="text"
                  inputMode="decimal"
                  value={extras.otherCostAmount}
                  placeholder="0"
                  disabled={costsBusy || excludePlanCosts}
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
            {t("details.total")} <strong>£{total}</strong> {t("details.plusVat")}
          </p>
        )}

        <div className="field-row">
          <label className="field">
            <span>{t("details.surveyFee")}</span>
            <input
              type="text"
              inputMode="decimal"
              value={extras.surveyDiscount}
              disabled={costsBusy || excludePlanCosts}
              onChange={(e) => onExtras({ ...extras, surveyDiscount: e.target.value })}
            />
          </label>
          <label className="field">
            <span>{t("details.duration")}</span>
            <input
              type="text"
              value={extras.timeEstimate}
              placeholder={t("details.durationPlaceholder")}
              disabled={costsBusy || excludePlanCosts}
              onChange={(e) => onExtras({ ...extras, timeEstimate: e.target.value })}
            />
          </label>
        </div>
          </div>
        </div>
      </section>

      {!excludePlanCosts && (
        <section className="panel details-ai-panel">
          <div className="details-panel-head">
            <h2>{t("details.cleanupTitle")}</h2>
            <AskAiButton
              configured={aiConfigured}
              busy={costsBusy}
              disabled={anyBusy && !costsBusy}
              onAsk={onAskCleanup}
              className="btn small details-ask-ai"
            />
          </div>
          <p className="muted">{t("details.cleanupHint")}</p>
          <label className="field">
            <span className="visually-hidden">{t("details.cleanupTitle")}</span>
            <textarea
              rows={6}
              placeholder={t("details.cleanupPlaceholder")}
              value={extras.postProjectCleanup}
              disabled={costsBusy}
              onChange={(e) =>
                onExtras({ ...extras, postProjectCleanup: e.target.value })
              }
            />
          </label>
        </section>
      )}

      <section className="panel">
        <div className="details-exclude-row">
          <button
            type="button"
            className={`pill-switch${extras.invasiveSurvey ? " is-on" : ""}`}
            role="switch"
            aria-checked={extras.invasiveSurvey}
            onClick={() =>
              onExtras({ ...extras, invasiveSurvey: !extras.invasiveSurvey })
            }
          >
            <span className="pill-switch-thumb" aria-hidden />
          </button>
          <div className="details-exclude-copy">
            <span className="details-exclude-label">
              {extras.invasiveSurvey
                ? t("details.invasiveOn")
                : t("details.invasiveOff")}
            </span>
            <span className="details-exclude-hint">
              {extras.invasiveSurvey
                ? t("details.invasiveOnHint")
                : t("details.invasiveOffHint")}
            </span>
          </div>
        </div>
      </section>

      <div className="details-save-leave">
        <button
          type="button"
          className="btn big"
          disabled={busy || tutorial}
          onClick={() => {
            if (tutorial) return;
            setShowSave(true);
          }}
        >
          {t("finish.saveLeave")}
        </button>
      </div>

      {incompleteOpen && costsBlockReason && (
        <SheetShell
          onClose={() => setIncompleteOpen(false)}
          aria-labelledby="details-incomplete-title"
        >
          {({ requestClose }) => (
            <>
              <h2 id="details-incomplete-title">{t("details.incompleteTitle")}</h2>
              <p className="muted">{costsBlockReason}</p>
              <p className="muted">{t("details.incompleteBody")}</p>
              <div className="sheet-actions">
                <button type="button" className="btn" onClick={jumpToIncomplete}>
                  {t("details.goToIssue")}
                </button>
                <button type="button" className="btn" onClick={requestClose}>
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => {
                    requestClose();
                    onContinue();
                  }}
                >
                  {t("details.ignoreGenerate")}
                </button>
              </div>
            </>
          )}
        </SheetShell>
      )}

      {showSave && (
        <FieldNotesFinishSheet
          busy={busy}
          summary={t("finish.detailsSummary")}
          onClose={() => setShowSave(false)}
          onSaveInApp={() => {
            setShowSave(false);
            onSaveInApp();
          }}
          onExportDocx={() => {
            setShowSave(false);
            onExportDocx();
          }}
          onExportDmsr={() => {
            setShowSave(false);
            onExportDmsr();
          }}
        />
      )}

      <div className="bottom-bar">
        <button
          type="button"
          className="btn primary big"
          disabled={!canContinue}
          onClick={requestContinue}
        >
          {t("details.continueGenerate")}
        </button>
      </div>
    </div>
  );
}
