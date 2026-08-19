import { useState } from "react";
import type { ReportMetadata } from "../types";
import { useT } from "../lib/i18n";
import {
  extractUkPostcode,
  formatUkPostcode,
  lookupPostcode,
  nearestPostcodes,
  readDevicePosition,
  reverseGeocodeAddress,
  searchAddressesByPostcode
} from "../lib/postcodes";
import {
  fetchEpcForHit,
  mapEpcPropertyType,
  searchEpcByPostcode,
  type EpcSearchHit
} from "../lib/epc";
import type { PropertyEpcSummary } from "../types";

export const PROPERTY_TYPES = [
  "end-of-terrace dwelling",
  "mid-terrace dwelling",
  "detached dwelling",
  "semi-detached dwelling",
  "flat/apartment",
  "commercial premises",
  "hotel"
];

function osmHitsToEpc(
  rows: { id: string; address: string; postcode: string }[]
): EpcSearchHit[] {
  return rows.map((row) => ({
    lmkKey: row.id,
    address: row.address,
    address1: "",
    address2: "",
    address3: "",
    posttown: "",
    postcode: row.postcode,
    propertyType: "",
    builtForm: "",
    constructionAgeBand: "",
    totalFloorArea: "",
    currentEnergyRating: ""
  }));
}

type Props = {
  metadata: ReportMetadata;
  onMetadata: (next: ReportMetadata) => void;
  onPickedEpc?: (epc: PropertyEpcSummary | null) => void;
  /** Extra copy under the heading (field-notes first prompt). */
  intro?: boolean;
};

