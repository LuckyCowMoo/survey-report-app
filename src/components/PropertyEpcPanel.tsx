import { useT } from "../lib/i18n";
import type { PropertyEpcSummary } from "../types";

type Props = {
  epc: PropertyEpcSummary | null;
  loading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
};

function Row({
  label,
  value
}: {
  label: string;
  value?: string | number | boolean | null;
}) {
  if (value === null || value === undefined || value === "") return null;
  const text =
    typeof value === "boolean" ? undefined : String(value);
  if (text !== undefined && !text.trim()) return null;
  return (
    <div className="epc-row">
      <span className="epc-row-label">{label}</span>
      <span className="epc-row-value">
        {typeof value === "boolean" ? null : text}
      </span>
    </div>
  );
}

function energySuffix(desc?: string, rating?: string): string {
  const bits = [desc, rating].filter((s) => s && s.trim());
  return bits.join(" · ");
}

export default function PropertyEpcPanel({
  epc,
  loading = false,
  error = null,
  onRefresh
}: Props) {
  const t = useT();
  const yes = t("epc.yes");
  const no = t("epc.no");

  return (
    <section className="panel epc-panel">
      <div className="details-panel-head">
        <h2>{t("epc.title")}</h2>
        {onRefresh && (
          <button
            type="button"
            className="btn small"
            disabled={loading}
            onClick={onRefresh}
          >
            {t("epc.refresh")}
          </button>
        )}
      </div>
      <p className="muted">{t("epc.subtitle")}</p>
      {loading && <p className="muted">{t("epc.loading")}</p>}
      {error && !loading && <p className="warn-text">{error}</p>}
      {!loading && !epc && !error && <p className="muted">{t("epc.none")}</p>}
      {epc && !loading && (
        <div className="epc-grid">
          <Row label={t("epc.built")} value={epc.constructionAgeBand} />
          <Row
            label={t("epc.property")}
            value={[epc.propertyType, epc.builtForm].filter(Boolean).join(" · ")}
          />
          <Row
            label={t("epc.floorArea")}
            value={
              epc.totalFloorArea != null
                ? t("epc.sqm", { n: epc.totalFloorArea })
                : ""
            }
          />
          <Row label={t("epc.extensions")} value={epc.extensionsCount} />
          <Row
            label={t("epc.rooms")}
            value={
              epc.habitableRoomCount != null || epc.heatedRoomCount != null
                ? `${epc.habitableRoomCount ?? "—"} / ${epc.heatedRoomCount ?? "—"}`
                : ""
            }
          />
          <Row
            label={t("epc.walls")}
            value={energySuffix(epc.walls, epc.wallsEnergy)}
          />
          <Row
            label={t("epc.roof")}
            value={energySuffix(epc.roof, epc.roofEnergy)}
          />
          <Row
            label={t("epc.floor")}
            value={energySuffix(epc.floor, epc.floorEnergy)}
          />
          <Row
            label={t("epc.windows")}
            value={energySuffix(
              epc.windows || epc.glazedType,
              epc.windowsEnergy || epc.glazedArea
            )}
          />
          <Row
            label={t("epc.heating")}
            value={energySuffix(epc.mainHeating, epc.mainHeatingEnergy)}
          />
          <Row label={t("epc.hotWater")} value={epc.hotWater} />
          <Row label={t("epc.lighting")} value={epc.lighting} />
          <Row label={t("epc.fuel")} value={epc.mainFuel} />
          <Row
            label={t("epc.rating")}
            value={[
              epc.currentEnergyRating,
              epc.potentialEnergyRating
                ? `→ ${epc.potentialEnergyRating}`
                : ""
            ]
              .filter(Boolean)
              .join(" ")}
          />
          <Row label={t("epc.tenure")} value={epc.tenure} />
          <Row label={t("epc.inspected")} value={epc.inspectionDate} />
          {epc.mainsGas != null && (
            <Row label={t("epc.mainsGas")} value={epc.mainsGas ? yes : no} />
          )}
          {epc.solarWaterHeating != null && (
            <Row
              label={t("epc.solarHotWater")}
              value={epc.solarWaterHeating ? yes : no}
            />
          )}
          <Row
            label={t("epc.pv")}
            value={epc.photoSupply != null ? `${epc.photoSupply}%` : ""}
          />
          <Row label={t("epc.ventilation")} value={epc.mechanicalVentilation} />
        </div>
      )}
    </section>
  );
}
