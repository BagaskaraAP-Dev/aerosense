// Data cuaca & kualitas udara realtime dari Open-Meteo (gratis, tanpa API key).
// Kualitas udara dari model CAMS (Copernicus), dikoreksi dengan stasiun darat bila ada (lihat applyStation).

export type Place = {
  name: string;
  region?: string;
  lat: number;
  lon: number;
  source: "gps" | "search" | "default";
};

export const PALEMBANG: Place = {
  name: "Palembang",
  region: "Sumatera Selatan",
  lat: -2.9761,
  lon: 104.7754,
  source: "default",
};

/** Wilayah Kota Palembang yang koordinatnya sudah dicek ke layanan geocoding; muncul di pilihan lokasi. */
export const PALEMBANG_AREAS: Place[] = [
  { name: "Kertapati", region: "Kota Palembang", lat: -3.02165, lon: 104.75033, source: "search" },
  { name: "Plaju", region: "Kota Palembang", lat: -2.9893, lon: 104.8019, source: "search" },
];

export type SkyKind = "clear" | "partly" | "cloudy" | "fog" | "drizzle" | "rain" | "storm" | "snow" | "haze";

export type Current = {
  time: string;
  temp: number;
  feels: number;
  humidity: number;
  isDay: boolean;
  code: number;
  wind: number;
  windDir: number;
  /** Meter. Turun drastis saat kabut asap tebal. */
  visibility: number;
};

/** Pembacaan stasiun pemantau darat terdekat (jaringan WAQI, skala US AQI). */
export type Station = {
  name: string;
  aqi: number;
  /** Waktu pembacaan, ISO dengan zona waktu. */
  time: string;
  km: number;
  /** Polutan dominan menurut stasiun, mis. "pm25". */
  dominant: string | null;
  url: string | null;
  /** Pemilik alat ukur, mis. BMKG. */
  attribution: string;
};

export type Air = {
  time: string;
  /** AQI saat ini: hasil ukur stasiun bila ada, kalau tidak NowCast dari model (lihat bagian AQI di bawah). */
  aqi: number;
  /** AQI NowCast dari model CAMS, untuk pembanding. */
  modelAqi: number;
  /** Stasiun yang menjadi sumber `aqi`; null berarti angkanya dari model. */
  station: Station | null;
  dominant: "PM2.5" | "PM10";
  pm25: number;
  pm10: number;
  /** Rata-rata 24 jam terakhir — dasar yang benar untuk dibandingkan dengan pedoman harian WHO. */
  pm25Avg24: number | null;
  pm10Avg24: number | null;
  co: number;
  o3: number;
  no2: number;
};

export type HourPoint = {
  time: string;
  pop: number;
  aqi: number | null;
};

export type DayPoint = {
  date: string;
  code: number;
  max: number;
  min: number;
  pop: number;
  /** AQI tertinggi hari itu; null di luar jangkauan model CAMS (± 5 hari). */
  aqiMax: number | null;
};

export type Snapshot = {
  fetchedAt: number;
  timezone: string;
  current: Current;
  air: Air | null;
  /** 24 jam ke depan, mulai jam sekarang. */
  hourly: HourPoint[];
  daily: DayPoint[];
  simulated?: boolean;
};

const FORECAST = "https://api.open-meteo.com/v1/forecast";
const AIR = "https://air-quality-api.open-meteo.com/v1/air-quality";

