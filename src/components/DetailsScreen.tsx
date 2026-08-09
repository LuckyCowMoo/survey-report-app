import { useState } from "react";
import { library } from "../lib/matcher";
import type { CostLine, ReportExtras, ReportMetadata } from "../types";

interface Props {
  metadata: ReportMetadata;
  extras: ReportExtras;
  onMetadata: (m: ReportMetadata) => void;
  onExtras: (e: ReportExtras) => void;
  onContinue: () => void;
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

export default function DetailsScreen({
  metadata,
  extras,
  onMetadata,
  onExtras,
  onContinue
}: Props) {
  const [recPreview, setRecPreview] = useState<string | null>(null);

  const setMeta = <K extends keyof ReportMetadata>(key: K, value: ReportMetadata[K]) =>
    onMetadata({ ...metadata, [key]: value });

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

  const addCostLine = (itemId: string) => {
    const item = library.costItems.find((c) => c.id === itemId);
    const line: CostLine = {
      id: `cost-${costIdCounter++}`,
      itemId: item?.id ?? "custom",
      label: item?.label ?? "Custom item",
      description: item?.text ?? "",
      amount: ""
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

  const total = extras.costLines.reduce((sum, l) => {
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

      <section className="panel">
        <h2>Issues found at this property</h2>
        <p className="muted">
          Ticked issues get their full explainer section and an "is an issue in
          this property" flag in the report.
        </p>
        <label className="toggle">
          <input
            type="checkbox"
            checked={extras.dampIssues.risingDamp}
            onChange={() => toggleIssue("risingDamp")}
          />
          <span>Rising damp</span>
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={extras.dampIssues.penetratingDamp}
            onChange={() => toggleIssue("penetratingDamp")}
          />
          <span>Penetrating damp</span>
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={extras.dampIssues.condensation}
            onChange={() => toggleIssue("condensation")}
          />
          <span>Condensation</span>
        </label>
      </section>

      <section className="panel">
        <h2>Recommendations</h2>
        <p className="muted">Tick the standard recommendations to include.</p>
        {library.recommendations.map((r) => (
          <div key={r.id} className="rec-row">
            <label className="toggle">
              <input
                type="checkbox"
                checked={extras.recommendationIds.includes(r.id)}
                onChange={() => toggleRec(r.id)}
              />
              <span>{r.label}</span>
            </label>
            <button
              className="btn tiny"
              onClick={() => setRecPreview(recPreview === r.id ? null : r.id)}
            >
              {recPreview === r.id ? "Hide" : "View"}
            </button>
            {recPreview === r.id && <p className="rec-preview">{r.text}</p>}
          </div>
        ))}
      </section>

      <section className="panel">
        <h2>Project plan & costs</h2>
        <label className="field">
          <span>Areas of work (one line per room/area)</span>
          <textarea
            rows={4}
            placeholder={"Living area: all exterior walls from floor to 1.2 meters\nHallway: interior wall from floor to 1.2 meters"}
            value={extras.projectPlanLines}
            onChange={(e) => onExtras({ ...extras, projectPlanLines: e.target.value })}
          />
        </label>

        {extras.costLines.map((line) => (
          <div key={line.id} className="cost-line">
            <div className="cost-line-label">{costLineLabel(line)}</div>
            <textarea
              rows={3}
              value={line.description}
              placeholder="Describe the work item..."
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
                  onChange={(e) => updateCostLine(line.id, { amount: e.target.value })}
                />
              </label>
              <button className="btn tiny danger" onClick={() => removeCostLine(line.id)}>
                Remove
              </button>
            </div>
          </div>
        ))}

        <div className="cost-add">
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) addCostLine(e.target.value);
              e.target.value = "";
            }}
          >
            <option value="">Add standard cost item...</option>
            {library.costItems.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <button className="btn small" onClick={() => addCostLine("custom")}>
            Add custom item
          </button>
        </div>

        {extras.costLines.length > 0 && (
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
              onChange={(e) => onExtras({ ...extras, surveyDiscount: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Estimated duration</span>
            <input
              type="text"
              value={extras.timeEstimate}
              placeholder="5-7 days"
              onChange={(e) => onExtras({ ...extras, timeEstimate: e.target.value })}
            />
          </label>
        </div>
      </section>

      <div className="bottom-bar">
        <button className="btn primary big" onClick={onContinue}>
          Continue to generate
        </button>
      </div>
    </div>
  );
}
