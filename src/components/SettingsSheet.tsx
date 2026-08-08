import { useState } from "react";
import { DEFAULT_MODEL, type AppSettings } from "../lib/settings";

interface Props {
  settings: AppSettings;
  onSave: (next: AppSettings) => void;
  onClose: () => void;
}

export default function SettingsSheet({ settings, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<AppSettings>(settings);

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>

        <label className="field">
          <span>Claude API key</span>
          <input
            type="password"
            value={draft.apiKey}
            placeholder="sk-ant-..."
            autoComplete="off"
            onChange={(e) => set("apiKey", e.target.value.trim())}
          />
          <small>
            Used only for sections the app cannot match automatically. Stored
            on this device only.
          </small>
        </label>

        <label className="field">
          <span>Claude model</span>
          <input
            type="text"
            value={draft.model}
            placeholder={DEFAULT_MODEL}
            onChange={(e) => set("model", e.target.value.trim() || DEFAULT_MODEL)}
          />
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

        <label className="field">
          <span>Surveyor name (optional)</span>
          <input
            type="text"
            value={draft.surveyorName}
            onChange={(e) => set("surveyorName", e.target.value)}
          />
        </label>

        <div className="sheet-actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => onSave(draft)}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