export async function fetchSnapshot(place: Place, signal?: AbortSignal): Promise<Snapshot> {
  const coords = `latitude=${place.lat}&longitude=${place.lon}&timezone=auto&forecast_days=7`;
  // Hanya kolom yang ditampilkan, supaya unduhan tiap refresh kecil.
  const wxUrl =
    `${FORECAST}?${coords}` +
    "&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m,wind_direction_10m,visibility" +
    "&hourly=precipitation_probability" +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max";
  // past_days=1: NowCast butuh 12 jam ke belakang, rata-rata WHO butuh 24 jam.
  const airUrl = `${AIR}?${coords}&past_days=1&current=pm2_5,pm10,carbon_monoxide,ozone,nitrogen_dioxide&hourly=pm2_5,pm10`;

  const [wxRes, airRes] = await Promise.allSettled([
    fetch(wxUrl, { signal }).then(ok),
    fetch(airUrl, { signal }).then(ok),
  ]);
  if (wxRes.status === "rejected") throw wxRes.reason;

  const wx = wxRes.value;
  const aq = airRes.status === "fulfilled" ? airRes.value : null;
  const c = wx.current;
  const nowHour = c.time.slice(0, 13);

  const current: Current = {
    time: c.time,
    temp: c.temperature_2m,
    feels: c.apparent_temperature,
    humidity: c.relative_humidity_2m,
    isDay: c.is_day === 1,
    code: c.weather_code,
    wind: c.wind_speed_10m,
    windDir: c.wind_direction_10m,
    visibility: c.visibility ?? 0,
  };

  // AQI per jam untuk seluruh deret (kemarin s.d. ± 5 hari ke depan).
  const aqiByHour = new Map<string, number>();
  let air: Air | null = null;
  if (aq?.hourly && aq.current) {
    const t: string[] = aq.hourly.time;
    const pm25: (number | null)[] = aq.hourly.pm2_5;
    const pm10: (number | null)[] = aq.hourly.pm10;
    t.forEach((time, i) => {
      const a = aqiAt(pm25, pm10, i);
      if (a) aqiByHour.set(time, a.aqi);
    });

    const i = t.findIndex((time) => time.slice(0, 13) === nowHour);
    const now = i >= 0 ? aqiAt(pm25, pm10, i) : null;
    if (now) {
      air = {
        time: aq.current.time,
        aqi: now.aqi,
        modelAqi: now.aqi,
        station: null,
        dominant: now.dominant,
        pm25: aq.current.pm2_5,
        pm10: aq.current.pm10,
        pm25Avg24: mean(pm25, i - 23, i),
        pm10Avg24: mean(pm10, i - 23, i),
        co: aq.current.carbon_monoxide,
        o3: aq.current.ozone,
        no2: aq.current.nitrogen_dioxide,
      };
    }
  }

  // 24 jam mulai dari jam sekarang (waktu lokal lokasi).
  const h = wx.hourly;
  const start = Math.max(0, h.time.findIndex((t: string) => t.slice(0, 13) === nowHour));
  const hourly: HourPoint[] = h.time.slice(start, start + 24).map((t: string, k: number) => ({
    time: t,
    pop: h.precipitation_probability[start + k] ?? 0,
    aqi: aqiByHour.get(t) ?? null,
  }));

  const d = wx.daily;
  const daily: DayPoint[] = d.time.map((date: string, i: number) => ({
    date,
    code: d.weather_code[i],
    max: d.temperature_2m_max[i],
    min: d.temperature_2m_min[i],
    pop: d.precipitation_probability_max[i] ?? 0,
    aqiMax: dailyAqiMax(aqiByHour, date, nowHour, i === 0),
  }));

  return { fetchedAt: Date.now(), timezone: wx.timezone, current, air, hourly, daily };
}

/** Stasiun darat aktif terdekat lewat /api/station; null bila fitur mati, tidak ada stasiun, atau gagal. */
export async function fetchStation(place: Place, signal?: AbortSignal): Promise<{ enabled: boolean; station: Station | null }> {
  try {
    const j = await fetch(`/api/station?lat=${place.lat}&lon=${place.lon}`, { signal }).then(ok);
    return { enabled: !!j.enabled, station: j.station ?? null };
  } catch {
    return { enabled: false, station: null };
  }
}

/**
 * Pakai hasil ukur stasiun sebagai AQI "sekarang". Model CAMS bisa meleset jauh saat asap karhutla
 * (resolusi ± 40 km), jadi selisihnya dengan stasiun dipakai untuk mengoreksi prakiraan 24 jam ke depan:
 * bentuk naik-turunnya tetap dari model, levelnya mengikuti hasil ukur.
 */
