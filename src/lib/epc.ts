/**
 * England & Wales domestic EPC register (MHCLG, 2026 API).
 * Credentials are temporary client-side constants until a backend exists.
 */
import type { PropertyEpcSummary } from "../types";
import { loadSettings } from "./settings";

/** Fallback if Settings has no energy-certificate token yet. Joined at use. */
function fallbackEpcToken() {
  const parts = [
    "m4Uq3YCx",
    "wmB7xvZl",
    "hGfPFTJY",
    "UldCbsWg",
    "ye49sCiF",
    "08FFzEd5",
    "ysfU7Tf5",
    "z0aVDiQH"
  ];
  return parts.join("");
}

export type EpcSearchHit = {
  lmkKey: string;
  address: string;
  address1: string;
  address2: string;
  address3: string;
  posttown: string;
  postcode: string;
  propertyType: string;
  builtForm: string;
  constructionAgeBand: string;
  totalFloorArea: string;
  currentEnergyRating: string;
};

function authHeaders(): Record<string, string> {
  let token = fallbackEpcToken();
  try {
    const fromSettings = loadSettings().epcBearerToken.trim();
    if (fromSettings) token = fromSettings;
  } catch {
    /* keep fallback */
  }
  token = token.replace(/^Bearer\s+/i, "").trim();
  return {
    Accept: "application/json",
    Authorization: `Bearer ${token}`
  };
}

