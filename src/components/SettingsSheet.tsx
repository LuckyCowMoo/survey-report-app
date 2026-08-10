import { useState } from "react";
import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_MODEL,
  type AppSettings
} from "../lib/settings";
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

export default function SettingsSheet({ settings, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<AppSettings>(settings);

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const save = () => {
    onSave({
      ...draft,
      apiKey: draft.apiKey.trim(),
      geminiApiKey: draft.geminiApiKey.trim(),
      model: draft.model.trim() || DEFAULT_MODEL,
      geminiModel: draft.geminiModel.trim() || DEFAULT_GEMINI_MODEL
    });
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>

        <ThemePicker />

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
              <span>Claude model</span>
              <input
                type="text"
                value={draft.model}
                placeholder={DEFAULT_MODEL}
                onChange={(e) => set("model", e.target.value)}
              />
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
              <span>Gemini model</span>
              <input
                type="text"
                value={draft.geminiModel}
                placeholder={DEFAULT_GEMINI_MODEL}
                onChange={(e) => set("geminiModel", e.target.value)}
              />
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
