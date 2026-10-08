// Data cuaca & kualitas udara realtime dari Open-Meteo (gratis, tanpa API key).
// Kualitas udara berasal dari model CAMS (Copernicus), bukan stasiun darat.

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
  precip: number;
  code: number;
  cloud: number;
  pressure: number;
  wind: number;
  windDir: number;
  gust: number;
  uv: number;
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
  temp: number;
  feels: number;
  pop: number;
  precip: number;
  code: number;
  uv: number;
  gust: number;
  isDay: boolean;
  aqi: number | null;
};

export type DayPoint = {
  date: string;
  code: number;
  max: number;
  min: number;
  rain: number;
  pop: number;
  uvMax: number;
  gustMax: number;
  sunrise: string;
  sunset: string;
  /** AQI tertinggi hari itu; null di luar jangkauan model CAMS (± 5 hari). */
  aqiMax: number | null;
};

export type Snapshot = {
  fetchedAt: number;
  timezone: string;
  current: Current;
  air: Air | null;
  /** 24 jam ke depan. */
  hourly: HourPoint[];
  /** Semua jam prakiraan mulai sekarang (± 7 hari), untuk rincian per hari. */
  hours: HourPoint[];
  daily: DayPoint[];
  today: DayPoint;
  simulated?: boolean;
};

const FORECAST = "https://api.open-meteo.com/v1/forecast";
const AIR = "https://air-quality-api.open-meteo.com/v1/air-quality";

export async function fetchSnapshot(place: Place, signal?: AbortSignal): Promise<Snapshot> {
  const coords = `latitude=${place.lat}&longitude=${place.lon}&timezone=auto&forecast_days=7`;
  const wxUrl =
    `${FORECAST}?${coords}` +
    "&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index,visibility" +
    "&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,uv_index,wind_gusts_10m,is_day" +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_gusts_10m_max,uv_index_max,sunrise,sunset";
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
    precip: c.precipitation,
    code: c.weather_code,
    cloud: c.cloud_cover,
    pressure: c.pressure_msl,
    wind: c.wind_speed_10m,
    windDir: c.wind_direction_10m,
    gust: c.wind_gusts_10m,
    uv: c.uv_index ?? 0,
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

  // Semua jam mulai dari jam sekarang (waktu lokal lokasi).
  const h = wx.hourly;
  const start = Math.max(0, h.time.findIndex((t: string) => t.slice(0, 13) === nowHour));
  const hours: HourPoint[] = h.time.slice(start).map((t: string, k: number) => {
    const i = start + k;
    return {
      time: t,
      temp: h.temperature_2m[i],
      feels: h.apparent_temperature[i],
      pop: h.precipitation_probability[i] ?? 0,
      precip: h.precipitation[i] ?? 0,
      code: h.weather_code[i],
      uv: h.uv_index[i] ?? 0,
      gust: h.wind_gusts_10m[i] ?? 0,
      isDay: h.is_day[i] === 1,
      aqi: aqiByHour.get(t) ?? null,
    };
  });

  const d = wx.daily;
  const daily: DayPoint[] = d.time.map((date: string, i: number) => ({
    date,
    code: d.weather_code[i],
    max: d.temperature_2m_max[i],
    min: d.temperature_2m_min[i],
    rain: d.precipitation_sum[i] ?? 0,
    pop: d.precipitation_probability_max[i] ?? 0,
    uvMax: d.uv_index_max[i] ?? 0,
    gustMax: d.wind_gusts_10m_max[i] ?? 0,
    sunrise: d.sunrise[i],
    sunset: d.sunset[i],
    aqiMax: dailyAqiMax(aqiByHour, date, nowHour, i === 0),
  }));

  return {
    fetchedAt: Date.now(),
    timezone: wx.timezone,
    current,
    air,
    hourly: hours.slice(0, 24),
    hours,
    daily,
    today: daily[0],
  };
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
  const fix = (p: HourPoint, i: number): HourPoint =>
    i < 24 && p.aqi != null ? { ...p, aqi: Math.max(0, Math.min(500, Math.round(p.aqi + bias))) } : p;
  const hours = s.hours.map(fix);
  // Hanya AQI maks hari ini yang dihitung ulang; hari-hari berikutnya di luar jangkauan koreksi.
  const todayHours = hours.filter((p) => p.time.startsWith(s.today.date) && p.aqi != null).map((p) => p.aqi!);
  const today = { ...s.today, aqiMax: todayHours.length ? Math.max(st.aqi, ...todayHours) : st.aqi };
  const daily = [today, ...s.daily.slice(1)];
  return {
    ...s,
    air: { ...s.air, aqi: st.aqi, station: st },
    hours,
    hourly: hours.slice(0, 24),
    daily,
    today,
  };
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
    current: { ...s.current, code: 45, visibility: 900, uv: Math.min(s.current.uv, 3) },
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
    hours: s.hours.map((p, i) => ({ ...p, aqi: p.aqi == null ? null : Math.max(160, 268 - (i % 24) * 4) })),
    daily,
    today: daily[0],
  };
}