export function applyStation(s: Snapshot, st: Station | null): Snapshot {
  if (!st || !s.air) return s;
  const bias = st.aqi - s.air.modelAqi;
  const hourly = s.hourly.map((p) => (p.aqi != null ? { ...p, aqi: Math.max(0, Math.min(500, Math.round(p.aqi + bias))) } : p));
  // Hanya AQI maks hari ini yang dihitung ulang; hari-hari berikutnya di luar jangkauan koreksi.
  const [first, ...rest] = s.daily;
  const todayHours = hourly.filter((p) => p.time.startsWith(first.date) && p.aqi != null).map((p) => p.aqi!);
  const today = { ...first, aqiMax: todayHours.length ? Math.max(st.aqi, ...todayHours) : st.aqi };
  return { ...s, air: { ...s.air, aqi: st.aqi, station: st }, hourly, daily: [today, ...rest] };
}

async function ok(res: Response) {
  if (!res.ok) throw new Error(`HTTP ${res.status} dari ${new URL(res.url).host}`);
  return res.json();
}

function mean(series: (number | null)[], from: number, to: number): number | null {
  const vals = series.slice(Math.max(0, from), to + 1).filter((v): v is number => v != null);
  return vals.length >= 18 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

/** AQI tertinggi satu hari. Untuk hari ini hanya jam yang belum lewat yang dihitung. */
function dailyAqiMax(byHour: Map<string, number>, date: string, nowHour: string, isToday: boolean): number | null {
  let max = -1;
  let n = 0;
  for (const [t, v] of byHour) {
    if (!t.startsWith(date) || t.slice(0, 13) < nowHour) continue;
    max = Math.max(max, v);
    n++;
  }
  return n >= (isToday ? 1 : 12) ? max : null;
}

/* ---------- AQI (US EPA, breakpoint PM2.5 revisi 2024) ---------- */
// Open-Meteo menghitung us_aqi dari rata-rata 24 jam (PM) dan 8 jam (ozon), sehingga angkanya
// tertinggal berjam-jam: asap yang sudah menipis tetap terbaca "sangat tidak sehat". Di sini AQI
// dihitung ulang dengan NowCast — metode EPA untuk angka "saat ini" yang dipakai AirNow.

type Breakpoint = [cLo: number, cHi: number, iLo: number, iHi: number];

const PM25_BP: Breakpoint[] = [
  [0, 9, 0, 50],
  [9.1, 35.4, 51, 100],
  [35.5, 55.4, 101, 150],
  [55.5, 125.4, 151, 200],
  [125.5, 225.4, 201, 300],
  [225.5, 325.4, 301, 500],
];

const PM10_BP: Breakpoint[] = [
  [0, 54, 0, 50],
  [55, 154, 51, 100],
  [155, 254, 101, 150],
  [255, 354, 151, 200],
  [355, 424, 201, 300],
  [425, 604, 301, 500],
];

function subIndex(c: number, bps: Breakpoint[]): number {
  for (const [cLo, cHi, iLo, iHi] of bps) {
    if (c <= cHi) return Math.round(((iHi - iLo) / (cHi - cLo)) * (Math.max(c, cLo) - cLo) + iLo);
  }
  return 500;
}

/** NowCast EPA: rata-rata tertimbang 12 jam terakhir; makin cepat udara berubah, makin berat jam terbaru. */
export function nowcast(series: (number | null)[], i: number): number | null {
  const win: (number | null)[] = [];
  for (let k = 0; k < 12; k++) win.push(i - k >= 0 ? series[i - k] : null);
  if (win.slice(0, 3).filter((v) => v != null).length < 2) return null;

  const vals = win.filter((v): v is number => v != null);
  const max = Math.max(...vals);
  if (max <= 0) return 0;
  const w = Math.max(0.5, Math.min(...vals) / max);

  let num = 0;
  let den = 0;
  win.forEach((v, k) => {
    if (v == null) return;
    num += w ** k * v;
    den += w ** k;
  });
  return num / den;
}

function aqiAt(pm25: (number | null)[], pm10: (number | null)[], i: number): { aqi: number; dominant: Air["dominant"] } | null {
  const c25 = nowcast(pm25, i);
  if (c25 == null) return null;
  const a25 = subIndex(Math.floor(c25 * 10) / 10, PM25_BP);
  const c10 = nowcast(pm10, i);
  const a10 = c10 == null ? 0 : subIndex(Math.floor(c10), PM10_BP);
  return a10 > a25 ? { aqi: a10, dominant: "PM10" } : { aqi: a25, dominant: "PM2.5" };
}

// Skenario kabut asap untuk presentasi, supaya alur kamera bisa didemokan
// walaupun udara hari itu sedang bersih.
export function simulateHaze(s: Snapshot): Snapshot {
  const daily = s.daily.map((d, i) => ({ ...d, aqiMax: d.aqiMax == null ? null : Math.max(160, 268 - i * 25) }));
  return {
    ...s,
    simulated: true,
    current: { ...s.current, code: 45, visibility: 900 },
    air: {
      time: s.current.time,
      aqi: 268,
      modelAqi: 268,
      station: null,
      dominant: "PM2.5",
      pm25: 214.3,
      pm10: 236.8,
      pm25Avg24: 182.6,
      pm10Avg24: 201.4,
      co: 6120,
      o3: 61,
      no2: 18.4,
    },
    hourly: s.hourly.map((p, i) => ({ ...p, aqi: Math.max(160, 268 - i * 4) })),
    daily,
  };
}

export async function reverseGeocode(lat: number, lon: number): Promise<{ name: string; region?: string }> {
  // api.bigdatacloud.net sekarang mengalihkan endpoint gratis ini ke api-bdc.io; panggil langsung.
  const res = await fetch(
    `https://api-bdc.io/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=id`,
  );
  const j = await ok(res);
  return {
    name: j.city || j.locality || j.principalSubdivision || "Lokasi kamu",
    region: j.principalSubdivision || j.countryName,
  };
}

export async function searchPlaces(q: string, signal?: AbortSignal): Promise<Place[]> {
  const res = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=12&language=id`,
    { signal },
  );
  type Hit = { name: string; admin1?: string; admin2?: string; country?: string; country_code?: string; latitude: number; longitude: number };
  const hits: Hit[] = (await ok(res)).results ?? [];
  // Palembang dulu, lalu Sumatera Selatan, lalu Indonesia, baru dunia. Urutan asli dipertahankan dalam tiap kelompok.
  const tier = (h: Hit) =>
    /palembang/i.test(`${h.name} ${h.admin2 ?? ""}`) ? 0 : /sumatera selatan|south sumatra/i.test(h.admin1 ?? "") ? 1 : h.country_code === "ID" ? 2 : 3;
  return hits
    .map((h, i) => ({ h, i }))
    .sort((a, b) => tier(a.h) - tier(b.h) || a.i - b.i)
    .slice(0, 6)
    .map(({ h: r }) => ({
      name: r.name.replace(/^Kota /, ""),
      region: [r.admin2 && r.admin2 !== r.name ? r.admin2 : null, r.admin1, r.country].filter(Boolean).join(", "),
      lat: r.latitude,
      lon: r.longitude,
      source: "search" as const,
    }));
}

/* ---------- Kode cuaca WMO ---------- */

export function describeCode(code: number): { label: string; kind: SkyKind } {
  if (code === 0) return { label: "Cerah", kind: "clear" };
  if (code === 1) return { label: "Cerah berawan", kind: "partly" };
  if (code === 2) return { label: "Berawan sebagian", kind: "partly" };
  if (code === 3) return { label: "Mendung", kind: "cloudy" };
  if (code === 45 || code === 48) return { label: "Berkabut", kind: "fog" };
  if (code >= 51 && code <= 57) return { label: "Gerimis", kind: "drizzle" };
  if (code === 61 || code === 80) return { label: "Hujan ringan", kind: "rain" };
  if (code === 63 || code === 81) return { label: "Hujan sedang", kind: "rain" };
  if (code === 65 || code === 82) return { label: "Hujan lebat", kind: "rain" };
  if (code === 66 || code === 67) return { label: "Hujan beku", kind: "rain" };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { label: "Salju", kind: "snow" };
  if (code === 95) return { label: "Badai petir", kind: "storm" };
  if (code === 96 || code === 99) return { label: "Badai petir & es", kind: "storm" };
  return { label: "—", kind: "cloudy" };
}

/** Kondisi langit yang terlihat, memperhitungkan asap kalau udaranya pekat. */
export function skyOf(s: Snapshot): { label: string; kind: SkyKind } {
  const base = describeCode(s.current.code);
  const aqi = s.air?.aqi ?? 0;
  const wet = base.kind === "rain" || base.kind === "storm" || base.kind === "drizzle";
  if (aqi > 150 && !wet) return { label: "Udara berasap", kind: "haze" };
  return base;
}

/* ---------- Indeks kualitas udara (US EPA) ---------- */

export type AqiBand = {
  max: number;
  label: string;
  color: string;
  /** Warna teks yang terbaca di atas `color`. */
  onColor: string;
  /** Panduan tetap per kategori: masker, jendela, dan kelompok sensitif. */
  mask: string;
  room: string;
  sensitive: string;
};

const DARK = "#0b1315";
const LIGHT = "#ffffff";

export const AQI_BANDS: AqiBand[] = [
  {
    max: 50,
    label: "Baik",
    color: "#4fc3a1",
    onColor: DARK,
    mask: "Tidak perlu.",
    room: "Boleh dibuka.",
    sensitive: "Aman.",
  },
  {
    max: 100,
    label: "Sedang",
    color: "#e3c04a",
    onColor: DARK,
    mask: "Tidak perlu.",
    room: "Boleh dibuka.",
    sensitive: "Umumnya aman. Perhatikan bila mulai batuk atau sesak.",
  },
  {
    max: 150,
    label: "Tidak sehat bagi kelompok sensitif",
    color: "#f28c38",
    onColor: DARK,
    mask: "Disarankan di luar ruangan: masker medis atau KN95.",
    room: "Tutup bila bau asap mulai tercium.",
    sensitive: "Pakai KN95 di luar dan siapkan obat rutin atau inhaler.",
  },
  {
    max: 200,
    label: "Tidak sehat",
    color: "#e5483a",
    onColor: LIGHT,
    mask: "Pakai N95/KN95 setiap di luar ruangan.",
    room: "Tutup jendela dan pintu.",
    sensitive: "Sebaiknya tetap di dalam ruangan.",
  },
  {
    max: 300,
    label: "Sangat tidak sehat",
    color: "#b0477e",
    onColor: LIGHT,
    mask: "Wajib N95/KN95, kawat hidung ditekan rapat.",
    room: "Tutup rapat. Nyalakan penjernih udara bila ada.",
    sensitive: "Tetap di dalam ruangan.",
  },
  {
    max: 500,
    label: "Berbahaya",
    color: "#7d2235",
    onColor: LIGHT,
    mask: "Wajib N95/KN95. Keluar hanya bila perlu.",
    room: "Tutup rapat semua ventilasi. Nyalakan penjernih udara bila ada.",
    sensitive: "Tetap di dalam ruangan. Ke fasilitas kesehatan bila sesak.",
  },
];

export function aqiBand(aqi: number): AqiBand {
  return AQI_BANDS.find((b) => aqi <= b.max) ?? AQI_BANDS[AQI_BANDS.length - 1];
}

/** Perubahan AQI berarti (≥ 20 poin) dalam 6 jam ke depan. */
export function aqiTrend(s: Snapshot): { dir: "naik" | "turun"; to: number; at: string } | null {
  const now = s.air?.aqi;
  if (now == null) return null;
  const next = s.hourly.slice(1, 7).filter((p): p is HourPoint & { aqi: number } => p.aqi != null);
  if (next.length === 0) return null;
  const hi = next.reduce((m, p) => (p.aqi > m.aqi ? p : m));
  const lo = next.reduce((m, p) => (p.aqi < m.aqi ? p : m));
  if (hi.aqi - now >= 20) return { dir: "naik", to: hi.aqi, at: hourLabel(hi.time) };
  if (now - lo.aqi >= 20) return { dir: "turun", to: lo.aqi, at: hourLabel(lo.time) };
  return null;
}

/* ---------- util tampilan ---------- */

/** Arah asal angin. Asap karhutla ke Palembang umumnya datang dari selatan–tenggara (OKI, Ogan Ilir). */
export function compass(deg: number): string {
  const dirs = ["utara", "timur laut", "timur", "tenggara", "selatan", "barat daya", "barat", "barat laut"];
  return dirs[Math.round(deg / 45) % 8];
}

export function hourLabel(iso: string): string {
  return iso.slice(11, 16);
}

/** "2026-10-13T07:00" → "07.00" (penulisan jam di Indonesia). */
export function clockLabel(iso: string): string {
  return iso.slice(11, 16).replace(":", ".");
}
