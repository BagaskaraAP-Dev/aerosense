"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  Droplets,
  Eye,
  FlaskConical,
  HeartPulse,
  Gauge,
  Loader2,
  MapPin,
  Navigation,
  RefreshCw,
  ScanFace,
  ShieldCheck,
  Sun,
  Sunrise,
  Sunset,
  Umbrella,
  Wind,
} from "lucide-react";
import Atmosphere from "./Atmosphere";
import { AeroSenseMark, AeroSenseWordmark } from "./AeroSenseLogo";
import LocationPicker from "./LocationPicker";
import MaskScanner, { type ScanOutcome } from "./MaskScanner";
import SkyIcon from "./SkyIcon";
import { adviceInput, localAdvice, type Advice } from "@/lib/advice";
import {
  AQI_BANDS,
  PALEMBANG,
  applyStation,
  aqiBand,
  assess,
  compass,
  describeCode,
  fetchSnapshot,
  fetchStation,
  hourLabel,
  outingWindows,
  reverseGeocode,
  simulateHaze,
  skyOf,
  windowIsComfortable,
  windowLabel,
  type Assessment,
  type HourPoint,
  type Level,
  type OutingWindow,
  type Place,
  type Snapshot,
} from "@/lib/weather";

const REFRESH_MS = 10 * 60 * 1000;
const PLACE_KEY = "aerosense:place";
const SIM_KEY = "aerosense:sim";
const SENSITIVE_KEY = "aerosense:sensitive";
// Versi di nama kunci: bentuk Snapshot berubah → cache lama otomatis diabaikan.
const SNAP_KEY = "aerosense:snap:v3";
/** Data tersimpan lebih tua dari ini tidak ditampilkan sama sekali. */
const SNAP_MAX_AGE_MS = 3 * 60 * 60 * 1000;

const LEVEL: Record<Level, { label: string; text: string; ring: string; bg: string; color: string }> = {
  aman: { label: "Aman", text: "text-ok", ring: "border-ok/40", bg: "bg-ok/10", color: "#4fc3a1" },
  waspada: { label: "Waspada", text: "text-warn", ring: "border-warn/40", bg: "bg-warn/10", color: "#f28c38" },
  bahaya: { label: "Bahaya", text: "text-danger", ring: "border-danger/50", bg: "bg-danger/10", color: "#e5483a" },
};

type Stored = { place: Place | null; simulate: boolean; sensitive: boolean; snap: Snapshot | null };

function readStored(): Stored {
  try {
    const place: Place | null = JSON.parse(localStorage.getItem(PLACE_KEY) || "null");
    const where = place ?? PALEMBANG;
    const cached: { lat: number; lon: number; snap: Snapshot } | null = JSON.parse(localStorage.getItem(SNAP_KEY) || "null");
    const fresh =
      cached && cached.lat === where.lat && cached.lon === where.lon && Date.now() - cached.snap.fetchedAt < SNAP_MAX_AGE_MS;
    return {
      place,
      simulate: localStorage.getItem(SIM_KEY) === "1",
      sensitive: localStorage.getItem(SENSITIVE_KEY) === "1",
      snap: fresh ? cached.snap : null,
    };
  } catch {
    return { place: null, simulate: false, sensitive: false, snap: null };
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

/** Minta posisi GPS lalu ubah jadi nama kota. */
function requestPosition(): Promise<Place> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Browser ini tidak mendukung GPS."));
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const lat = +coords.latitude.toFixed(4);
        const lon = +coords.longitude.toFixed(4);
        const where = await reverseGeocode(lat, lon).catch(() => ({ name: "Lokasi kamu", region: undefined }));
        resolve({ ...where, lat, lon, source: "gps" });
      },
      () => reject(new Error("Izin lokasi ditolak — memakai lokasi yang dipilih manual.")),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 10 * 60 * 1000 },
    );
  });
}