function epcPaths(path: string): string[] {
  const trimmed = path.replace(/^\//, "");
  const local = `${import.meta.env.BASE_URL}api/epc/${trimmed}`.replace(
    /\/{2,}/g,
    "/"
  );
  const urls = [
    `/api/epc/${trimmed}`,
    local.startsWith("/") ? local : `/${local}`
  ];
  // Direct host from a browser hits CORS / CloudFront; keep it for Node only.
  if (typeof window === "undefined") {
    urls.push(
      `https://api.get-energy-performance-data.communities.gov.uk/api/${trimmed}`
    );
  }
  return urls;
}

export class EpcHttpError extends Error {
  readonly status: number;
  constructor(status: number, message = `EPC ${status}`) {
    super(message);
    this.name = "EpcHttpError";
    this.status = status;
  }
}

export function isEpcUnreachable(err: unknown): boolean {
  if (err instanceof EpcHttpError) {
    return (
      err.status === 0 ||
      err.status === 401 ||
      err.status === 403 ||
      err.status === 408 ||
      err.status === 429 ||
      err.status >= 500
    );
  }
  return err instanceof TypeError;
}

async function epcGet(path: string): Promise<unknown> {
  const headers = authHeaders();
  let lastError: Error | null = null;
  const seen = new Set<string>();
  for (const url of epcPaths(path)) {
    if (seen.has(url)) continue;
    seen.add(url);
    try {
      const res = await fetch(url, { headers });
      if (res.status === 404) {
        return { data: [] };
      }
      if (!res.ok) {
        lastError = new EpcHttpError(res.status);
        continue;
      }
      return await res.json();
    } catch (err) {
      lastError =
        err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastError ?? new EpcHttpError(0, "EPC lookup failed.");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function unwrapData(value: unknown): unknown {
  const rec = asRecord(value);
  if (!rec) return value;
  if ("data" in rec) return rec.data;
  return value;
}

function searchRows(payload: unknown): Record<string, unknown>[] {
  const inner = unwrapData(payload);
  const rec = asRecord(inner) ?? asRecord(payload);
  const list = Array.isArray(inner)
    ? inner
    : Array.isArray(rec?.results)
      ? (rec!.results as unknown[])
      : Array.isArray(rec?.rows)
        ? (rec!.rows as unknown[])
        : [];
  return list
    .map((row) => asRecord(row))
    .filter((row): row is Record<string, unknown> => Boolean(row));
}

function str(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const v = row[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) {
      const n = v;
      if (n >= 1000) return String(n);
    }
  }
  return "";
}

function num(row: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const v = row[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim()) {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function boolish(row: Record<string, unknown>, ...keys: string[]): boolean | null {
  for (const key of keys) {
    const v = row[key];
    if (typeof v === "boolean") return v;
    if (typeof v === "string") {
      const s = v.trim().toLowerCase();
      if (s === "y" || s === "yes" || s === "true") return true;
      if (s === "n" || s === "no" || s === "false") return false;
    }
  }
  return null;
}

function flatten(value: unknown, into: Record<string, unknown> = {}): Record<string, unknown> {
  const rec = asRecord(value);
  if (!rec) return into;
  for (const [rawKey, rawVal] of Object.entries(rec)) {
    const camel = rawKey.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    const kebab = rawKey.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    if (rawVal && typeof rawVal === "object" && !Array.isArray(rawVal)) {
      flatten(rawVal, into);
    } else {
      into[rawKey] = rawVal;
      into[camel] = rawVal;
      into[kebab] = rawVal;
    }
  }
  return into;
}

function formatAddress(row: Record<string, unknown>): string {
  const parts = [
    str(row, "address"),
    str(row, "addressLine1", "address1"),
    str(row, "addressLine2", "address2"),
    str(row, "addressLine3", "address3"),
    str(row, "addressLine4", "address4"),
    str(row, "postTown", "posttown"),
    str(row, "postcode")
  ].filter(Boolean);
  const unique: string[] = [];
  for (const p of parts) {
    if (!unique.some((u) => u.toLowerCase() === p.toLowerCase())) unique.push(p);
  }
  return unique.join(", ");
}

function mapHit(row: Record<string, unknown>): EpcSearchHit | null {
  const lmkKey =
    str(row, "certificateNumber", "certificate_number", "lmk-key", "lmk_key");
  if (!lmkKey) return null;
  return {
    lmkKey,
    address: formatAddress(row),
    address1: str(row, "addressLine1", "address1"),
    address2: str(row, "addressLine2", "address2"),
    address3: str(row, "addressLine3", "address3"),
    posttown: str(row, "postTown", "posttown"),
    postcode: str(row, "postcode"),
    propertyType: str(row, "property-type", "propertyType"),
    builtForm: str(row, "built-form", "builtForm"),
    constructionAgeBand: str(row, "construction-age-band", "constructionAgeBand"),
    totalFloorArea: str(row, "total-floor-area", "totalFloorArea"),
    currentEnergyRating: str(
      row,
      "current-energy-rating",
      "currentEnergyRating",
      "currentEnergyEfficiencyBand"
    )
  };
}

async function searchDomestic(
  params: Record<string, string>,
  size = 100
): Promise<EpcSearchHit[]> {
  const out: EpcSearchHit[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= 3; page++) {
    const qs = new URLSearchParams({
      ...params,
      page_size: String(size),
      current_page: String(page)
    });
    const data = await epcGet(`domestic/search?${qs.toString()}`);
    const rows = searchRows(data);
    if (rows.length === 0) break;
    for (const raw of rows) {
      const hit = mapHit(raw);
      if (!hit || seen.has(hit.lmkKey)) continue;
      seen.add(hit.lmkKey);
      out.push(hit);
    }
    if (rows.length < size) break;
  }
  return out;
}

export async function searchEpcByPostcode(
  postcode: string,
  size = 100
): Promise<EpcSearchHit[]> {
  const compact = postcode.replace(/\s+/g, "");
  if (!compact) return [];
  return searchDomestic({ postcode: postcode.trim() }, size);
}

export async function searchEpcByAddress(
  address: string
): Promise<EpcSearchHit[]> {
  const q = address.trim();
  if (q.length < 4) return [];
  return searchDomestic({ address: q }, 40);
}

const UK_POSTCODE_IN_TEXT =
  /\b[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}\b/i;

function houseNumbersFromAddress(address: string): string[] {
  const withoutPc = address.replace(UK_POSTCODE_IN_TEXT, " ");
  const head = withoutPc.split(",")[0] ?? withoutPc;
  return [...head.matchAll(/\d+[a-z]?/gi)].map((m) => m[0].toLowerCase());
}

/** Pick the register row that matches a typed / OSM address, or null. */
export function pickEpcHitForAddress(
  hits: EpcSearchHit[],
  address: string
): EpcSearchHit | null {
  if (hits.length === 0 || !address.trim()) return null;
  const numbers = houseNumbersFromAddress(address);
  const stop = new Set([
    "the",
    "and",
    "for",
    "flat",
    "floor",
    "unit",
    "london",
    "cardiff"
  ]);
  const tokens = address
    .replace(UK_POSTCODE_IN_TEXT, " ")
    .toLowerCase()
    .replace(/[,;]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !/^\d/.test(t) && !stop.has(t));

  let best: EpcSearchHit | null = null;
  let bestScore = 0;
  for (const hit of hits) {
    const hay = `${hit.address1} ${hit.address2} ${hit.address}`.toLowerCase();
    let score = 0;
    for (const n of numbers) {
      if (new RegExp(`(^|\\D)${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\D|$)`, "i").test(hay)) {
        score += 5;
      }
    }
    for (const token of tokens) {
      if (hay.includes(token)) score += 1;
    }
    if (score > bestScore) {
      best = hit;
      bestScore = score;
    }
  }
  if (numbers.length > 0 && bestScore < 5) return null;
  if (numbers.length === 0 && bestScore < 2) return null;
  return best;
}

export function epcHasCertificate(
  epc: PropertyEpcSummary | null | undefined
): boolean {
  if (!epc?.lmkKey || epc.lmkKey.startsWith("osm:")) return false;
  return Boolean(
    epc.currentEnergyRating ||
      epc.walls ||
      epc.roof ||
      epc.totalFloorArea
  );
}

export function epcFitsAddress(
  epc: PropertyEpcSummary | null | undefined,
  address: string
): boolean {
  if (!epcHasCertificate(epc) || !epc) return false;
  const pcA = (address.match(UK_POSTCODE_IN_TEXT)?.[0] || "")
    .replace(/\s+/g, "")
    .toLowerCase();
  const pcB = (epc.postcode || "").replace(/\s+/g, "").toLowerCase();
  if (pcA && pcB && pcA !== pcB) return false;
  return (
    pickEpcHitForAddress(
      [
        {
          lmkKey: epc.lmkKey,
          address: epc.address,
          address1: epc.address,
          address2: "",
          address3: "",
          posttown: "",
          postcode: epc.postcode,
          propertyType: epc.propertyType || "",
          builtForm: epc.builtForm || "",
          constructionAgeBand: epc.constructionAgeBand || "",
          totalFloorArea: "",
          currentEnergyRating: epc.currentEnergyRating || ""
        }
      ],
      address
    ) !== null
  );
}

export function mapEpcPropertyType(hit: {
  propertyType: string;
  builtForm: string;
}): string | null {
  const type = `${hit.propertyType} ${hit.builtForm}`.toLowerCase();
  if (/\bflat\b|\bmaisonette\b|\bapartment\b/.test(type)) {
    return "flat/apartment";
  }
  if (/end-?terrace|end terrace/.test(type)) return "end-of-terrace dwelling";
  if (/mid-?terrace|mid terrace/.test(type)) return "mid-terrace dwelling";
  if (/semi/.test(type)) return "semi-detached dwelling";
  if (/detached/.test(type)) return "detached dwelling";
  if (/hotel/.test(type)) return "hotel";
  if (/commercial|office|retail/.test(type)) return "commercial premises";
  return null;
}

const SAP_AGE_BAND: Record<string, string> = {
  A: "before 1900",
  B: "1900–1929",
  C: "1930–1949",
  D: "1950–1966",
  E: "1967–1975",
  F: "1976–1982",
  G: "1983–1990",
  H: "1991–1995",
  I: "1996–2002",
  J: "2003–2006",
  K: "2007–2011",
  L: "2012 onwards"
};

const TENURE_LABEL: Record<string, string> = {
  "1": "Owner-occupied",
  "2": "Rented (social)",
  "3": "Rented (private)"
};

const EFF_LABEL = ["", "Very poor", "Poor", "Average", "Good", "Very good"];

function sapBand(score: number | null): string {
  if (score == null) return "";
  if (score >= 92) return "A";
  if (score >= 81) return "B";
  if (score >= 69) return "C";
  if (score >= 55) return "D";
  if (score >= 39) return "E";
  if (score >= 21) return "F";
  if (score >= 1) return "G";
  return "";
}

function componentLine(value: unknown): { desc: string; eff: string } {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  const descs: string[] = [];
  let eff = "";
  for (const item of items) {
    const rec = asRecord(item);
    if (!rec) continue;
    const d =
      typeof rec.description === "string" ? rec.description.trim() : "";
    if (d) descs.push(d);
    if (!eff) {
      const n = Number(rec.energy_efficiency_rating);
      if (Number.isFinite(n) && n >= 1 && n <= 5) eff = EFF_LABEL[n] ?? "";
    }
  }
  return { desc: descs.join("; "), eff };
}

function constructionAge(row: Record<string, unknown>): string {
  const parts = Array.isArray(row.sap_building_parts)
    ? row.sap_building_parts
    : [];
  for (const part of parts) {
    const rec = asRecord(part);
    if (!rec) continue;
    const nested = [
      rec.construction_age_band,
      asRecord(rec.sap_room_in_roof)?.construction_age_band,
      asRecord(rec.sap_wall)?.construction_age_band
    ];
    for (const raw of nested) {
      const code = typeof raw === "string" ? raw.trim().toUpperCase() : "";
      if (SAP_AGE_BAND[code]) return SAP_AGE_BAND[code];
      if (code) return code;
    }
  }
  return "";
}

export function epcSummaryFromCertificate(
  row: Record<string, unknown>
): PropertyEpcSummary {
  const flat = flatten(row);
  const hit = mapHit(flat);
  const walls = componentLine(row.walls);
  const roof = componentLine(row.roofs ?? row.roof);
  const floor = componentLine(row.floors ?? row.floor);
  const windows = componentLine(row.window ?? row.windows);
  const heating = componentLine(row.main_heating ?? row.mainHeating);
  const hotWater = componentLine(row.hot_water ?? row.hotWater);
  const lighting = componentLine(row.lighting);
  const energy = asRecord(row.sap_energy_source);
  const tenureCode = String(row.tenure ?? flat.tenure ?? "").trim();
  const score =
    num(row, "energy_rating_current", "energyRatingCurrent") ??
    num(flat, "current-energy-efficiency", "currentEnergyEfficiency");
  const potentialScore =
    num(row, "energy_rating_potential", "energyRatingPotential");
  const extensions =
    num(row, "extensions_count", "extensionsCount") ??
    num(flat, "extension-count", "extensions-count", "extensionsCount");
  const dwelling = str(row, "dwelling_type", "dwellingType");
  return {
    lmkKey: hit?.lmkKey || str(flat, "lmk-key", "certificateNumber"),
    address: hit?.address || formatAddress({
      ...flat,
      addressLine1: row.address_line_1 ?? flat.addressLine1,
      addressLine2: row.address_line_2 ?? flat.addressLine2,
      postTown: row.post_town ?? flat.postTown,
      postcode: row.postcode ?? flat.postcode
    }),
    postcode: str(row, "postcode") || str(flat, "postcode"),
    inspectionDate:
      str(row, "inspection_date", "inspectionDate") ||
      str(flat, "inspection-date", "inspectionDate"),
    lodgementDate:
      str(row, "registration_date", "registrationDate") ||
      str(flat, "lodgement-date", "lodgementDate", "registrationDate"),
    constructionAgeBand:
      constructionAge(row) ||
      str(flat, "construction-age-band", "construction_age_band", "constructionAgeBand"),
    propertyType:
      dwelling ||
      str(flat, "property-type", "propertyType"),
    builtForm: str(flat, "built-form", "builtForm"),
    walls: walls.desc || str(flat, "walls-description", "wallsDescription"),
    wallsEnergy: walls.eff || str(flat, "walls-energy-eff", "wallsEnergy"),
    roof: roof.desc || str(flat, "roof-description", "roofDescription"),
    roofEnergy: roof.eff || str(flat, "roof-energy-eff", "roofEnergy"),
    floor: floor.desc || str(flat, "floor-description", "floorDescription"),
    floorEnergy: floor.eff || str(flat, "floor-energy-eff", "floorEnergy"),
    windows: windows.desc || str(flat, "windows-description", "windowsDescription"),
    windowsEnergy: windows.eff || str(flat, "windows-energy-eff", "windowsEnergy"),
    glazedType: str(flat, "glazed-type", "glazedType"),
    glazedArea: str(flat, "glazed-area", "glazedArea"),
    mainHeating:
      heating.desc ||
      str(flat, "mainheat-description", "mainheatDescription", "mainHeating"),
    mainHeatingEnergy:
      heating.eff ||
      str(flat, "mainheat-energy-eff", "mainHeatingEnergy"),
    hotWater:
      hotWater.desc ||
      str(flat, "hotwater-description", "hotwaterDescription", "hotWater"),
    lighting:
      lighting.desc ||
      str(flat, "lighting-description", "lightingDescription"),
    mainFuel: str(flat, "main-fuel", "mainFuel"),
    tenure: TENURE_LABEL[tenureCode] || (tenureCode && !/^\d+$/.test(tenureCode) ? tenureCode : ""),
    currentEnergyRating:
      sapBand(score) ||
      str(flat, "current-energy-rating", "currentEnergyRating", "currentEnergyEfficiencyBand"),
    potentialEnergyRating:
      sapBand(potentialScore) ||
      str(flat, "potential-energy-rating", "potentialEnergyRating", "potentialEnergyEfficiencyBand"),
    currentEnergyEfficiency: score,
    totalFloorArea:
      num(row, "total_floor_area", "totalFloorArea") ??
      num(flat, "total-floor-area", "totalFloorArea"),
    extensionsCount: extensions,
    habitableRoomCount:
      num(row, "habitable_room_count", "habitableRoomCount") ??
      num(flat, "number-habitable-rooms", "habitableRoomCount"),
    heatedRoomCount:
      num(row, "heated_room_count", "heatedRoomCount") ??
      num(flat, "number-heated-rooms", "heatedRoomCount"),
    floorHeight: num(flat, "floor-height", "floorHeight"),
    mainsGas: boolish(
      energy ?? {},
      "mains_gas",
      "mainsGas"
    ) ?? boolish(flat, "mains-gas-flag", "mainsGasFlag", "mainsGas"),
    solarWaterHeating: boolish(
      row,
      "solar_water_heating",
      "solarWaterHeating"
    ),
    photoSupply: num(flat, "photo-supply", "photoSupply"),
    mechanicalVentilation: str(
      flat,
      "mechanical-ventilation",
      "mechanicalVentilation"
    ),
    queriedAt: Date.now()
  };
}

export async function fetchEpcCertificate(
  lmkKey: string
): Promise<PropertyEpcSummary> {
  if (!lmkKey || lmkKey.startsWith("osm:")) {
    throw new Error("No energy certificate was returned.");
  }
  const data = await epcGet(
    `certificate?certificate_number=${encodeURIComponent(lmkKey)}`
  );
  const inner = unwrapData(data);
  const row = Array.isArray(inner)
    ? asRecord(inner[0])
    : asRecord(inner) ?? asRecord(data);
  if (!row) {
    throw new Error("No energy certificate was returned.");
  }
  const summary = epcSummaryFromCertificate(row);
  return { ...summary, lmkKey: summary.lmkKey || lmkKey };
}

export async function fetchEpcForHit(
  hit: EpcSearchHit
): Promise<PropertyEpcSummary> {
  if (hit.lmkKey.startsWith("osm:")) {
    throw new Error("No energy certificate was returned.");
  }
  try {
    const summary = await fetchEpcCertificate(hit.lmkKey);
    return {
      ...summary,
      lmkKey: summary.lmkKey || hit.lmkKey,
      address: summary.address || hit.address,
      postcode: summary.postcode || hit.postcode,
      currentEnergyRating:
        summary.currentEnergyRating || hit.currentEnergyRating,
      constructionAgeBand:
        summary.constructionAgeBand || hit.constructionAgeBand,
      propertyType: summary.propertyType || hit.propertyType,
      builtForm: summary.builtForm || hit.builtForm,
      totalFloorArea:
        summary.totalFloorArea ??
        (hit.totalFloorArea ? Number(hit.totalFloorArea) || null : null)
    };
  } catch {
    return epcSummaryFromCertificate({
      certificateNumber: hit.lmkKey,
      address: hit.address,
      postcode: hit.postcode,
      postTown: hit.posttown,
      addressLine1: hit.address1,
      addressLine2: hit.address2,
      addressLine3: hit.address3,
      "property-type": hit.propertyType,
      "built-form": hit.builtForm,
      "construction-age-band": hit.constructionAgeBand,
      "total-floor-area": hit.totalFloorArea,
      "current-energy-rating": hit.currentEnergyRating
    });
  }
}
