import { useEffect, useRef, useState } from "react";
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
  type AiModelOption
} from "../lib/aiModels";
import { usePointerInputModeValue } from "../lib/pointerInput";
import {
  canLinkReportFolder,
  getLinkedFolderName,
  linkReportFolder,
  unlinkReportFolder
} from "../lib/reportLibrary";
import ThemePicker from "./ThemeToggle";
import { canCallOpenAiFromBrowser } from "../lib/openaiBrowserCompat";

interface Props {
  settings: AppSettings;
  /** Persist settings (called automatically when the sheet closes). */
  onSave: (next: AppSettings) => void;
  onClose: () => void;
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
          aria-label={visible ? "Hide API key" : "Show API key"}
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
      {hint && <small>{hint}</small>}
    </label>
  );
}

function pipJumpLabel(hover: boolean, pointer: "fine" | "coarse"): string {
  if (hover) return "hover pip to move";
  return pointer === "fine" ? "click pip to move" : "tap pip to move";
}

export default function SettingsSheet({ settings, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<AppSettings>(settings);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
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

  // Persist whatever is on screen whenever Settings closes for any reason
  // (Done, backdrop tap, Back, history pop, etc.).
  useEffect(() => {
    return () => {
      onSaveRef.current(normalizeSettings(draftRef.current));
    };
  }, []);

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

  const jumpLabel = pipJumpLabel(draft.pipJumpOnHover, pointerMode);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>

        <ThemePicker />

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
          <span className="pip-jump-label">{jumpLabel}</span>
        </div>

        <div className="pip-jump-row">
          <button
            type="button"
            className={`pill-switch${draft.studioPhotoPassThrough ? " is-on" : ""}`}
            role="switch"
            aria-checked={draft.studioPhotoPassThrough}
            aria-label="scroll through in-between photos"
            onClick={() =>
              set("studioPhotoPassThrough", !draft.studioPhotoPassThrough)
            }
          >
            <span className="pill-switch-thumb" aria-hidden />
          </button>
          <span className="pip-jump-label">scroll through in-between photos</span>
        </div>

        <div className="pip-jump-row">
          <button
            type="button"
            className={`pill-switch${draft.autoSuggestDetailsExtras ? " is-on" : ""}`}
            role="switch"
            aria-checked={draft.autoSuggestDetailsExtras}
            aria-label="auto-suggest details extras"
            onClick={() =>
              set("autoSuggestDetailsExtras", !draft.autoSuggestDetailsExtras)
            }
          >
            <span className="pill-switch-thumb" aria-hidden />
          </button>
          <span className="pip-jump-label">
            auto-suggest issues, recommendations & costs
          </span>
        </div>

        <div className="library-settings">
          <span className="library-settings-label">Report library</span>
          {folderCapable ? (
            <>
              <p className="muted library-settings-copy">
                {folderName
                  ? `Finished reports are written to “${folderName}” on this computer.`
                  : "This browser can link a folder. That’s the recommended place to keep finished reports so they aren’t downloaded twice."}
              </p>
              {folderError && <p className="warn-text">{folderError}</p>}
              <div className="library-settings-actions">
                <button
                  type="button"
                  className="btn primary"
                  disabled={folderBusy}
                  onClick={() => void onLinkFolder()}
                >
                  {folderName ? "Change folder" : "Link a reports folder"}
                </button>
                {folderName && (
                  <button
                    type="button"
                    className="btn small"
                    disabled={folderBusy}
                    onClick={() => void onUnlinkFolder()}
                  >
                    Use app storage instead
                  </button>
                )}
              </div>
            </>
          ) : (
            <p className="muted library-settings-copy">
              This device can’t link a disk folder, so finished reports are kept
              in this app’s storage as reopenable projects (with a Word copy for
              share and download).
            </p>
          )}
        </div>

        <div className="api-key-providers">
          <p className="api-key-providers-label">Active AI service</p>
          <div className="api-key-active-row">
            <span className="api-key-active-name">{providerMeta.keyHint}</span>
            {otherProviders.length > 0 && (
              <button
                type="button"
                className="btn small"
                aria-expanded={addingProvider}
                onClick={() => setAddingProvider((v) => !v)}
              >
                {addingProvider ? "Cancel" : "Add other"}
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
                        {hasKey ? "Key saved" : info.keyPrefix}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <ApiKeyField
          label={`${providerMeta.label} API key`}
          value={activeKey}
          placeholder={
            providerMeta.keyPrefix.includes("no fixed")
              ? "Paste key here"
              : providerMeta.keyPrefix
          }
          hint="Saved on this device only. Ask AI uses this active service — tap Add other to store a key for another provider and switch to it."
          onChange={onActiveKeyChange}
        />

        {draft.provider === "openai" && openAiBrowserOk === false && (
          <p className="openai-compat-warning" role="alert">
            <strong>This browser can’t use OpenAI from the app.</strong> OpenAI
            blocks the request (CORS), so Ask AI will fail with a network error.
            Switch to Claude, Gemini, or OpenRouter instead.
          </p>
        )}

        <label className="field">
          <span>Section AI model</span>
          <select
            value={draft.model}
            onChange={(e) => set("model", e.target.value)}
            disabled={modelsBusy && modelOptions.length === 0}
          >
            {modelOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <small>
            {modelsBusy
              ? "Loading models…"
              : modelsLive
                ? `Live list from ${providerMeta.label}.`
                : modelsError || "Using built-in model list."}
          </small>
        </label>

        <label className="field">
          <span>Details suggestions model</span>
          <select
            value={draft.detailsSuggestModel}
            onChange={(e) => set("detailsSuggestModel", e.target.value)}
            disabled={modelsBusy && modelOptions.length === 0}
          >
            {modelOptions.map((m) => (
              <option key={`details-${m.id}`} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <small>
            Used for issues, recommendations, and cost suggestions. Pick a
            higher-tier model here if you want.
          </small>
        </label>

        <label className="field">
          <span>Your name (report Contact)</span>
          <input
            type="text"
            value={draft.surveyorName}
            placeholder="e.g. Alex Morgan"
            autoComplete="name"
            onChange={(e) => set("surveyorName", e.target.value)}
          />
          <small>
            Shown as Contact in the page header. Required before generating a
            report.
          </small>
        </label>

        <label className="field">
          <span>Company name</span>
          <input
            type="text"
            value={draft.companyName}
            onChange={(e) => set("companyName", e.target.value)}
          />
        </label>

        <label className="field">
          <span>Website (shown on the cover page)</span>
          <input
            type="text"
            value={draft.website}
            onChange={(e) => set("website", e.target.value)}
          />
        </label>

        <div className="sheet-actions">
          <button type="button" className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