/** Dirender hanya di browser (lihat ClientApp), jadi localStorage aman dibaca saat inisialisasi. */
export default function AeroSenseApp() {
  const [initial] = useState(readStored);
  const [place, setPlace] = useState<Place>(initial.place ?? PALEMBANG);
  // Data terakhir langsung tampil saat aplikasi dibuka; data baru menyusul beberapa detik kemudian.
  const [real, setReal] = useState<Snapshot | null>(initial.snap);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [simulate, setSimulate] = useState(initial.simulate);
  const [sensitive, setSensitive] = useState(initial.sensitive);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [lastScan, setLastScan] = useState<{ outcome: ScanOutcome; at: number } | null>(null);
  const [claudeEnabled, setClaudeEnabled] = useState(false);
  const [stationEnabled, setStationEnabled] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  /* ---------- lokasi ---------- */

  const choosePlace = useCallback((p: Place) => {
    setPlace(p);
    setReal(null);
    setPickerOpen(false);
    store(PLACE_KEY, JSON.stringify(p));
  }, []);

  const locate = () => {
    setLocating(true);
    requestPosition()
      .then(choosePlace)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLocating(false));
  };

  // Kunjungan pertama: tampilkan Palembang dulu, lalu coba GPS diam-diam.
  useEffect(() => {
    if (!initial.place || initial.place.source === "gps") requestPosition().then(choosePlace, () => {});
    fetch("/api/advisor")
      .then((r) => r.json())
      .then((j) => setClaudeEnabled(!!j.enabled))
      .catch(() => {});
  }, [initial, choosePlace]);

  /* ---------- data realtime ---------- */

  const load = useCallback(
    (p: Place) =>
      // Stasiun darat diminta bersamaan; kalau gagal, data model tetap dipakai.
      Promise.all([fetchSnapshot(p), fetchStation(p)])
        .then(([model, st]) => {
          const snap = applyStation(model, st.station);
          setStationEnabled(st.enabled);
          setReal(snap);
          setError("");
          store(SNAP_KEY, JSON.stringify({ lat: p.lat, lon: p.lon, snap }));
        })
        .catch((e: Error) => setError(`Gagal mengambil data cuaca (${e.message}). Coba lagi.`))
        .finally(() => setLoading(false)),
    [],
  );

  const refresh = () => {
    setLoading(true);
    load(place);
  };

  useEffect(() => {
    load(place);
    const id = setInterval(() => load(place), REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") load(place);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [place, load]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const toggleSim = () => {
    store(SIM_KEY, simulate ? "0" : "1");
    setSimulate(!simulate);
  };

  const toggleSensitive = () => {
    store(SENSITIVE_KEY, sensitive ? "0" : "1");
    setSensitive(!sensitive);
  };

  const profile = useMemo(() => ({ sensitive }), [sensitive]);
  const snap = useMemo(() => (real && simulate ? simulateHaze(real) : real), [real, simulate]);
  const verdict = useMemo(() => (snap ? assess(snap, profile) : null), [snap, profile]);
  const windows = useMemo(() => (snap ? outingWindows(snap, profile) : { best: null, worst: null }), [snap, profile]);
  const sky = snap ? skyOf(snap) : null;

  /* ---------- saran AI ---------- */
  // Saran lokal selalu tersedia seketika; versi Claude menggantikannya bila sudah datang.
  // Hasil Claude disimpan per "kunci kondisi" supaya refresh 10 menit tidak memanggil ulang.

  const adviceKey = snap
    ? `${place.lat},${place.lon}|${snap.current.time.slice(0, 13)}|${snap.air?.aqi}|${snap.current.code}|${!!snap.simulated}|${sensitive}`
    : "";
  const [claudeAdvice, setClaudeAdvice] = useState<Record<string, Advice | "gagal">>({});
  const fromClaude = claudeAdvice[adviceKey];
  const localAdv = useMemo(() => (snap ? localAdvice(snap, place.name, profile) : null), [snap, place.name, profile]);
  const advice = fromClaude && fromClaude !== "gagal" ? fromClaude : localAdv;
  const adviceLoading = claudeEnabled && !!snap && !fromClaude;

  useEffect(() => {
    if (!claudeEnabled || !snap || !adviceKey || adviceKey in claudeAdvice) return;
    let stale = false;
    fetch("/api/advisor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(adviceInput(snap, place.name, profile)),
    })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        const a: Advice = { headline: j.headline, summary: j.summary, checklist: j.checklist, source: "claude" };
        if (!stale) setClaudeAdvice((m) => ({ ...m, [adviceKey]: a }));
      })
      .catch(() => {
        if (!stale) setClaudeAdvice((m) => ({ ...m, [adviceKey]: "gagal" }));
      });
    return () => {
      stale = true;
    };
  }, [claudeEnabled, snap, adviceKey, claudeAdvice, place.name, profile]);

  // Udara buruk → kemungkinan besar kamera akan dipakai; panaskan model AI di latar.
  // Model ± 12 MB, jadi tidak diunduh diam-diam di koneksi lambat atau mode hemat data.
  const maskRequired = !!verdict?.maskRequired;
  useEffect(() => {
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (!maskRequired || conn?.saveData || /2g|3g/.test(conn?.effectiveType ?? "")) return;
    const t = setTimeout(() => import("@/lib/mask-detector").then((m) => m.loadDetector()).catch(() => {}), 2500);
    return () => clearTimeout(t);
  }, [maskRequired]);

  const onScanResult = useCallback((outcome: ScanOutcome) => setLastScan({ outcome, at: Date.now() }), []);

  /* ---------- render ---------- */

  const tz = snap?.timezone;
  const day = new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "short", timeZone: tz }).format(now);
  const clock = new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(now);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(now));
  const greeting = hour < 4 ? "Selamat malam" : hour < 11 ? "Selamat pagi" : hour < 15 ? "Selamat siang" : hour < 18 ? "Selamat sore" : "Selamat malam";
  // Lewat 2× jadwal refresh berarti pengambilan data terakhir gagal (mis. sedang offline).
  const live = !!real && now - real.fetchedAt < REFRESH_MS * 2;
  const hazeIntensity = snap?.air ? Math.min(1, Math.max(0, (snap.air.aqi - 100) / 200)) : 0;

  return (
    <div className="relative min-h-svh">
      {sky && snap && <Atmosphere kind={sky.kind} isDay={snap.current.isDay} intensity={hazeIntensity} />}

      <div className="mx-auto max-w-6xl px-4 pb-16 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6">
        {/* Bar atas */}
        <header className="flex items-center justify-between gap-3 py-2">
          <div className="flex items-center gap-2.5">
            <AeroSenseMark className="h-9 w-9" />
            <AeroSenseWordmark className="text-2xl" />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPickerOpen(true)}
              className="flex min-w-0 items-center gap-1.5 rounded-full border border-line-strong bg-ink-2/70 py-2 pl-3 pr-2.5 text-sm backdrop-blur hover:border-gold/60"
            >
              {place.source === "gps" ? <Navigation className="h-3.5 w-3.5 shrink-0 text-gold" /> : <MapPin className="h-3.5 w-3.5 shrink-0 text-gold" />}
              <span className="max-w-[9rem] truncate font-semibold">{place.name ?? "…"}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted" />
            </button>
          </div>
        </header>

        {/* Sambutan */}
        <section className="mt-6 animate-rise sm:mt-10">
          <p className="label">
            {live ? "Live" : "Data tersimpan"} · {day} · {clock} {tzLabel(tz)}
          </p>
          <h1 className="mt-3 text-[2.6rem] font-extrabold leading-[0.95] tracking-tight sm:text-6xl">
            {greeting},<br />
            <span className="text-gold">{place.name}</span>
            <span className="text-muted">.</span>
          </h1>
          <p className="mt-3 max-w-xl text-base text-muted sm:text-lg">
            {snap && sky ? heroLine(snap, sky.label, windows.best) : "Mengambil data cuaca dan kualitas udara…"}
          </p>
        </section>

        {snap?.simulated && (
          <div className="mt-6 flex items-center gap-3 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm">
            <FlaskConical className="h-4 w-4 shrink-0 text-warn" />
            <span>
              <b>Mode simulasi kabut asap aktif.</b> Angka kualitas udara di bawah adalah skenario demo, bukan data asli.
            </span>
            <button onClick={toggleSim} className="ml-auto shrink-0 font-semibold text-warn underline underline-offset-4">
              Matikan
            </button>
          </div>
        )}

        {error && <p className="mt-6 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm">{error}</p>}

        {!snap ? (
          <Skeleton />
        ) : (
          <main className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-12">
            {/* Kondisi sekarang */}
            <section className="animate-rise rounded-3xl border border-line bg-ink-2/90 p-5 sm:p-7 lg:col-span-7">
              <div className="flex items-start justify-between">
                <p className="label">Sekarang · {place.region ?? place.name}</p>
                <button
                  onClick={refresh}
                  className="-m-2 grid h-10 w-10 place-items-center rounded-full text-muted hover:bg-ink-3 hover:text-paper"
                  aria-label="Muat ulang data"
                >
                  <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                </button>
              </div>
              <div className="mt-2 flex items-end justify-between gap-4">
                <div>
                  <div className="flex items-start">
                    <span className="font-display text-[6.5rem] font-extrabold leading-[0.85] tracking-tighter tabular sm:text-[9rem]">
                      {Math.round(snap.current.temp)}
                    </span>
                    <span className="mt-2 text-4xl font-bold text-muted sm:text-5xl">°C</span>
                  </div>
                  <p className="mt-3 text-2xl font-bold">{sky!.label}</p>
                  <p className="mt-1 font-mono text-sm text-muted tabular">
                    Terasa {Math.round(snap.current.feels)}° · ↑{Math.round(snap.today.max)}° ↓{Math.round(snap.today.min)}°
                  </p>
                </div>
                <SkyIcon kind={sky!.kind} isDay={snap.current.isDay} className="mb-2 h-20 w-20 shrink-0 text-gold sm:h-28 sm:w-28" />
              </div>

              <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-4">
                <Stat icon={<Droplets className="h-4 w-4" />} label="Lembap" value={`${snap.current.humidity}%`} />
                <Stat
                  icon={<Wind className="h-4 w-4" />}
                  label="Angin"
                  value={
                    <span className="flex items-center gap-1.5">
                      {Math.round(snap.current.wind)}
                      <small className="text-xs text-muted">km/j {compass(snap.current.windDir)}</small>
                      <Navigation className="h-3.5 w-3.5 text-muted" style={{ transform: `rotate(${snap.current.windDir + 180}deg)` }} />
                    </span>
                  }
                />
                <Stat icon={<Sun className="h-4 w-4" />} label="UV" value={snap.current.isDay ? snap.current.uv.toFixed(0) : `0 · maks ${snap.today.uvMax.toFixed(0)}`} />
                <Stat icon={<Eye className="h-4 w-4" />} label="Pandang" value={`${(snap.current.visibility / 1000).toFixed(1)} km`} />
                <Stat icon={<Gauge className="h-4 w-4" />} label="Tekanan" value={`${Math.round(snap.current.pressure)} hPa`} />
                <Stat icon={<Umbrella className="h-4 w-4" />} label="Hujan" value={`${snap.current.precip.toFixed(1)} mm`} />
                <Stat icon={<Sunrise className="h-4 w-4" />} label="Terbit" value={hourLabel(snap.today.sunrise)} />
                <Stat icon={<Sunset className="h-4 w-4" />} label="Terbenam" value={hourLabel(snap.today.sunset)} />
              </div>
            </section>

            {/* Keputusan keluar rumah */}
            <Verdict
              verdict={verdict!}
              windows={windows}
              sensitive={sensitive}
              onToggleSensitive={toggleSensitive}
              now={now}
              aqi={snap.air?.aqi ?? null}
              lastScan={lastScan}
              onScan={() => setScannerOpen(true)}
            />

            {/* Kualitas udara */}
            <AirCard snap={snap} />

            {/* Saran AI */}
            {advice && <AdviceCard key={advice.headline} advice={advice} loading={adviceLoading} />}

            {/* Prakiraan per jam */}
            <section className="animate-rise rounded-3xl border border-line bg-ink-2/90 p-5 sm:p-6 lg:col-span-12">
              <div className="flex items-baseline justify-between">
                <p className="label">24 jam ke depan</p>
                <p className="label hidden sm:block">suhu · peluang hujan · AQI</p>
              </div>
              <HourStrip points={snap.hourly} nowTime={snap.hourly[0]?.time} className="-mx-5 mt-4 px-5 sm:-mx-6 sm:px-6" />
            </section>

            {/* Prakiraan harian */}
            <WeekCard snap={snap} />
          </main>
        )}

        <footer className="mt-12 flex flex-col gap-6 border-t border-line pt-6 sm:flex-row sm:items-start sm:justify-between">
          <label className="flex cursor-pointer items-center gap-3">
            <button
              role="switch"
              aria-checked={simulate}
              onClick={toggleSim}
              className={`relative h-7 w-12 shrink-0 rounded-full border transition ${simulate ? "border-warn bg-warn/30" : "border-line-strong bg-ink-3"}`}
            >
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-paper transition-all ${simulate ? "left-6" : "left-0.5"}`} />
            </button>
            <span>
              <span className="block font-semibold">Simulasi kabut asap</span>
              <span className="block text-sm text-muted">Untuk demo: paksa kondisi udara buruk agar alur kamera bisa dicoba.</span>
            </span>
          </label>
          <p className="max-w-sm text-xs leading-relaxed text-faint">
            Cuaca: Open-Meteo. Kualitas udara:{" "}
            {stationEnabled
              ? "stasiun pemantau darat terdekat (jaringan WAQI, mis. BMKG) untuk angka sekarang; prakiraan dari model CAMS/Copernicus yang dikoreksi dengan hasil ukur stasiun."
              : "model CAMS/Copernicus (resolusi ± 40 km, bukan stasiun darat), dihitung ulang menjadi AQI dengan metode NowCast EPA."}{" "}
            Deteksi wajah: MediaPipe BlazeFace, berjalan di perangkatmu.{" "}
            {claudeEnabled ? "Saran teks oleh Claude (Anthropic)." : "Saran teks oleh aturan lokal."}
          </p>
        </footer>
      </div>

      <LocationPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={choosePlace} onUseGps={locate} locating={locating} />
      <MaskScanner
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onResult={onScanResult}
        aqi={snap?.air?.aqi ?? null}
        claudeEnabled={claudeEnabled}
      />
    </div>
  );
}

/* ---------- bagian-bagian ---------- */

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="bg-ink-2 p-3.5">
      <div className="flex items-center gap-1.5 text-muted">
        {icon}
        <span className="label">{label}</span>
      </div>
      <div className="mt-1.5 text-lg font-bold tabular">{value}</div>
    </div>
  );
}

function Verdict({
  verdict,
  windows,
  sensitive,
  onToggleSensitive,
  aqi,
  lastScan,
  onScan,
  now,
}: {
  verdict: Assessment;
  windows: { best: OutingWindow | null; worst: OutingWindow | null };
  sensitive: boolean;
  onToggleSensitive: () => void;
  now: number;
  aqi: number | null;
  lastScan: { outcome: ScanOutcome; at: number } | null;
  onScan: () => void;
}) {
  const L = LEVEL[verdict.level];
  const r = 52;
  const c = 2 * Math.PI * r;
  const scanOk = lastScan?.outcome === "mask" && now - lastScan.at < 60 * 60 * 1000;

  return (
    <section className={`animate-rise rounded-3xl border ${L.ring} bg-ink-2/90 p-5 sm:p-7 lg:col-span-5`}>
      <div className="flex items-center justify-between gap-3">
        <p className="label">Boleh keluar rumah?</p>
        <button
          onClick={onToggleSensitive}
          aria-pressed={sensitive}
          title="Asma, penyakit jantung/paru, anak, lansia, atau ibu hamil. Ambang bahaya udara dan panas jadi lebih ketat."
          className={`-my-1 flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition ${sensitive ? "border-gold/60 bg-gold/15 text-gold" : "border-line-strong text-muted hover:text-paper"}`}
        >
          <HeartPulse className="h-3.5 w-3.5" />
          {sensitive ? "Kelompok sensitif" : "Saya sensitif?"}
        </button>
      </div>
      <div className="mt-3 flex items-center gap-5">
        <div className="relative h-32 w-32 shrink-0">
          <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
            <circle cx="60" cy="60" r={r} fill="none" stroke="rgb(236 228 211 / .08)" strokeWidth="10" />
            <circle
              cx="60"
              cy="60"
              r={r}
              fill="none"
              stroke={L.color}
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={c}
              strokeDashoffset={c * (1 - verdict.score / 100)}
              style={{ transition: "stroke-dashoffset 1s cubic-bezier(.2,.7,.2,1)" }}
            />
          </svg>
          <div className="absolute inset-0 grid place-items-center text-center">
            <div>
              <div className="text-4xl font-extrabold tabular">{verdict.score}</div>
              <div className="font-mono text-[10px] text-muted">/ 100</div>
            </div>
          </div>
        </div>
        <div>
          <p className={`text-4xl font-extrabold uppercase tracking-tight ${L.text}`}>{L.label}</p>
          <p className="mt-1 text-sm text-muted">
            Indeks layak keluar, dihitung dari udara, hujan, panas, UV, dan angin
            {sensitive ? " dengan ambang untuk kelompok sensitif." : "."}
          </p>
        </div>
      </div>

      <ul className="mt-5 space-y-2.5">
        {verdict.hazards.length === 0 && (
          <li className="flex gap-3 text-paper/85">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-ok" /> Tidak ada peringatan aktif.
          </li>
        )}
        {verdict.hazards.slice(0, 4).map((h) => (
          <li key={h.id} className="flex gap-3">
            <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${h.level === "bahaya" ? "bg-danger" : "bg-warn"}`} />
            <span>
              <span className="font-semibold">{h.title}</span>
              <span className="block text-sm text-muted">{h.detail}</span>
            </span>
          </li>
        ))}
      </ul>

      {(windows.best || windows.worst) && (
        <dl className={`mt-5 grid ${windows.worst ? "grid-cols-2" : "grid-cols-1"} gap-px overflow-hidden rounded-2xl border border-line bg-line`}>
          {windows.best && (
            <WindowStat
              label={windowIsComfortable(windows.best) ? "Paling nyaman keluar" : "Paling aman keluar"}
              w={windows.best}
              tone={windowIsComfortable(windows.best) ? "text-ok" : "text-paper"}
            />
          )}
          {windows.worst && <WindowStat label="Sebaiknya hindari" w={windows.worst} tone="text-warn" />}
        </dl>
      )}

      {verdict.maskRequired ? (
        <div className="mt-6">
          {scanOk ? (
            <div className="flex items-center gap-3 rounded-2xl border border-ok/40 bg-ok/10 p-4">
              <ShieldCheck className="h-6 w-6 shrink-0 text-ok" />
              <div className="flex-1">
                <p className="font-semibold">Masker terverifikasi</p>
                <p className="text-sm text-muted">
                  Pukul {new Date(lastScan!.at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}. Hati-hati di jalan.
                </p>
              </div>
              <button onClick={onScan} className="text-sm font-semibold text-ok underline underline-offset-4">
                Ulang
              </button>
            </div>
          ) : (
            <button
              onClick={onScan}
              className="group relative flex w-full items-center gap-4 overflow-hidden rounded-2xl bg-danger p-4 text-left text-white shadow-[0_10px_40px_-12px_rgba(229,72,58,.7)] transition active:scale-[.98]"
            >
              <span className="relative grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white/15">
                <span className="absolute inset-0 animate-ping-slow rounded-full bg-white/30" />
                <ScanFace className="relative h-6 w-6" />
              </span>
              <span className="flex-1">
                <span className="block text-lg font-bold leading-tight">Wajib masker. Scan dulu sebelum keluar.</span>
                <span className="block text-sm text-white/80">
                  {lastScan?.outcome === "no_mask"
                    ? "Scan terakhir: belum bermasker."
                    : lastScan?.outcome === "nose_open"
                      ? "Scan terakhir: hidung masih terbuka."
                      : `AQI ${aqi}. Kamera akan mengecek maskermu.`}
                </span>
              </span>
            </button>
          )}
        </div>
      ) : (
        <button onClick={onScan} className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl border border-line-strong py-3.5 font-semibold hover:bg-ink-3">
          <ScanFace className="h-5 w-5 text-gold" /> Cek masker dengan kamera
          {verdict.maskAdvised && <span className="text-sm font-normal text-muted">· disarankan</span>}
        </button>
      )}
    </section>
  );
}