export default function PropertyAddressForm({
  metadata,
  onMetadata,
  onPickedEpc,
  intro = false
}: Props) {
  const t = useT();
  const [postcode, setPostcode] = useState(
    () => extractUkPostcode(metadata.propertyAddress) ?? ""
  );
  const [hits, setHits] = useState<EpcSearchHit[]>([]);
  const [busy, setBusy] = useState<"geo" | "search" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listTitle, setListTitle] = useState("");

  const setMeta = <K extends keyof ReportMetadata>(
    key: K,
    value: ReportMetadata[K]
  ) => onMetadata({ ...metadata, [key]: value });

  const applyHit = async (hit: EpcSearchHit) => {
    const mappedType = mapEpcPropertyType(hit);
    onMetadata({
      ...metadata,
      propertyAddress: hit.address,
      propertyType: mappedType ?? metadata.propertyType
    });
    setPostcode(hit.postcode);
    setHits([]);
    if (!onPickedEpc) return;
    if (hit.lmkKey.startsWith("osm:")) {
      onPickedEpc(null);
      return;
    }
    try {
      const summary = await fetchEpcForHit(hit);
      onPickedEpc(summary);
    } catch {
      onPickedEpc(null);
    }
  };

  const searchPostcode = async (code: string, title: string) => {
    const formatted = formatUkPostcode(code);
    setBusy("search");
    setError(null);
    try {
      const valid = await lookupPostcode(formatted);
      const pc = valid?.postcode || extractUkPostcode(formatted) || formatted;
      if (!extractUkPostcode(pc)) {
        setHits([]);
        setError(t("address.lookupFailed"));
        return;
      }
      setPostcode(pc);
      let found: EpcSearchHit[] = [];
      let epcFailed = false;
      try {
        found = await searchEpcByPostcode(pc);
      } catch {
        epcFailed = true;
        found = [];
      }
      if (found.length === 0) {
        try {
          found = osmHitsToEpc(await searchAddressesByPostcode(pc));
        } catch {
          found = [];
        }
      } else {
        found = [...found].sort((a, b) => a.address.localeCompare(b.address));
      }
      setHits(found);
      setListTitle(title);
      if (epcFailed) {
        setError(t("address.epcFailed"));
      } else if (found.length === 0) {
        setError(t("address.noProperties"));
      }
    } catch {
      setHits([]);
      setError(t("address.lookupFailed"));
    } finally {
      setBusy(null);
    }
  };

  const onDetect = async () => {
    setBusy("geo");
    setError(null);
    try {
      const pos = await readDevicePosition();
      const nearby = await nearestPostcodes(
        pos.coords.latitude,
        pos.coords.longitude,
        4
      );
      if (nearby.length === 0) {
        setError(t("address.lookupFailed"));
        return;
      }
      const street = await reverseGeocodeAddress(
        pos.coords.latitude,
        pos.coords.longitude
      ).catch(() => null);
      if (street && !metadata.propertyAddress.trim()) {
        setMeta("propertyAddress", street);
      }
      const collected: EpcSearchHit[] = [];
      const seen = new Set<string>();
      try {
        for (const row of nearby) {
          const found = await searchEpcByPostcode(row.postcode);
          for (const hit of found) {
            if (seen.has(hit.lmkKey)) continue;
            seen.add(hit.lmkKey);
            collected.push(hit);
          }
          if (collected.length >= 24) break;
        }
      } catch {
        /* EPC optional — street search still helps */
      }
      if (collected.length === 0) {
        try {
          const osm = osmHitsToEpc(
            await searchAddressesByPostcode(nearby[0]!.postcode)
          );
          collected.push(...osm);
        } catch {
          /* street search optional */
        }
      } else {
        collected.sort((a, b) => a.address.localeCompare(b.address));
      }
      setPostcode(nearby[0]!.postcode);
      setHits(collected);
      setListTitle(t("address.nearbyTitle"));
      if (collected.length === 0) setError(t("address.noProperties"));
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? Number((err as { code: number }).code)
          : 0;
      setError(
        code === 1 ? t("address.locationDenied") : t("address.locationFailed")
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {intro && <p className="muted">{t("address.intro")}</p>}
      <div className="address-lookup-row">
        <button
          type="button"
          className="btn"
          disabled={busy !== null}
          onClick={() => void onDetect()}
        >
          {busy === "geo" ? t("address.detecting") : t("address.detectLocation")}
        </button>
      </div>
      <label className="field">
        <span>{t("address.postcode")}</span>
        <div className="address-postcode-row">
          <input
            type="text"
            autoComplete="postal-code"
            value={postcode}
            placeholder={t("address.postcodePlaceholder")}
            onChange={(e) => setPostcode(formatUkPostcode(e.target.value))}
            onBlur={() => {
              const extracted = extractUkPostcode(postcode);
              if (extracted) setPostcode(extracted);
            }}
          />
          <button
            type="button"
            className="btn small"
            disabled={busy !== null || postcode.trim().length < 5}
            onClick={() =>
              void searchPostcode(postcode, t("address.atPostcodeTitle"))
            }
          >
            {busy === "search" ? t("address.searching") : t("address.findProperties")}
          </button>
        </div>
      </label>
      {error && <p className="warn-text">{error}</p>}
      {hits.length > 0 && (
        <div className="address-hit-list">
          <p className="address-hit-label">{listTitle}</p>
          <ul>
            {hits.map((hit) => (
              <li key={hit.lmkKey}>
                <button
                  type="button"
                  className="address-hit"
                  onClick={() => void applyHit(hit)}
                >
                  <strong>{hit.address}</strong>
                  {(hit.currentEnergyRating ||
                    hit.propertyType ||
                    hit.builtForm) && (
                    <small>
                      {[
                        hit.currentEnergyRating
                          ? `EPC ${hit.currentEnergyRating}`
                          : "",
                        hit.propertyType,
                        hit.builtForm
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <label className="field">
        <span>{t("address.propertyAddress")}</span>
        <input
          type="text"
          value={metadata.propertyAddress}
          placeholder={t("address.addressPlaceholder")}
          onChange={(e) => setMeta("propertyAddress", e.target.value)}
        />
      </label>
      <label className="field">
        <span>{t("address.clientName")}</span>
        <input
          type="text"
          value={metadata.clientName}
          onChange={(e) => setMeta("clientName", e.target.value)}
        />
      </label>
      <div className="field-row">
        <label className="field">
          <span>{t("address.phone")}</span>
          <input
            type="tel"
            value={metadata.phone}
            onChange={(e) => setMeta("phone", e.target.value)}
          />
        </label>
        <label className="field">
          <span>{t("address.email")}</span>
          <input
            type="email"
            value={metadata.email}
            onChange={(e) => setMeta("email", e.target.value)}
          />
        </label>
      </div>
      <label className="field">
        <span>{t("address.propertyType")}</span>
        <select
          value={metadata.propertyType}
          onChange={(e) => setMeta("propertyType", e.target.value)}
        >
          {PROPERTY_TYPES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
