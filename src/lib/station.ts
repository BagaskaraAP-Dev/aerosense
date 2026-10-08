// Hanya dipakai di route handler (server) — token WAQI tidak pernah sampai ke browser.
// Data stasiun darat dari jaringan World Air Quality Index (aqicn.org). Untuk Palembang sumbernya
// antara lain stasiun BMKG Talang Betutu dan Musi 2; nilainya sudah dalam skala US AQI.

import type { Station } from "./weather";

const API = "https://api.waqi.info";
/** Stasiun lebih jauh dari ini sudah tidak mewakili udara di lokasi pengguna. */
const MAX_KM = 30;
/** Pembacaan lebih tua dari ini dianggap stasiun sedang mati. */
const MAX_AGE_MS = 3 * 60 * 60 * 1000;

export function stationEnabled(): boolean {
  return Boolean(process.env.WAQI_TOKEN);
}

type Candidate = { uid: number; lat: number; lon: number; aqi: number; name: string; time: string; km: number };

/** Stasiun aktif terdekat dalam radius MAX_KM, atau null kalau tidak ada. */
export async function nearestStation(lat: number, lon: number): Promise<Station | null> {
  const token = process.env.WAQI_TOKEN!;
  const cands = await candidates(lat, lon, token).catch(() => []);

  for (const c of cands) {
    const detail = await feed(`@${c.uid}`, token).catch(() => null);
    // Stasiun jaringan lain (mis. sensor AirNet) kadang tidak punya feed — data peta tetap cukup.
    const station = detail ? toStation(detail, lat, lon) : null;
    if (station) return station;
    if (fresh(c.time)) return { name: c.name, aqi: c.aqi, time: c.time, km: c.km, dominant: null, url: null, attribution: "World Air Quality Index Project" };
  }

  // Cadangan kalau endpoint peta gagal: feed stasiun terdekat versi WAQI sendiri.
  const geo = await feed(`geo:${lat};${lon}`, token).catch(() => null);
  return geo ? toStation(geo, lat, lon) : null;
}

async function candidates(lat: number, lon: number, token: string): Promise<Candidate[]> {
  const d = 0.3; // ± 33 km
  const j = await get(`${API}/v2/map/bounds?latlng=${lat - d},${lon - d},${lat + d},${lon + d}&networks=all&token=${token}`);
  const items: { uid: number; lat: number; lon: number; aqi: string; station?: { name?: string; time?: string } }[] = Array.isArray(j.data) ? j.data : [];
  return items
    .map((s) => ({
      uid: s.uid,
      lat: s.lat,
      lon: s.lon,
      aqi: Number(s.aqi),
      name: s.station?.name ?? "Stasiun",
      time: s.station?.time ?? "",
      km: km(lat, lon, s.lat, s.lon),
    }))
    .filter((s) => Number.isFinite(s.aqi) && s.km <= MAX_KM && fresh(s.time))
    .sort((a, b) => a.km - b.km);
}

type Feed = {
  aqi: number | string;
  city: { geo: [number, number]; name: string; url?: string };
  dominentpol?: string;
  time: { iso?: string };
  attributions?: { name: string; url?: string }[];
};

async function feed(path: string, token: string): Promise<Feed> {
  const j = await get(`${API}/feed/${path}/?token=${token}`);
  return j.data as Feed;
}

function toStation(f: Feed, lat: number, lon: number): Station | null {
  const aqi = Number(f.aqi);
  const time = f.time?.iso ?? "";
  const geo = f.city?.geo;
  if (!Number.isFinite(aqi) || !geo || !fresh(time)) return null;
  const dist = km(lat, lon, geo[0], geo[1]);
  if (dist > MAX_KM) return null;
  // Atribusi pertama adalah pemilik alat ukur (mis. BMKG); WAQI selalu di urutan terakhir.
  const owner = f.attributions?.find((a) => !/waqi|World Air Quality/i.test(a.name));
  return {
    name: cleanName(f.city.name),
    aqi,
    time,
    km: dist,
    dominant: f.dominentpol ?? null,
    url: f.city.url ?? null,
    attribution: owner ? shortOwner(owner.name) : "World Air Quality Index Project",
  };
}

/** "Indonesian Department of Meteorology, Climatology and Geophysics (BMKG)" → "BMKG". */
function shortOwner(name: string): string {
  return /\(([A-Z]{2,})\)\s*$/.exec(name)?.[1] ?? name;
}

async function get(url: string) {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} dari WAQI`);
  const j = await res.json();
  if (j.status !== "ok") throw new Error(`WAQI: ${j.data}`);
  return j;
}

function fresh(iso: string): boolean {
  const t = Date.parse(iso);
  return Number.isFinite(t) && Date.now() - t < MAX_AGE_MS;
}

/** "Talang Betutu, Palembang, Indonesia" → "Talang Betutu, Palembang". */
function cleanName(name: string): string {
  return name.replace(/,\s*Indonesia$/i, "");
}

/** Jarak haversine dalam km. */
function km(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}
