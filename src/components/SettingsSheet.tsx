import { useEffect, useState } from "react";
import {
  DEFAULT_DETAILS_SUGGEST_MODEL,
  DEFAULT_GEMINI_DETAILS_SUGGEST_MODEL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_MODEL,
  type AppSettings
} from "../lib/settings";
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

interface Props {
  settings: AppSettings;
  onSave: (next: AppSettings) => void;
  onClose: () => void;
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
  const pointerMode = usePointerInputModeValue();
  const folderCapable = canLinkReportFolder();
  const [folderName, setFolderName] = useState<string | null>(null);
  const [folderBusy, setFolderBusy] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [modelOptions, setModelOptions] = useState<AiModelOption[]>([]);
  const [modelsLive, setModelsLive] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [modelsBusy, setModelsBusy] = useState(false);

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
    const key = draft.provider === "gemini" ? draft.geminiApiKey : draft.apiKey;
    const selected =
      draft.provider === "gemini"
        ? [draft.geminiModel, draft.geminiDetailsSuggestModel]
        : [draft.model, draft.detailsSuggestModel];
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
  }, [
    draft.provider,
    draft.apiKey,
    draft.geminiApiKey,
    draft.model,
    draft.geminiModel,
    draft.detailsSuggestModel,
    draft.geminiDetailsSuggestModel
  ]);

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const save = () => {
    onSave({
      ...draft,
      apiKey: draft.apiKey.trim(),
      geminiApiKey: draft.geminiApiKey.trim(),
      model: draft.model.trim() || DEFAULT_MODEL,
      detailsSuggestModel:
        draft.detailsSuggestModel.trim() || DEFAULT_DETAILS_SUGGEST_MODEL,
      geminiModel: draft.geminiModel.trim() || DEFAULT_GEMINI_MODEL,
      geminiDetailsSuggestModel:
        draft.geminiDetailsSuggestModel.trim() ||
        DEFAULT_GEMINI_DETAILS_SUGGEST_MODEL
    });
  };

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

        <label className="field">
          <span>AI service</span>
          <select
            value={draft.provider}
            onChange={(e) => set("provider", e.target.value as AppSettings["provider"])}
          >
            <option value="claude">Claude (Anthropic)</option>
            <option value="gemini">Gemini (Google)</option>
          </select>
          <small>
            Used only for sections the app cannot match automatically. The key
            is stored on this device only.
          </small>
        </label>

        {draft.provider === "claude" ? (
          <>
            <ApiKeyField
              label="Claude API key"
              value={draft.apiKey}
              placeholder="sk-ant-..."
              onChange={(value) => set("apiKey", value)}
            />

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
                    ? "Live list from Anthropic."
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
          </>
        ) : (
          <>
            <ApiKeyField
              label="Gemini API key"
              value={draft.geminiApiKey}
              placeholder="AIza..."
              hint="Free to create at aistudio.google.com - handy for testing with your own account."
              onChange={(value) => set("geminiApiKey", value)}
            />

            <label className="field">
              <span>Section AI model</span>
              <select
                value={draft.geminiModel}
                onChange={(e) => set("geminiModel", e.target.value)}
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
                    ? "Live list from Google."
                    : modelsError || "Using built-in model list."}
              </small>
            </label>

            <label className="field">
              <span>Details suggestions model</span>
              <select
                value={draft.geminiDetailsSuggestModel}
                onChange={(e) => set("geminiDetailsSuggestModel", e.target.value)}
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
          </>
        )}

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
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