export async function reverseGeocode(lat: number, lon: number): Promise<{ name: string; region?: string }> {
  const res = await fetch(
    `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=id`,
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

export type AqiBand = { max: number; label: string; short: string; color: string };

export const AQI_BANDS: AqiBand[] = [
  { max: 50, label: "Baik", short: "Baik", color: "#4fc3a1" },
  { max: 100, label: "Sedang", short: "Sedang", color: "#e3c04a" },
  { max: 150, label: "Tidak sehat bagi kelompok sensitif", short: "Sensitif", color: "#f28c38" },
  { max: 200, label: "Tidak sehat", short: "Tdk sehat", color: "#e5483a" },
  { max: 300, label: "Sangat tidak sehat", short: "Sangat", color: "#b0477e" },
  { max: 500, label: "Berbahaya", short: "Bahaya", color: "#7d2235" },
];

export function aqiBand(aqi: number): AqiBand {
  return AQI_BANDS.find((b) => aqi <= b.max) ?? AQI_BANDS[AQI_BANDS.length - 1];
}

/* ---------- Penilaian: aman keluar atau tidak ---------- */

export type Level = "aman" | "waspada" | "bahaya";

export type Hazard = { id: string; level: Level; title: string; detail: string };

export type Assessment = {
  level: Level;
  score: number; // 0–100, makin tinggi makin layak keluar
  hazards: Hazard[];
  maskRequired: boolean;
  maskAdvised: boolean;
  rainSoon: { at: string; pop: number } | null;
};

const rank: Record<Level, number> = { aman: 0, waspada: 1, bahaya: 2 };

/** Kelompok sensitif: penderita asma/penyakit jantung-paru, anak, lansia, ibu hamil. */
export type Profile = { sensitive: boolean };

const GENERAL: Profile = { sensitive: false };

/**
 * Ambang per profil. Untuk kelompok sensitif, kategori EPA "tidak sehat bagi kelompok sensitif"
 * (AQI 101–150) memang sudah berbahaya, dan tubuh lebih cepat kepanasan.
 */
function limits(p: Profile) {
  return p.sensitive
    ? { aqiWarn: 50, aqiDanger: 100, heatWarn: 35, heatDanger: 40, airWeight: 1.5 }
    : { aqiWarn: 100, aqiDanger: 150, heatWarn: 38, heatDanger: 42, airWeight: 1 };
}

/** Ozon 1 jam ≥ 0,125 ppm (≈ 245 µg/m³) masuk kategori tidak sehat menurut EPA. */
const OZONE_1H_UNHEALTHY = 245;

function aqiPenalty(aqi: number | null, weight = 1): number {
  if (aqi == null || aqi <= 50) return 0;
  return weight * (aqi <= 100 ? (aqi - 50) * 0.3 : 15 + (aqi - 100) * 0.3);
}

export function assess(s: Snapshot, profile: Profile = GENERAL): Assessment {
  const L = limits(profile);
  const c = s.current;
  const hazards: Hazard[] = [];
  let penalty = 0;

  const aqi = s.air?.aqi ?? null;
  if (s.air && aqi != null) {
    const band = aqiBand(aqi);
    const avg = s.air.pm25Avg24;
    const who = avg != null ? ` Rata-rata 24 jam ${avg.toFixed(0)} µg/m³, ${(avg / 15).toFixed(0)}× pedoman harian WHO.` : "";
    if (aqi > L.aqiDanger) {
      hazards.push({
        id: "air",
        level: "bahaya",
        title: profile.sensitive && aqi <= 150 ? "Udara tidak sehat untukmu" : `Udara ${band.label.toLowerCase()}`,
        detail: s.air.station
          ? `AQI ${aqi}, terukur di stasiun ${s.air.station.name}.${who}`
          : `AQI ${aqi}, PM2.5 ${s.air.pm25.toFixed(0)} µg/m³ saat ini.${who}`,
      });
    } else if (aqi > L.aqiWarn) {
      hazards.push({
        id: "air",
        level: "waspada",
        title: profile.sensitive ? "Udara mulai mengganggu untukmu" : "Udara tidak sehat untuk kelompok sensitif",
        detail: profile.sensitive
          ? `AQI ${aqi}. Batasi aktivitas berat di luar dan siapkan masker serta obat (inhaler).`
          : `AQI ${aqi}. Anak, lansia, ibu hamil, dan penderita asma sebaiknya bermasker.`,
      });
    }
    penalty += aqiPenalty(aqi, L.airWeight);

    if (s.air.o3 >= OZONE_1H_UNHEALTHY) {
      hazards.push({
        id: "ozone",
        level: "waspada",
        title: "Ozon tinggi",
        detail: `O₃ ${s.air.o3.toFixed(0)} µg/m³. Masker tidak menyaring ozon — kurangi olahraga berat di luar sampai sore.`,
      });
      penalty += 8;
    }
  }

  const sky = describeCode(c.code);
  if (sky.kind === "storm") {
    hazards.push({ id: "storm", level: "bahaya", title: sky.label, detail: "Hindari ruang terbuka dan berteduh di bangunan." });
    penalty += 45;
  } else if (sky.kind === "rain" || sky.kind === "drizzle") {
    const heavy = c.code === 65 || c.code === 82;
    hazards.push({
      id: "rain",
      level: heavy ? "bahaya" : "waspada",
      title: `${sky.label} sekarang`,
      detail: `Curah ${c.precip.toFixed(1)} mm/jam. ${heavy ? "Waspadai genangan di jalan." : "Bawa payung atau jas hujan."}`,
    });
    penalty += heavy ? 30 : 15;
  }

  const next3 = s.hourly.slice(1, 4);
  const wettest = next3.reduce<HourPoint | null>((m, p) => (!m || p.pop > m.pop ? p : m), null);
  const rainSoon = wettest && wettest.pop >= 60 ? { at: wettest.time, pop: wettest.pop } : null;
  if (rainSoon && sky.kind !== "rain" && sky.kind !== "storm") {
    hazards.push({
      id: "rain-soon",
      level: "waspada",
      title: "Hujan mungkin turun",
      detail: `Peluang ${rainSoon.pop}% sekitar pukul ${hourLabel(rainSoon.at)}.`,
    });
    penalty += 8;
  }

  if (c.feels >= L.heatDanger) {
    hazards.push({ id: "heat", level: "bahaya", title: "Panas ekstrem", detail: `Terasa ${Math.round(c.feels)}°C. Risiko heatstroke.` });
    penalty += 25;
  } else if (c.feels >= L.heatWarn) {
    hazards.push({ id: "heat", level: "waspada", title: "Panas terik", detail: `Terasa ${Math.round(c.feels)}°C. Minum air lebih sering.` });
    penalty += 10;
  }

  if (c.isDay && c.uv >= 11) {
    hazards.push({ id: "uv", level: "bahaya", title: "UV ekstrem", detail: `Indeks UV ${c.uv.toFixed(0)}. Kulit bisa terbakar < 10 menit.` });
    penalty += 15;
  } else if (c.isDay && c.uv >= 8) {
    hazards.push({ id: "uv", level: "waspada", title: "UV sangat tinggi", detail: `Indeks UV ${c.uv.toFixed(0)}. Pakai tabir surya & topi.` });
    penalty += 8;
  }

  if (c.gust >= 60) {
    hazards.push({ id: "wind", level: "waspada", title: "Angin kencang", detail: `Hembusan hingga ${Math.round(c.gust)} km/jam.` });
    penalty += 10;
  }

  if (c.visibility > 0 && c.visibility < 1000) {
    hazards.push({ id: "vis", level: "waspada", title: "Jarak pandang pendek", detail: `Sekitar ${Math.round(c.visibility)} m. Nyalakan lampu kendaraan.` });
    penalty += 8;
  }

  hazards.sort((a, b) => rank[b.level] - rank[a.level]);
  const level = hazards.reduce<Level>((m, h) => (rank[h.level] > rank[m] ? h.level : m), "aman");

  return {
    level,
    score: Math.max(0, Math.min(100, Math.round(100 - penalty))),
    hazards,
    maskRequired: aqi != null && aqi > 100,
    maskAdvised: aqi != null && aqi > 50,
    rainSoon,
  };
}

/* ---------- Waktu terbaik keluar ---------- */

/** Penalti satu jam prakiraan, dengan bobot yang sama seperti assess(). */
function hourPenalty(p: HourPoint, profile: Profile): number {
  const L = limits(profile);
  const kind = describeCode(p.code).kind;
  let x = aqiPenalty(p.aqi, L.airWeight);
  if (kind === "storm") x += 45;
  else if (p.code === 65 || p.code === 82) x += 30;
  else if (kind === "rain" || kind === "drizzle") x += 15;
  x += p.pop >= 60 ? 10 : p.pop >= 30 ? 4 : 0;
  x += p.feels >= L.heatDanger ? 25 : p.feels >= L.heatWarn ? 10 : 0;
  x += p.uv >= 11 ? 15 : p.uv >= 8 ? 8 : 0;
  x += p.gust >= 60 ? 10 : 0;
  return x;
}

export type OutingWindow = {
  start: string;
  /** Jam berakhir, "HH:MM". */
  end: string;
  score: number;
  aqi: number | null;
  pop: number;
  feels: number;
  tomorrow: boolean;
};

/**
 * Jendela 2 jam terbaik dan terburuk untuk keluar dalam 24 jam ke depan,
 * hanya di jam aktif (05.00–21.00 waktu lokal).
 */
export function outingWindows(s: Snapshot, profile: Profile = GENERAL, len = 2): { best: OutingWindow | null; worst: OutingWindow | null } {
  const hours = s.hourly;
  const today = hours[0]?.time.slice(0, 10);
  const active = (t: string) => {
    const hh = Number(t.slice(11, 13));
    return hh >= 5 && hh < 21;
  };

  const windows: OutingWindow[] = [];
  for (let i = 0; i + len <= hours.length; i++) {
    const slice = hours.slice(i, i + len);
    if (!slice.every((p) => active(p.time))) continue;
    const pen = slice.reduce((a, p) => a + hourPenalty(p, profile), 0) / len;
    const aqis = slice.map((p) => p.aqi).filter((v): v is number => v != null);
    const endHour = Number(slice[len - 1].time.slice(11, 13)) + 1;
    windows.push({
      start: hourLabel(slice[0].time),
      end: `${String(endHour).padStart(2, "0")}:00`,
      score: Math.max(0, Math.round(100 - pen)),
      aqi: aqis.length ? Math.max(...aqis) : null,
      pop: Math.max(...slice.map((p) => p.pop)),
      feels: Math.max(...slice.map((p) => p.feels)),
      tomorrow: slice[0].time.slice(0, 10) !== today,
    });
  }
  if (windows.length === 0) return { best: null, worst: null };

  // Seri → ambil yang paling awal.
  const best = windows.reduce((b, w) => (w.score > b.score ? w : b));
  const worst = windows.reduce((b, w) => (w.score < b.score ? w : b));
  return { best, worst: best.score - worst.score >= 15 ? worst : null };
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

export function compass(deg: number): string {
  const dirs = ["U", "TL", "T", "TG", "S", "BD", "B", "BL"];
  return dirs[Math.round(deg / 45) % 8];
}

export function hourLabel(iso: string): string {
  return iso.slice(11, 16);
}

/** Jendela terbaik belum tentu nyaman — saat asap pekat, itu hanya jam yang paling ringan. */
export function windowIsComfortable(w: OutingWindow): boolean {
  return w.score >= 80 && (w.aqi == null || w.aqi <= 100);
}

export function windowLabel(w: OutingWindow): string {
  return `${w.tomorrow ? "besok " : ""}${w.start.replace(":", ".")}–${w.end.replace(":", ".")}`;
}
