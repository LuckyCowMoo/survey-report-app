/** Postcodes.io helpers for GPS → postcode and postcode validation. */

const POSTCODES_URL = "https://api.postcodes.io";

export type NearbyPostcode = {
  postcode: string;
  latitude: number;
  longitude: number;
  distance: number;
  parish?: string;
  adminDistrict?: string;
  adminWard?: string;
};

export type PostcodeDetails = {
  postcode: string;
  latitude: number;
  longitude: number;
  parish?: string;
  adminDistrict?: string;
  adminWard?: string;
  region?: string;
  country?: string;
};

export const UK_POSTCODE_RE =
  /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;

export function extractUkPostcode(text: string): string | null {
  const m = UK_POSTCODE_RE.exec(text.trim().toUpperCase());
  if (!m) return null;
  return `${m[1]} ${m[2]}`;
}

export function formatUkPostcode(value: string): string {
  const extracted = extractUkPostcode(value);
  if (extracted) return extracted;
  return value.trim().toUpperCase();
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Postcodes.io ${res.status}`);
  }
  return (await res.json()) as T;
}

type PostcodeResult = {
  status: number;
  result: {
    postcode: string;
    latitude: number;
    longitude: number;
    parish?: string;
    admin_district?: string;
    admin_ward?: string;
    region?: string;
    country?: string;
    distance?: number;
  } | null;
};

type NearestResult = {
  status: number;
  result:
    | Array<{
        postcode: string;
        latitude: number;
        longitude: number;
        parish?: string;
        admin_district?: string;
        admin_ward?: string;
        distance?: number;
      }>
    | null;
};

function toDetails(
  row: NonNullable<PostcodeResult["result"]> & { distance?: number }
): PostcodeDetails & { distance?: number } {
  return {
    postcode: row.postcode,
    latitude: row.latitude,
    longitude: row.longitude,
    parish: row.parish,
    adminDistrict: row.admin_district,
    adminWard: row.admin_ward,
    region: row.region,
    country: row.country,
    distance: row.distance
  };
}

export async function lookupPostcode(
  postcode: string
): Promise<PostcodeDetails | null> {
  const formatted = formatUkPostcode(postcode).replace(/\s+/g, "");
  if (!formatted) return null;
  try {
    const data = await getJson<PostcodeResult>(
      `${POSTCODES_URL}/postcodes/${encodeURIComponent(formatted)}`
    );
    if (!data.result) return null;
    return toDetails(data.result);
  } catch {
    return null;
  }
}

export async function nearestPostcodes(
  latitude: number,
  longitude: number,
  limit = 5
): Promise<NearbyPostcode[]> {
  const url = `${POSTCODES_URL}/postcodes?lon=${encodeURIComponent(String(longitude))}&lat=${encodeURIComponent(String(latitude))}&limit=${limit}`;
  const data = await getJson<NearestResult>(url);
  if (!data.result) return [];
  return data.result.map((row) => ({
    postcode: row.postcode,
    latitude: row.latitude,
    longitude: row.longitude,
    distance: row.distance ?? 0,
    parish: row.parish,
    adminDistrict: row.admin_district,
    adminWard: row.admin_ward
  }));
}

export function readDevicePosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not available on this device."));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 30000
    });
  });
}

export type AddressSuggestion = {
  id: string;
  address: string;
  postcode: string;
};

type NominatimHit = {
  osm_id?: number;
  lat?: string;
  lon?: string;
  addresstype?: string;
  display_name?: string;
  address?: {
    postcode?: string;
    house_number?: string;
    road?: string;
    suburb?: string;
    city?: string;
    town?: string;
    village?: string;
  };
};

function nominatimAddress(row: NominatimHit): string {
  const a = row.address;
  if (a) {
    const parts = [
      [a.house_number, a.road].filter(Boolean).join(" "),
      a.suburb,
      a.city || a.town || a.village,
      a.postcode
    ].filter((p) => p && String(p).trim());
    if (parts.length > 0) return parts.join(", ");
  }
  return (row.display_name ?? "").trim();
}

function pushUnique(
  out: AddressSuggestion[],
  seen: Set<string>,
  row: AddressSuggestion
) {
  const key = row.address.toLowerCase();
  if (!row.address || seen.has(key)) return;
  seen.add(key);
  out.push(row);
}

async function nominatimPostcodeHits(
  formatted: string
): Promise<(NominatimHit & { lat?: string; lon?: string })[]> {
  const url =
    `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=30` +
    `&countrycodes=gb&q=${encodeURIComponent(formatted)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return [];
  const rows = (await res.json()) as NominatimHit[];
  return Array.isArray(rows) ? rows : [];
}

type OverpassEl = {
  type?: string;
  id?: number;
  tags?: Record<string, string>;
};

async function overpassHousesNear(
  lat: number,
  lon: number,
  formatted: string
): Promise<AddressSuggestion[]> {
  const query =
    `[out:json][timeout:20];nwr["addr:housenumber"](around:220,${lat},${lon});out tags 80;`;
  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    body: `data=${encodeURIComponent(query)}`
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { elements?: OverpassEl[] };
  const compact = formatted.replace(/\s+/g, "").toUpperCase();
  const exact: AddressSuggestion[] = [];
  const nearby: AddressSuggestion[] = [];
  const seenExact = new Set<string>();
  const seenNearby = new Set<string>();
  for (const el of data.elements ?? []) {
    const tags = el.tags ?? {};
    const number = tags["addr:housenumber"]?.trim();
    const street = tags["addr:street"]?.trim();
    if (!number || !street) continue;
    const taggedPc = tags["addr:postcode"]?.trim();
    const city =
      tags["addr:city"] || tags["addr:town"] || tags["addr:suburb"] || "";
    const pc = taggedPc || formatted;
    const address = [number, street, city, pc].filter(Boolean).join(", ");
    const row = {
      id: `osm:${el.type ?? "way"}:${el.id ?? address}`,
      address,
      postcode: pc
    };
    if (taggedPc) {
      const tagCompact = taggedPc.replace(/\s+/g, "").toUpperCase();
      if (tagCompact !== compact) continue;
      pushUnique(exact, seenExact, row);
    } else {
      pushUnique(nearby, seenNearby, row);
    }
  }
  return exact.length > 0 ? exact : nearby;
}

/** Street-level fallback when the EPC register is unavailable. */
export async function searchAddressesByPostcode(
  postcode: string
): Promise<AddressSuggestion[]> {
  const formatted = formatUkPostcode(postcode);
  if (!formatted) return [];

  let lat: number | null = null;
  let lon: number | null = null;
  try {
    const details = await lookupPostcode(formatted);
    if (details) {
      lat = details.latitude;
      lon = details.longitude;
    }
  } catch {
    /* continue with OSM */
  }

  let nominatim: NominatimHit[] = [];
  try {
    nominatim = await nominatimPostcodeHits(formatted);
  } catch {
    nominatim = [];
  }
  if (lat == null || lon == null) {
    const pin = nominatim.find((row) => row.lat && row.lon);
    if (pin?.lat && pin.lon) {
      lat = Number(pin.lat);
      lon = Number(pin.lon);
    }
  }

  if (lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon)) {
    try {
      const houses = await overpassHousesNear(lat, lon, formatted);
      if (houses.length > 0) return houses;
    } catch {
      /* OSM display names below */
    }
  }

  const out: AddressSuggestion[] = [];
  const seen = new Set<string>();
  for (const row of nominatim) {
    if (row.addresstype === "postcode") continue;
    const address = nominatimAddress(row);
    pushUnique(out, seen, {
      id: `osm:${row.osm_id ?? address}`,
      address,
      postcode: row.address?.postcode || formatted
    });
  }
  return out;
}

export async function reverseGeocodeAddress(
  latitude: number,
  longitude: number
): Promise<string | null> {
  const url =
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1` +
    `&lat=${encodeURIComponent(String(latitude))}&lon=${encodeURIComponent(String(longitude))}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const row = (await res.json()) as NominatimHit;
  return nominatimAddress(row) || null;
}
