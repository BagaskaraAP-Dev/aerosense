import { aqiBand, aqiTrend, assess, describeCode, outingWindows, skyOf, windowIsComfortable, windowLabel, type Profile, type Snapshot } from "./weather";

export type Advice = {
  headline: string;
  summary: string;
  checklist: string[];
  source: "claude" | "lokal";
};

/** Ringkasan data yang dikirim ke Claude — kecil, tanpa data pribadi. */
export function adviceInput(s: Snapshot, placeName: string, profile: Profile) {
  const a = assess(s, profile);
  const { best, worst } = outingWindows(s, profile);
  const trend = aqiTrend(s);
  const tomorrow = s.daily[1];
  return {
    lokasi: placeName,
    pengguna_kelompok_sensitif: profile.sensitive,
    waktu_lokal: s.current.time,
    siang: s.current.isDay,
    kondisi: skyOf(s).label,
    suhu_c: s.current.temp,
    terasa_c: s.current.feels,
    kelembapan_pct: s.current.humidity,
    angin_kmh: s.current.wind,
    uv: s.current.uv,
    jarak_pandang_m: s.current.visibility,
    aqi_us: s.air?.aqi ?? null,
    sumber_aqi: s.air?.station ? `stasiun darat ${s.air.station.name}` : "model satelit CAMS",
    pm25_sekarang: s.air?.pm25 ?? null,
    pm25_rata2_24_jam: s.air?.pm25Avg24 ?? null,
    ozon: s.air?.o3 ?? null,
    tren_aqi_6_jam: trend ? `${trend.dir} ke ${trend.to} sekitar ${trend.at}` : "stabil",
    hujan_3_jam: a.rainSoon,
    waktu_terbaik_keluar: best && { jam: windowLabel(best), aqi: best.aqi, peluang_hujan: best.pop, terasa_c: best.feels },
    waktu_hindari: worst && { jam: windowLabel(worst), aqi: worst.aqi, peluang_hujan: worst.pop, terasa_c: worst.feels },
    prakiraan_6_jam: s.hourly.slice(1, 7).map((h) => ({
      jam: h.time.slice(11, 16),
      suhu: h.temp,
      peluang_hujan: h.pop,
      kondisi: describeCode(h.code).label,
      aqi: h.aqi,
    })),
    besok: tomorrow && {
      kondisi: describeCode(tomorrow.code).label,
      maks_c: tomorrow.max,
      min_c: tomorrow.min,
      peluang_hujan: tomorrow.pop,
      aqi_maks: tomorrow.aqiMax,
    },
    status: a.level,
    wajib_masker: a.maskRequired,
    bahaya: a.hazards.map((h) => h.title),
    simulasi: !!s.simulated,
  };
}

/** Mesin aturan lokal: dipakai kalau Claude tidak tersedia. */
export function localAdvice(s: Snapshot, placeName: string, profile: Profile): Advice {
  const a = assess(s, profile);
  const c = s.current;
  const aqi = s.air?.aqi;
  const { best, worst } = outingWindows(s, profile);
  const trend = aqiTrend(s);
  const checklist: string[] = [];
  let headline: string;

  if (a.maskRequired && aqi != null && aqi > 150) {
    headline = "Tunda aktivitas luar kalau bisa.";
    checklist.push("Masker N95/KN95, rapat di batang hidung", "Tutup jendela dan pintu", "Olahraga di dalam ruangan");
  } else if (a.maskRequired && profile.sensitive) {
    // AQI 101–150: aman untuk umum, tapi sudah berbahaya bagi kelompok sensitif.
    headline = "Sebaiknya di dalam ruangan dulu.";
    checklist.push("Masker KN95 kalau terpaksa keluar", "Bawa inhaler atau obat rutin");
  } else if (a.maskRequired) {
    headline = "Boleh keluar, asal bermasker.";
    checklist.push("Masker medis atau KN95", "Kurangi olahraga berat di luar");
  } else if (a.level === "bahaya") {
    headline = a.hazards[0] ? `${a.hazards[0].title}. Tunggu dulu.` : "Sebaiknya tetap di dalam dulu.";
  } else if (a.level === "waspada") {
    headline = "Aman, dengan sedikit persiapan.";
  } else {
    headline = c.isDay ? "Aman untuk keluar." : "Aman, malam ini tenang.";
  }

  // Ringkasan hanya berisi hal yang belum terlihat di kartu peringatan: arah perubahan dan jam.
  const parts: string[] = [];
  if (trend && aqi != null) {
    const toBand = aqiBand(trend.to).label.toLowerCase();
    parts.push(
      trend.dir === "naik"
        ? `Udara di ${placeName} diperkirakan memburuk ke AQI ${trend.to} (${toBand}) sekitar pukul ${trend.at.replace(":", ".")}.`
        : `Udara di ${placeName} diperkirakan membaik ke AQI ${trend.to} (${toBand}) sekitar pukul ${trend.at.replace(":", ".")}.`,
    );
  } else if (aqi != null) {
    parts.push(`Udara di ${placeName} ${aqiBand(aqi).label.toLowerCase()} (AQI ${aqi}) dan relatif stabil 6 jam ke depan.`);
  }
  if (a.rainSoon) parts.push(`Peluang hujan ${a.rainSoon.pop}% sekitar pukul ${a.rainSoon.at.slice(11, 16).replace(":", ".")}.`);
  if (best) {
    const why = [best.aqi != null ? `AQI ${best.aqi}` : null, `hujan ${best.pop}%`, `terasa ${Math.round(best.feels)}°`].filter(Boolean).join(", ");
    parts.push(
      windowIsComfortable(best)
        ? `Jam paling nyaman keluar: ${windowLabel(best)} (${why}).`
        : `Kalau harus keluar, pilih ${windowLabel(best)}, saat kondisinya paling ringan (${why}).`,
    );
  }
  if (worst) parts.push(`Hindari ${windowLabel(worst)}.`);

  if (a.rainSoon || ["rain", "drizzle", "storm"].includes(describeCode(c.code).kind)) checklist.push("Payung atau jas hujan");
  if (c.isDay && c.uv >= 6) checklist.push("Tabir surya SPF 30+ dan topi");
  if (c.feels >= 34) checklist.push("Botol air minum");
  if (c.visibility > 0 && c.visibility < 2000) checklist.push("Lampu kendaraan menyala");
  if (profile.sensitive && aqi != null && aqi > 50 && !checklist.some((x) => x.includes("inhaler"))) checklist.push("Bawa inhaler atau obat rutin");
  if (checklist.length === 0) checklist.push("Tidak ada persiapan khusus");

  return { headline, summary: parts.join(" "), checklist, source: "lokal" };
}