function WindowStat({ label, w, tone }: { label: string; w: OutingWindow; tone: string }) {
  return (
    <div className="bg-ink-2 p-3.5">
      <dt className="label">
        {label}
        {w.tomorrow && " · besok"}
      </dt>
      <dd className={`mt-1 text-lg font-bold tabular ${tone}`}>
        {w.start.replace(":", ".")}–{w.end.replace(":", ".")}
      </dd>
      <dd className="font-mono text-[11px] text-muted tabular">
        {w.aqi != null && `AQI ${w.aqi} · `}hujan {w.pop}% · {Math.round(w.feels)}°
      </dd>
    </div>
  );
}

function AirCard({ snap }: { snap: Snapshot }) {
  const air = snap.air;
  if (!air) {
    return (
      <section className="rounded-3xl border border-line bg-ink-2/80 p-6 lg:col-span-5">
        <p className="label">Kualitas udara</p>
        <p className="mt-3 text-muted">Data kualitas udara sedang tidak tersedia untuk lokasi ini.</p>
      </section>
    );
  }
  const band = aqiBand(air.aqi);
  const st = air.station;
  const pos = Math.min(100, (Math.min(air.aqi, 500) / 500) * 100);
  // Lebar segmen proporsional dengan rentang AQI-nya.
  const segs = AQI_BANDS.map((b, i) => ({ color: b.color, w: ((b.max - (AQI_BANDS[i - 1]?.max ?? 0)) / 500) * 100 }));

  return (
    <section className="animate-rise rounded-3xl border border-line bg-ink-2/90 p-5 sm:p-7 lg:col-span-5">
      <div className="flex items-baseline justify-between">
        <p className="label">Kualitas udara · AQI (US)</p>
        <p className="font-mono text-[11px] text-faint">{(st ? st.time : air.time).slice(11, 16)}</p>
      </div>
      {st ? (
        <p className="mt-2 flex items-center gap-1.5 text-sm">
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping-slow rounded-full bg-ok" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-ok" />
          </span>
          <span className="min-w-0">
            Terukur di{" "}
            {st.url ? (
              <a href={st.url} target="_blank" rel="noreferrer" className="font-semibold underline decoration-line-strong underline-offset-4 hover:decoration-gold">
                {st.name}
              </a>
            ) : (
              <b>{st.name}</b>
            )}{" "}
            <span className="text-muted">· {st.km < 1 ? "< 1" : Math.round(st.km)} km · {st.attribution}</span>
          </span>
        </p>
      ) : (
        <p className="mt-2 text-sm text-muted">Perkiraan model CAMS (± 40 km), belum ada stasiun darat yang terhubung.</p>
      )}
      <div className="mt-2 flex items-end gap-4">
        <span className="text-7xl font-extrabold leading-none tracking-tighter tabular" style={{ color: band.color }}>
          {air.aqi}
        </span>
        <span className="pb-1.5">
          <span className="block text-lg font-semibold leading-tight">{band.label}</span>
          <span className="block font-mono text-[11px] text-muted">
            {st ? `stasiun · model CAMS: ${air.modelAqi}` : `dominan ${air.dominant} · NowCast EPA`}
          </span>
        </span>
      </div>

      <div className="relative mt-6">
        <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full">
          {segs.map((s, i) => (
            <div key={i} style={{ width: `${s.w}%`, background: s.color, opacity: 0.85 }} />
          ))}
        </div>
        <div className="absolute -top-1.5 h-5.5 w-1.5 -translate-x-1/2 rounded-full bg-paper ring-4 ring-ink-2" style={{ left: `${pos}%` }} />
        <div className="mt-2 flex justify-between font-mono text-[10px] text-faint">
          <span>0</span>
          <span>100</span>
          <span>200</span>
          <span>300</span>
          <span>500</span>
        </div>
      </div>

      <dl className="mt-6 grid grid-cols-3 gap-px overflow-hidden rounded-2xl border border-line bg-line">
        <Pollutant name="PM2.5" value={air.pm25} note={whoNote(air.pm25Avg24, 15)} warn={(air.pm25Avg24 ?? 0) > 15} />
        <Pollutant name="PM10" value={air.pm10} note={whoNote(air.pm10Avg24, 45)} warn={(air.pm10Avg24 ?? 0) > 45} />
        <Pollutant name="O₃" value={air.o3} note={air.o3 >= 245 ? "tinggi" : undefined} warn={air.o3 >= 245} />
        <Pollutant name="CO" value={air.co} />
        <Pollutant name="NO₂" value={air.no2} />
        <div className="bg-ink-2 p-3">
          <dt className="label">Satuan</dt>
          <dd className="mt-1 text-sm text-muted">µg/m³{st && <span className="block font-mono text-[10px] text-faint">model CAMS</span>}</dd>
        </div>
      </dl>
    </section>
  );
}

