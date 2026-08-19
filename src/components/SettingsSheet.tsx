import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  applyApiKey,
  ensureProviderModels,
  providerApiKey,
  setActiveProvider,
  type AppSettings
} from "../lib/settings";
import {
  AI_PROVIDER_ORDER,
  AI_PROVIDERS,
  defaultsForProvider,
  type AiProvider
} from "../lib/aiProviders";
import {
  listProviderModels,
  resolveRatesForProviderModel,
  type AiModelOption
} from "../lib/aiModels";
import {
  COST_SCENARIO_SECTION_COUNT,
  estimateDetailsUsd,
  estimateReportScenarioUsd,
  estimateSectionsUsd,
  formatGbpFromUsd,
  formatUsdRates
} from "../lib/aiCostEstimate";
import { usePointerInputModeValue } from "../lib/pointerInput";
import {
  canLinkReportFolder,
  getLinkedFolderName,
  linkReportFolder,
  unlinkReportFolder
} from "../lib/reportLibrary";
import ThemePicker from "./ThemeToggle";
import CountryLanguageGrid from "./CountryLanguageGrid";
import SheetShell from "./SheetShell";
import { canCallOpenAiFromBrowser } from "../lib/openaiBrowserCompat";
import { useT, setUiLanguage, useUiLanguage } from "../lib/i18n";
import { applyTextScale, TEXT_SCALE_MAX, TEXT_SCALE_MIN } from "../lib/textScale";

interface Props {
  settings: AppSettings;
  /** Persist settings (called automatically when the sheet closes). */
  onSave: (next: AppSettings) => void;
  onClose: () => void;
  /** Scroll to / highlight name, company, and website when opened from generate. */
  focusIdentity?: boolean;
}

function normalizeSettings(draft: AppSettings): AppSettings {
  const defaults = defaultsForProvider(draft.provider);
  const apiKeys = { ...draft.apiKeys };
  for (const id of AI_PROVIDER_ORDER) {
    const v = apiKeys[id];
    if (typeof v === "string") {
      const t = v.trim();
      if (t) apiKeys[id] = t;
      else delete apiKeys[id];
    }
  }
  return ensureProviderModels({
    ...draft,
    apiKeys,
    surveyorName: draft.surveyorName.trim(),
    epcBearerToken: draft.epcBearerToken.trim(),
    model: draft.model.trim() || defaults.model,
    detailsSuggestModel:
      draft.detailsSuggestModel.trim() || defaults.detailsSuggestModel
  });
}

function ApiKeyField({
  label,
  value,
  placeholder,
  hint,
  onChange
}: {
  label: string;
  value: string;
  placeholder: string;
  hint?: string;
  onChange: (value: string) => void;
}) {
  const t = useT();
  const [visible, setVisible] = useState(false);

  return (
    <label className="field">
      <span>{label}</span>
      <div className="secret-input">
        <input
          type={visible ? "text" : "password"}
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="btn small secret-toggle"
          onClick={(e) => {
            e.preventDefault();
            setVisible((v) => !v);
          }}
          aria-pressed={visible}
          aria-label={visible ? t("settings.hideKey") : t("settings.showKey")}
        >
          {visible ? t("common.hide") : t("common.show")}
        </button>
      </div>
      {hint && <small>{hint}</small>}
    </label>
  );
}

export default function SettingsSheet({
  settings,
  onSave,
  onClose,
  focusIdentity = false
}: Props) {
  const [draft, setDraft] = useState<AppSettings>(settings);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const identityRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const pointerMode = usePointerInputModeValue();
  const folderCapable = canLinkReportFolder();
  const [folderName, setFolderName] = useState<string | null>(null);
  const [folderBusy, setFolderBusy] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [modelOptions, setModelOptions] = useState<AiModelOption[]>([]);
  const [modelsLive, setModelsLive] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [modelsBusy, setModelsBusy] = useState(false);
  const [addingProvider, setAddingProvider] = useState(false);
  const [openAiBrowserOk, setOpenAiBrowserOk] = useState<boolean | null>(null);
  const t = useT();
  const language = useUiLanguage();

  // Persist whatever is on screen whenever Settings closes for any reason
  // (Done, backdrop tap, Back, history pop, etc.).
  useEffect(() => {
    return () => {
      onSaveRef.current(normalizeSettings(draftRef.current));
    };
  }, []);

  useLayoutEffect(() => {
    if (!focusIdentity) return;
    identityRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    if (pointerMode === "fine") {
      nameInputRef.current?.focus({ preventScroll: true });
    }
  }, [focusIdentity, pointerMode]);

  useEffect(() => {
    let cancelled = false;
    if (!folderCapable) return;
    void getLinkedFolderName().then((name) => {
      if (!cancelled) setFolderName(name);
    });
    return () => {
      cancelled = true;
    };
  }, [folderCapable]);

  useEffect(() => {
    let cancelled = false;
    const key = providerApiKey(draft);
    const selected = [draft.model, draft.detailsSuggestModel];
    setModelsBusy(true);
    void listProviderModels(draft.provider, key, selected).then((result) => {
      if (cancelled) return;
      setModelOptions(result.models);
      setModelsLive(result.live);
      setModelsError(result.error ?? null);
      setModelsBusy(false);
    });
    return () => {
      cancelled = true;
    };
  }, [draft.provider, draft.apiKeys, draft.model, draft.detailsSuggestModel]);

  useEffect(() => {
    if (draft.provider !== "openai") {
      setOpenAiBrowserOk(null);
      return;
    }
    let cancelled = false;
    setOpenAiBrowserOk(null);
    void canCallOpenAiFromBrowser().then((ok) => {
      if (!cancelled) setOpenAiBrowserOk(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [draft.provider]);

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const activeKey = providerApiKey(draft);
  const providerMeta = AI_PROVIDERS[draft.provider];

  const onActiveKeyChange = (value: string) => {
    setDraft((d) => applyApiKey(d, value, d.provider));
  };

  const onPickProvider = (provider: AiProvider) => {
    setDraft((d) => setActiveProvider(d, provider));
    setAddingProvider(false);
  };

  const otherProviders = AI_PROVIDER_ORDER.filter((id) => id !== draft.provider);

  const onLinkFolder = async () => {
    setFolderError(null);
    setFolderBusy(true);
    try {
      const name = await linkReportFolder();
      setFolderName(name);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setFolderError(err instanceof Error ? err.message : String(err));
    } finally {
      setFolderBusy(false);
    }
  };

  const onUnlinkFolder = async () => {
    setFolderError(null);
    setFolderBusy(true);
    try {
      await unlinkReportFolder();
      setFolderName(null);
    } catch (err) {
      setFolderError(err instanceof Error ? err.message : String(err));
    } finally {
      setFolderBusy(false);
    }
  };

  const jumpLabel = draft.pipJumpOnHover
    ? t("settings.pipJumpHover")
    : pointerMode === "fine"
      ? t("settings.pipJumpClick")
      : t("settings.pipJumpTap");

  const sectionOption =
    modelOptions.find((m) => m.id === draft.model) ?? null;
  const detailsOption =
    modelOptions.find((m) => m.id === draft.detailsSuggestModel) ?? null;
  const sectionRates = resolveRatesForProviderModel(
    draft.provider,
    draft.model,
    sectionOption
  );
  const detailsRates = resolveRatesForProviderModel(
    draft.provider,
    draft.detailsSuggestModel,
    detailsOption
  );
  const costEstimate =
    sectionRates && detailsRates
      ? estimateReportScenarioUsd(sectionRates, detailsRates)
      : null;
  const ratesLive =
    sectionRates?.source === "live" || detailsRates?.source === "live";

  return (
    <SheetShell onClose={onClose}>
      {({ requestClose }) => (
        <>
        <h2>{t("settings.title")}</h2>

        <ThemePicker onThemeApplied={requestClose} />

        <div className="theme-field settings-language-field">
          <span className="theme-field-label">{t("settings.language")}</span>
          <CountryLanguageGrid
            layout="row"
            value={language}
            onChange={(next) => setUiLanguage(next)}
          />
        </div>

        <label className="field settings-text-scale">
          <span>{t("settings.textScale")}</span>
          <input
            type="range"
            min={TEXT_SCALE_MIN}
            max={TEXT_SCALE_MAX}
            step={0.05}
            value={draft.textScale}
            aria-valuemin={TEXT_SCALE_MIN}
            aria-valuemax={TEXT_SCALE_MAX}
            aria-valuenow={draft.textScale}
            onChange={(e) => {
              const value = Number(e.target.value);
              set("textScale", value);
              applyTextScale(value);
            }}
          />
          <small>{t("settings.textScaleHint")}</small>
        </label>

        <div className="pip-jump-row">
          <button
            type="button"
            className={`pill-switch${draft.pipJumpOnHover ? " is-on" : ""}`}
            role="switch"
            aria-checked={draft.pipJumpOnHover}
            aria-label={jumpLabel}
            onClick={() => set("pipJumpOnHover", !draft.pipJumpOnHover)}
          >
            <span className="pill-switch-thumb" aria-hidden />
          </button>
          <span className="pip-jump-label" data-fit-text>
            {jumpLabel}
          </span>
        </div>

        <div className="pip-jump-row">
          <button
            type="button"
            className={`pill-switch${draft.studioPhotoPassThrough ? " is-on" : ""}`}
            role="switch"
            aria-checked={draft.studioPhotoPassThrough}
            aria-label={t("settings.passThrough")}
            onClick={() =>
              set("studioPhotoPassThrough", !draft.studioPhotoPassThrough)
            }
          >
            <span className="pill-switch-thumb" aria-hidden />
          </button>
          <span className="pip-jump-label" data-fit-text>
            {t("settings.passThrough")}
          </span>
        </div>

        <div className="pip-jump-row">
          <button
            type="button"
            className={`pill-switch${draft.studioShowSectionText ? " is-on" : ""}`}
            role="switch"
            aria-checked={draft.studioShowSectionText}
            aria-label={t("settings.studioSectionTextAria")}
            onClick={() =>
              set("studioShowSectionText", !draft.studioShowSectionText)
            }
          >
            <span className="pill-switch-thumb" aria-hidden />
          </button>
          <span className="pip-jump-label" data-fit-text>
            {t("settings.studioSectionText")}
          </span>
        </div>

        <div className="pip-jump-row">
          <button
            type="button"
            className={`pill-switch${draft.autoSuggestDetailsExtras ? " is-on" : ""}`}
            role="switch"
            aria-checked={draft.autoSuggestDetailsExtras}
            aria-label={t("settings.autoSuggest")}
            onClick={() =>
              set("autoSuggestDetailsExtras", !draft.autoSuggestDetailsExtras)
            }
          >
            <span className="pill-switch-thumb" aria-hidden />
          </button>
          <span className="pip-jump-label" data-fit-text>
            {t("settings.autoSuggest")}
          </span>
        </div>

        <div className="pip-jump-row">
          <button
            type="button"
            className={`pill-switch${draft.homeCtaMorph ? " is-on" : ""}`}
            role="switch"
            aria-checked={draft.homeCtaMorph}
            aria-label={t("settings.homeCtaMorph")}
            onClick={() => set("homeCtaMorph", !draft.homeCtaMorph)}
          >
            <span className="pill-switch-thumb" aria-hidden />
          </button>
          <span className="pip-jump-label" data-fit-text>
            {t("settings.homeCtaMorph")}
          </span>
        </div>

        <div className="library-settings">
          <span className="library-settings-label">{t("settings.libraryLabel")}</span>
          {folderCapable ? (
            <>
              <p className="muted library-settings-copy">
                {folderName
                  ? t("settings.libraryLinked", { name: folderName })
                  : t("settings.libraryUnlinked")}
              </p>
              {folderError && <p className="warn-text">{folderError}</p>}
              <div className="library-settings-actions">
                <button
                  type="button"
                  className="btn primary"
                  disabled={folderBusy}
                  onClick={() => void onLinkFolder()}
                >
                  {folderName ? t("settings.changeFolder") : t("settings.linkFolder")}
                </button>
                {folderName && (
                  <button
                    type="button"
                    className="btn small"
                    disabled={folderBusy}
                    onClick={() => void onUnlinkFolder()}
                  >
                    {t("settings.useAppStorage")}
                  </button>
                )}
              </div>
            </>
          ) : (
            <p className="muted library-settings-copy">
              {t("settings.libraryUnsupported")}
            </p>
          )}
        </div>

        <div className="api-key-providers">
          <p className="api-key-providers-label">{t("settings.activeAi")}</p>
          <div className="api-key-active-row">
            <span className="api-key-active-name">{providerMeta.keyHint}</span>
            {otherProviders.length > 0 && (
              <button
                type="button"
                className="btn small"
                aria-expanded={addingProvider}
                onClick={() => setAddingProvider((v) => !v)}
              >
                {addingProvider ? t("common.cancel") : t("settings.addOther")}
              </button>
            )}
          </div>
          {addingProvider && (
            <ul className="api-key-providers-list">
              {otherProviders.map((id) => {
                const info = AI_PROVIDERS[id];
                const hasKey = Boolean(providerApiKey(draft, id));
                return (
                  <li key={id}>
                    <button
                      type="button"
                      className={`api-key-provider-chip${hasKey ? " has-key" : ""}`}
                      onClick={() => onPickProvider(id)}
                    >
                      <span className="api-key-provider-name">{info.keyHint}</span>
                      <span className="api-key-provider-meta">
                        {hasKey ? t("settings.keySaved") : info.keyPrefix}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <ApiKeyField
          label={t("settings.apiKeyLabel", { provider: providerMeta.label })}
          value={activeKey}
          placeholder={
            providerMeta.keyPrefix.includes("no fixed")
              ? t("settings.pasteKey")
              : providerMeta.keyPrefix
          }
          hint={t("settings.apiKeyHint")}
          onChange={onActiveKeyChange}
        />

        {draft.provider === "openai" && openAiBrowserOk === false && (
          <p className="openai-compat-warning" role="alert">
            <strong>{t("settings.openaiCorsTitle")}</strong>{" "}
            {t("settings.openaiCorsBody")}
          </p>
        )}

        <label className="field">
          <span>{t("settings.sectionModel")}</span>
          <select
            value={draft.model}
            onChange={(e) => set("model", e.target.value)}
            disabled={modelsBusy && modelOptions.length === 0}
          >
            {modelOptions.length === 0 ? (
              <option value={draft.model || ""}>
                {modelsBusy ? t("common.loading") : t("settings.noVisionModels")}
              </option>
            ) : (
              modelOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))
            )}
          </select>
          {sectionRates && (
            <small className="model-cost-hint">
              {t("settings.costSections", {
                cost: formatGbpFromUsd(estimateSectionsUsd(sectionRates)),
                count: COST_SCENARIO_SECTION_COUNT
              })}
              {sectionRates.source === "live" ? ` ${t("settings.liveRates")}` : ""}{" "}
              · {formatUsdRates(sectionRates)}
            </small>
          )}
          <small>
            {modelsBusy
              ? t("settings.loadingModels")
              : modelsLive
                ? t("settings.modelsLive", { provider: providerMeta.label })
                : modelsError || t("settings.modelsBuiltin")}
          </small>
        </label>

        <label className="field">
          <span>{t("settings.detailsModel")}</span>
          <select
            value={draft.detailsSuggestModel}
            onChange={(e) => set("detailsSuggestModel", e.target.value)}
            disabled={modelsBusy && modelOptions.length === 0}
          >
            {modelOptions.length === 0 ? (
              <option value={draft.detailsSuggestModel || ""}>
                {modelsBusy ? t("common.loading") : t("settings.noVisionModels")}
              </option>
            ) : (
              modelOptions.map((m) => (
                <option key={`details-${m.id}`} value={m.id}>
                  {m.label}
                </option>
              ))
            )}
          </select>
          {detailsRates && (
            <small className="model-cost-hint">
              {t("settings.costDetails", {
                cost: formatGbpFromUsd(estimateDetailsUsd(detailsRates))
              })}
              {detailsRates.source === "live" ? ` ${t("settings.liveRates")}` : ""}{" "}
              · {formatUsdRates(detailsRates)}
            </small>
          )}
          <small>{t("settings.detailsModelHint")}</small>
        </label>

        {costEstimate && (
          <p className="ai-cost-estimate" role="status">
            <strong>
              {t("settings.combinedEstimate", {
                cost: formatGbpFromUsd(costEstimate.totalUsd)
              })}
            </strong>
            <span>
              {t("settings.combinedEstimateBody", {
                count: COST_SCENARIO_SECTION_COUNT,
                rates: ratesLive ? t("settings.liveCatalog") : t("settings.estimated")
              })}
            </span>
          </p>
        )}

        <ApiKeyField
          label={t("settings.epcToken")}
          value={draft.epcBearerToken}
          placeholder="Bearer …"
          hint={t("settings.epcTokenHint")}
          onChange={(value) => set("epcBearerToken", value)}
        />

        <div ref={identityRef} className="settings-identity">
          <label
            className={`field${!draft.surveyorName.trim() ? " is-required-empty" : ""}`}
          >
            <span>{t("settings.yourName")}</span>
            <input
              ref={nameInputRef}
              type="text"
              value={draft.surveyorName}
              placeholder={t("settings.yourNamePlaceholder")}
              autoComplete="name"
              onChange={(e) => set("surveyorName", e.target.value)}
            />
            <small>{t("settings.yourNameHint")}</small>
          </label>

          <label
            className={`field${!draft.companyName.trim() ? " is-required-empty" : ""}`}
          >
            <span>{t("settings.companyName")}</span>
            <input
              type="text"
              value={draft.companyName}
              onChange={(e) => set("companyName", e.target.value)}
            />
            <small>{t("settings.requiredBeforeGenerate")}</small>
          </label>

          <label
            className={`field${!draft.website.trim() ? " is-required-empty" : ""}`}
          >
            <span>{t("settings.website")}</span>
            <input
              type="text"
              value={draft.website}
              onChange={(e) => set("website", e.target.value)}
            />
            <small>{t("settings.requiredBeforeGenerate")}</small>
          </label>
        </div>

        <div className="sheet-actions">
          <button type="button" className="btn primary" onClick={requestClose}>
            {t("common.done")}
          </button>
        </div>
        </>
      )}
    </SheetShell>
  );
}