/** Pedoman WHO berlaku untuk rata-rata 24 jam, bukan nilai sesaat. */
function whoNote(avg24: number | null, limit: number) {
  return avg24 == null ? undefined : `24j: ${(avg24 / limit).toFixed(1)}× WHO`;
}

function Pollutant({ name, value, note, warn }: { name: string; value: number; note?: string; warn?: boolean }) {
  return (
    <div className="bg-ink-2 p-3">
      <dt className="label normal-case tracking-normal">{name}</dt>
      <dd className="mt-1 text-lg font-bold tabular">{value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value.toFixed(0)}</dd>
      {note && <dd className={`font-mono text-[10px] ${warn ? "text-warn" : "text-faint"}`}>{note}</dd>}
    </div>
  );
}

function AdviceCard({ advice, loading }: { advice: Advice; loading: boolean }) {
  const [done, setDone] = useState<Set<number>>(new Set());

  return (
    <section className="animate-rise rounded-3xl border border-line bg-ink-2/90 p-5 sm:p-7 lg:col-span-7">
      <div className="flex items-center justify-between">
        <p className="label">Saran untuk beberapa jam ke depan</p>
        <span className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-muted">
          {loading ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" /> Claude menulis…
            </>
          ) : advice.source === "claude" ? (
            "ditulis Claude"
          ) : (
            "aturan lokal"
          )}
        </span>
      </div>
      <h2 className="mt-3 text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">{advice.headline}</h2>
      {advice.summary && <p className="mt-3 text-lg leading-relaxed text-paper/80">{advice.summary}</p>}

      <p className="label mt-6">Sebelum keluar</p>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
        {advice.checklist.map((item, i) => {
          const on = done.has(i);
          return (
            <li key={item}>
              <button
                onClick={() =>
                  setDone((s) => {
                    const n = new Set(s);
                    if (n.has(i)) n.delete(i);
                    else n.add(i);
                    return n;
                  })
                }
                className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition ${on ? "border-ok/40 bg-ok/10 text-paper/60 line-through" : "border-line hover:border-line-strong"}`}
              >
                <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border ${on ? "border-ok bg-ok text-ink" : "border-line-strong"}`}>
                  {on && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                </span>
                {item}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function WeekCard({ snap }: { snap: Snapshot }) {
  const [openDate, setOpenDate] = useState<string | null>(null);
  const days = snap.daily;
  const lo = Math.min(...days.map((d) => d.min));
  const hi = Math.max(...days.map((d) => d.max));
  const span = Math.max(1, hi - lo);
  const weekday = new Intl.DateTimeFormat("id-ID", { weekday: "short", timeZone: "UTC" });

  return (
    <section className="animate-rise rounded-3xl border border-line bg-ink-2/90 p-5 sm:p-6 lg:col-span-12">
      <div className="flex items-baseline justify-between">
        <p className="label">7 hari ke depan · ketuk untuk rincian</p>
        <p className="label hidden sm:block">hujan · suhu min–maks · AQI maks</p>
      </div>
      <ul className="mt-3 divide-y divide-line">
        {days.map((d, i) => {
          const sky = describeCode(d.code);
          const band = d.aqiMax != null ? aqiBand(d.aqiMax) : null;
          const name = i === 0 ? "Hari ini" : i === 1 ? "Besok" : `${weekday.format(new Date(`${d.date}T00:00Z`))} ${Number(d.date.slice(8))}`;
          const open = openDate === d.date;
          const hours = open ? snap.hours.filter((h) => h.time.startsWith(d.date)) : [];
          return (
            <li key={d.date}>
              <button
                onClick={() => setOpenDate(open ? null : d.date)}
                aria-expanded={open}
                className="-mx-2 grid w-[calc(100%+1rem)] grid-cols-[3.9rem_1.5rem_2.6rem_1.6rem_minmax(0,1fr)_1.6rem_2.6rem] items-center gap-x-2 rounded-xl px-2 py-2.5 text-left hover:bg-ink-3/60 sm:grid-cols-[6rem_1.75rem_4rem_2rem_minmax(0,1fr)_2rem_4.5rem] sm:gap-x-4"
              >
                <span className="flex items-center gap-1 truncate text-sm font-semibold">
                  {name}
                  <ChevronDown className={`h-3 w-3 shrink-0 text-faint transition ${open ? "rotate-180" : ""}`} />
                </span>
                <span title={sky.label}>
                  <SkyIcon kind={band && d.aqiMax! > 150 && sky.kind !== "rain" && sky.kind !== "storm" ? "haze" : sky.kind} isDay className="h-5 w-5 text-paper/90" />
                </span>
                <span className="font-mono text-xs text-[#6fb3d2] tabular" title={`${d.rain.toFixed(1)} mm`}>
                  {d.pop}%
                </span>
                <span className="text-right text-sm text-muted tabular">{Math.round(d.min)}°</span>
                <span className="relative h-1.5 rounded-full bg-ink-3">
                  <span
                    className="absolute inset-y-0 rounded-full bg-gradient-to-r from-[#6fb3d2] to-gold"
                    style={{ left: `${((d.min - lo) / span) * 100}%`, right: `${((hi - d.max) / span) * 100}%` }}
                  />
                </span>
                <span className="text-sm font-bold tabular">{Math.round(d.max)}°</span>
                {band ? (
                  <span
                    className={`justify-self-end rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular ${band.max > 200 ? "text-white" : "text-ink"}`}
                    style={{ background: band.color }}
                    title={band.label}
                  >
                    {d.aqiMax}
                  </span>
                ) : (
                  <span className="justify-self-end font-mono text-[11px] text-faint" title="Di luar jangkauan model kualitas udara (± 5 hari)">
                    —
                  </span>
                )}
              </button>
              {open && (
                <div className="pb-3">
                  <p className="mb-2 font-mono text-[11px] text-muted">
                    {sky.label} · hujan {d.rain.toFixed(1)} mm · UV maks {d.uvMax.toFixed(0)} · angin s.d. {Math.round(d.gustMax)} km/j · {hourLabel(d.sunrise)}–{hourLabel(d.sunset)}
                  </p>
                  <HourStrip points={hours} nowTime={snap.hourly[0]?.time} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Deret kartu per jam: ikon, suhu, peluang hujan, dan warna AQI. */
function HourStrip({ points, nowTime, className = "" }: { points: HourPoint[]; nowTime?: string; className?: string }) {
  return (
    <div className={`no-scrollbar flex snap-x gap-2 overflow-x-auto ${className}`}>
      {points.map((h) => {
        const k = describeCode(h.code).kind;
        const band = h.aqi != null ? aqiBand(h.aqi) : null;
        const isNow = h.time === nowTime;
        return (
          <div
            key={h.time}
            className={`flex w-[4.25rem] shrink-0 snap-start flex-col items-center gap-2 rounded-2xl border py-3 ${isNow ? "border-gold/50 bg-gold/5" : "border-line"}`}
          >
            <span className="font-mono text-[11px] text-muted">{isNow ? "Kini" : hourLabel(h.time)}</span>
            <SkyIcon kind={band && h.aqi! > 150 && k !== "rain" && k !== "storm" ? "haze" : k} isDay={h.isDay} className="h-6 w-6 text-paper/90" />
            <span className="text-lg font-bold tabular">{Math.round(h.temp)}°</span>
            <div className="flex h-10 w-1.5 items-end overflow-hidden rounded-full bg-ink-3" title={`Peluang hujan ${h.pop}%`}>
              <div className="w-full rounded-full bg-[#6fb3d2]" style={{ height: `${h.pop}%` }} />
            </div>
            <span className="font-mono text-[10px] text-muted tabular">{h.pop}%</span>
            {band && <span className="h-1.5 w-6 rounded-full" style={{ background: band.color }} title={`AQI ${h.aqi}`} />}
          </div>
        );
      })}
    </div>
  );
}

/** Satu kalimat ringkas dari angka nyata — pengganti teks pemasaran di bagian atas. */
function heroLine(s: Snapshot, skyLabel: string, best: OutingWindow | null) {
  const parts = [`${Math.round(s.current.temp)}° dan ${skyLabel.toLowerCase()}`];
  if (s.air) parts.push(`udara ${aqiBand(s.air.aqi).label.toLowerCase()} (AQI ${s.air.aqi})`);
  let line = `${parts.join(", ")}.`;
  if (best) line += ` ${windowIsComfortable(best) ? "Jam paling nyaman keluar" : "Waktu paling aman keluar"}: ${windowLabel(best)}.`;
  return line;
}

function Skeleton() {
  return (
    <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-12">
      {["lg:col-span-7", "lg:col-span-5", "lg:col-span-5", "lg:col-span-7"].map((span, i) => (
        <div key={i} className={`h-72 animate-pulse rounded-3xl border border-line bg-ink-2/60 ${span}`} />
      ))}
    </div>
  );
}

function tzLabel(tz?: string) {
  return tz === "Asia/Jakarta" || tz === "Asia/Pontianak" ? "WIB" : tz === "Asia/Makassar" ? "WITA" : tz === "Asia/Jayapura" ? "WIT" : "";
}

