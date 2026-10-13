"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, FlaskConical, MapPin, Minus, Navigation, RefreshCw, ScanFace, ShieldCheck, TrendingDown, TrendingUp } from "lucide-react";
import { AeroSenseMark, AeroSenseWordmark } from "./AeroSenseLogo";
import LocationPicker from "./LocationPicker";
import MaskScanner, { type ScanOutcome } from "./MaskScanner";
import SkyIcon from "./SkyIcon";
import {
  AQI_BANDS,
  PALEMBANG,
  applyStation,
  aqiBand,
  aqiTrend,
  clockLabel,
  compass,
  describeCode,
  fetchSnapshot,
  fetchStation,
  reverseGeocode,
  simulateHaze,
  skyOf,
  type HourPoint,
  type Place,
  type Snapshot,
} from "@/lib/weather";

const REFRESH_MS = 10 * 60 * 1000;
const PLACE_KEY = "aerosense:place";
const SIM_KEY = "aerosense:sim";
// Versi di nama kunci: bentuk Snapshot berubah → cache lama otomatis diabaikan.
const SNAP_KEY = "aerosense:snap:v4";
/** Kunci dari versi lama yang tidak dipakai lagi; dihapus supaya tidak memenuhi penyimpanan. */
const OLD_KEYS = ["aerosense:snap:v3", "aerosense:sensitive"];
/** Data tersimpan lebih tua dari ini tidak ditampilkan sama sekali. */
const SNAP_MAX_AGE_MS = 3 * 60 * 60 * 1000;
/** Hasil scan masker dianggap masih berlaku selama ini. */
const SCAN_VALID_MS = 60 * 60 * 1000;

type Stored = { place: Place | null; simulate: boolean; snap: Snapshot | null };

function readStored(): Stored {
  try {
    OLD_KEYS.forEach((k) => localStorage.removeItem(k));
    const place: Place | null = JSON.parse(localStorage.getItem(PLACE_KEY) || "null");
    const where = place ?? PALEMBANG;
    const cached: { lat: number; lon: number; snap: Snapshot } | null = JSON.parse(localStorage.getItem(SNAP_KEY) || "null");
    const fresh =
      cached && cached.lat === where.lat && cached.lon === where.lon && Date.now() - cached.snap.fetchedAt < SNAP_MAX_AGE_MS;
    return { place, simulate: localStorage.getItem(SIM_KEY) === "1", snap: fresh ? cached.snap : null };
  } catch {
    return { place: null, simulate: false, snap: null };
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

/** Angka gaya Indonesia: koma desimal, titik ribuan. */
function fmt(v: number, digits = 0): string {
  return v.toLocaleString("id-ID", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Dirender hanya di browser (lihat ClientApp), jadi localStorage aman dibaca saat inisialisasi. */
export default function AeroSenseApp() {
  const [initial] = useState(readStored);
  const [place, setPlace] = useState<Place>(initial.place ?? PALEMBANG);
  // Data terakhir langsung tampil saat aplikasi dibuka; data baru menyusul beberapa detik kemudian.
  const [real, setReal] = useState<Snapshot | null>(initial.snap);
  // Galat GPS dan galat pengambilan data dipisah: hanya yang kedua berarti angka di layar sudah lama.
  const [error, setError] = useState("");
  const [dataError, setDataError] = useState("");
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [simulate, setSimulate] = useState(initial.simulate);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [lastScan, setLastScan] = useState<{ outcome: ScanOutcome; at: number } | null>(null);
  const [stationEnabled, setStationEnabled] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  /* ---------- lokasi ---------- */

  const choosePlace = useCallback((p: Place) => {
    setPlace(p);
    setReal(null);
    setError("");
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
          setDataError("");
          store(SNAP_KEY, JSON.stringify({ lat: p.lat, lon: p.lon, snap }));
        })
        .catch((e: Error) => setDataError(navigator.onLine ? `Gagal memperbarui data (${e.message}).` : "Tidak ada koneksi internet."))
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
      if (document.visibilityState === "visible") {
        setNow(Date.now());
        load(place);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [place, load]);

  // Hanya untuk masa berlaku hasil scan masker, jadi cukup tiap menit.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const toggleSim = () => {
    store(SIM_KEY, simulate ? "0" : "1");
    setSimulate(!simulate);
  };

  const snap = useMemo(() => (real && simulate ? simulateHaze(real) : real), [real, simulate]);
  const onScanResult = useCallback((outcome: ScanOutcome) => setLastScan({ outcome, at: Date.now() }), []);
  const scan = lastScan && now - lastScan.at < SCAN_VALID_MS ? lastScan : null;

  /* ---------- render ---------- */

  return (
    <div className="mx-auto min-h-svh max-w-5xl px-4 pb-12 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-6">
      <header className="flex items-center justify-between gap-3 py-2">
        <div className="flex items-center gap-2">
          <AeroSenseMark className="h-8 w-8" />
          <AeroSenseWordmark className="text-xl" />
        </div>
        <button
          onClick={() => setPickerOpen(true)}
          className="flex min-w-0 items-center gap-1.5 rounded-full border border-line-strong bg-ink-2 py-2 pl-3 pr-2.5 text-sm hover:border-gold/60"
        >
          {place.source === "gps" ? <Navigation className="h-3.5 w-3.5 shrink-0 text-gold" /> : <MapPin className="h-3.5 w-3.5 shrink-0 text-gold" />}
          <span className="max-w-[10rem] truncate font-semibold">{place.name ?? "…"}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted" />
        </button>
      </header>

      {snap?.simulated && (
        <div className="mt-3 flex items-center gap-3 rounded-2xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm">
          <FlaskConical className="h-4 w-4 shrink-0 text-warn" />
          <span>
            <b>Mode simulasi.</b> Angka kualitas udara di bawah adalah skenario demo, bukan data asli.
          </span>
          <button onClick={toggleSim} className="ml-auto shrink-0 font-semibold text-warn underline underline-offset-4">
            Matikan
          </button>
        </div>
      )}

      {(error || dataError) && (
        <p className="mt-3 rounded-2xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm">
          {dataError ? `${dataError}${real ? ` Menampilkan data pukul ${clockLabel(real.current.time)}.` : ""}` : error}
        </p>
      )}

      {!snap ? (
        <Skeleton />
      ) : (
        <main className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2 lg:gap-4">
          <div className="space-y-3 lg:space-y-4">
            <AqiCard snap={snap} loading={loading} onRefresh={refresh} />
            {snap.air && <GuideCard snap={snap} scan={scan} onScan={() => setScannerOpen(true)} />}
          </div>
          <div className="space-y-3 lg:space-y-4">
            <HourChart hourly={snap.hourly} />
            {snap.air && <PollutantCard snap={snap} />}
            <WeatherCard snap={snap} />
          </div>
          <WeekCard snap={snap} />
        </main>
      )}

      <footer className="mt-10 space-y-5 border-t border-line pt-5">
        <p className="text-xs leading-relaxed text-faint">
          Kualitas udara:{" "}
          {stationEnabled
            ? "stasiun pemantau darat terdekat (jaringan WAQI, mis. BMKG) untuk angka sekarang; prakiraan dari model CAMS/Copernicus yang dikoreksi dengan hasil ukur stasiun."
            : "model CAMS/Copernicus (resolusi ± 40 km), dihitung ulang menjadi AQI dengan metode NowCast EPA."}{" "}
          Cuaca: Open-Meteo. Data diperbarui tiap 10 menit.
        </p>
        <label className="flex cursor-pointer items-center gap-3 text-sm">
          <button
            role="switch"
            aria-checked={simulate}
            onClick={toggleSim}
            className={`relative h-6 w-10 shrink-0 rounded-full border transition ${simulate ? "border-warn bg-warn/30" : "border-line-strong bg-ink-3"}`}
          >
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-paper transition-all ${simulate ? "left-5" : "left-0.5"}`} />
          </button>
          <span className="text-muted">Simulasi kabut asap (untuk demo)</span>
        </label>
      </footer>

      <LocationPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={choosePlace} onUseGps={locate} locating={locating} />
      <MaskScanner open={scannerOpen} onClose={() => setScannerOpen(false)} onResult={onScanResult} aqi={snap?.air?.aqi ?? null} />
    </div>
  );
}

/* ---------- bagian-bagian ---------- */

function Card({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return <section className={`rounded-3xl border border-line bg-ink-2 p-5 sm:p-6 ${className}`}>{children}</section>;
}

/** Posisi AQI di skala dengan lebar kategori yang sama, supaya kategori rendah tetap terbaca. */
function scalePos(aqi: number): number {
  const i = AQI_BANDS.findIndex((b) => aqi <= b.max);
  if (i < 0) return 100;
  const lo = i === 0 ? 0 : AQI_BANDS[i - 1].max;
  return ((i + (aqi - lo) / (AQI_BANDS[i].max - lo)) / AQI_BANDS.length) * 100;
}

function AqiCard({ snap, loading, onRefresh }: { snap: Snapshot; loading: boolean; onRefresh: () => void }) {
  const air = snap.air;
  const refreshButton = (
    <button
      onClick={onRefresh}
      className="-m-2 grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted hover:bg-ink-3 hover:text-paper"
      aria-label="Muat ulang data"
    >
      <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
    </button>
  );

  if (!air) {
    return (
      <Card>
        <div className="flex items-start justify-between gap-3">
          <p className="label">Kualitas udara</p>
          {refreshButton}
        </div>
        <p className="mt-2 text-muted">Data kualitas udara sedang tidak tersedia untuk lokasi ini.</p>
      </Card>
    );
  }

  const band = aqiBand(air.aqi);
  const st = air.station;
  const trend = aqiTrend(snap);
  const hasNext = snap.hourly.slice(1, 7).some((p) => p.aqi != null);
  const ticks = [0, ...AQI_BANDS.map((b) => b.max)];

  return (
    <section className="relative overflow-hidden rounded-3xl border border-line bg-ink-2 p-5 sm:p-6">
      {/* Latar diwarnai kategori AQI, supaya statusnya terbaca sekilas. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[.13]" style={{ background: band.color }} />
      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <p className="label">
            Kualitas udara · pukul {clockLabel(st ? st.time : air.time)} {tzLabel(snap.timezone)}
          </p>
          {refreshButton}
        </div>

        <div className="mt-1 flex items-end gap-4">
          <span className="text-[5.5rem] font-extrabold leading-[0.8] tracking-tighter tabular sm:text-[6.5rem]">{air.aqi}</span>
          <div className="min-w-0 pb-1">
            <p className="flex items-start gap-2 text-lg font-bold leading-tight sm:text-xl">
              <span className="mt-[0.4em] h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: band.color }} />
              {band.label}
            </p>
            <p className="mt-0.5 text-sm text-muted">AQI (US) · {air.dominant} dominan</p>
          </div>
        </div>

        <div className="mt-6">
          <div className="relative">
            <div className="flex h-2 gap-0.5 overflow-hidden rounded-full">
              {AQI_BANDS.map((b) => (
                <div key={b.max} className="flex-1" style={{ background: b.color }} />
              ))}
            </div>
            <div
              className="absolute -top-1.5 h-5 w-1.5 -translate-x-1/2 rounded-full bg-paper ring-[3px] ring-ink-2"
              style={{ left: `${scalePos(air.aqi)}%` }}
            />
          </div>
          <div className="relative mt-1.5 h-3 text-[10px] leading-none text-faint tabular">
            {ticks.map((t, i) => (
              <span
                key={t}
                className="absolute"
                style={{ left: `${(i / AQI_BANDS.length) * 100}%`, transform: i === 0 ? "none" : i === ticks.length - 1 ? "translateX(-100%)" : "translateX(-50%)" }}
              >
                {t}
              </span>
            ))}
          </div>
        </div>

        {hasNext && (
          <p className="mt-5 flex items-center gap-2 text-sm">
            {trend?.dir === "naik" ? (
              <TrendingUp className="h-4 w-4 shrink-0 text-warn" />
            ) : trend?.dir === "turun" ? (
              <TrendingDown className="h-4 w-4 shrink-0 text-ok" />
            ) : (
              <Minus className="h-4 w-4 shrink-0 text-muted" />
            )}
            {trend
              ? `Diperkirakan ${trend.dir} ke ${trend.to} (${aqiBand(trend.to).label.toLowerCase()}) sekitar pukul ${trend.at.replace(":", ".")}.`
              : "Relatif stabil 6 jam ke depan."}
          </p>
        )}

        <p className="mt-3 border-t border-line pt-3 text-xs leading-relaxed text-muted">
          {st ? (
            <>
              Terukur di stasiun{" "}
              {st.url ? (
                <a href={st.url} target="_blank" rel="noreferrer" className="font-semibold text-paper underline decoration-line-strong underline-offset-2">
                  {st.name}
                </a>
              ) : (
                <b className="text-paper">{st.name}</b>
              )}{" "}
              ({st.attribution}), {st.km < 1 ? "< 1" : Math.round(st.km)} km dari lokasi.
            </>
          ) : (
            "Perkiraan model satelit CAMS (resolusi ± 40 km). Saat kabut asap tebal, angka sebenarnya bisa lebih tinggi."
          )}
        </p>
      </div>
    </section>
  );
}

function GuideCard({ snap, scan, onScan }: { snap: Snapshot; scan: { outcome: ScanOutcome; at: number } | null; onScan: () => void }) {
  const air = snap.air!;
  const band = aqiBand(air.aqi);
  const maskNeeded = air.aqi > 100;

  return (
    <Card>
      <p className="label">Yang perlu dilakukan</p>
      <dl className="mt-1 divide-y divide-line">
        <GuideRow label="Masker" value={band.mask} />
        <GuideRow label="Jendela & pintu" value={band.room} />
        <GuideRow label="Kelompok sensitif" hint="Anak, lansia, ibu hamil, penderita asma atau penyakit jantung" value={band.sensitive} />
      </dl>
      {air.o3 >= 245 && (
        <p className="mt-2 text-sm text-warn">Ozon tinggi ({fmt(air.o3)} µg/m³). Masker biasa tidak menyaring ozon.</p>
      )}

      {scan?.outcome === "mask" ? (
        <div className="mt-4 flex items-center gap-3 rounded-2xl border border-ok/40 bg-ok/10 px-4 py-3">
          <ShieldCheck className="h-5 w-5 shrink-0 text-ok" />
          <p className="flex-1 text-sm">
            <b>Masker terpasang benar</b>{" "}
            <span className="text-muted">· dicek pukul {new Date(scan.at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</span>
          </p>
          <button onClick={onScan} className="text-sm font-semibold text-ok underline underline-offset-4">
            Ulang
          </button>
        </div>
      ) : maskNeeded ? (
        <button
          onClick={onScan}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-paper py-3 font-semibold text-ink transition active:scale-[.98]"
        >
          <ScanFace className="h-5 w-5" />
          {scan?.outcome === "nose_open" ? "Hidung masih terbuka · cek lagi" : scan?.outcome === "no_mask" ? "Belum bermasker · cek lagi" : "Cek pemakaian masker"}
        </button>
      ) : (
        <button onClick={onScan} className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-paper">
          <ScanFace className="h-4 w-4" /> Cek pemakaian masker
        </button>
      )}
    </Card>
  );
}

function GuideRow({ label, hint, value }: { label: string; hint?: string; value: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] gap-3 py-3 sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)]">
      <dt className="text-sm text-muted">
        {label}
        {hint && <span className="mt-0.5 block text-[11px] leading-snug text-faint">{hint}</span>}
      </dt>
      <dd className="font-semibold leading-snug">{value}</dd>
    </div>
  );
}

/** Grafik batang AQI 24 jam ke depan. Ketuk batang untuk melihat angkanya. */
function HourChart({ hourly }: { hourly: HourPoint[] }) {
  const [picked, setPicked] = useState(0);
  const known = hourly.filter((p): p is HourPoint & { aqi: number } => p.aqi != null);
  if (known.length === 0) return null;

  const sel = Math.min(picked, hourly.length - 1);
  const top = Math.max(100, ...known.map((p) => p.aqi)) * 1.1;
  const hi = known.reduce((m, p) => (p.aqi > m.aqi ? p : m));
  const lo = known.reduce((m, p) => (p.aqi < m.aqi ? p : m));
  const s = hourly[sel];

  const line = (100 / top) * 100;

  return (
    <Card>
      <p className="label">AQI 24 jam ke depan</p>
      <p className="mt-1 text-sm tabular" aria-live="polite">
        <span className="text-muted">{sel === 0 ? "Sekarang" : `Pukul ${clockLabel(s.time)}`}: </span>
        {s.aqi != null ? (
          <>
            <b>{s.aqi}</b> <span className="text-muted">{aqiBand(s.aqi).label.toLowerCase()} · hujan {s.pop}%</span>
          </>
        ) : (
          <span className="text-muted">tidak ada data AQI · hujan {s.pop}%</span>
        )}
      </p>

      {/* Kolom kanan selebar w-7 untuk label garis batas AQI 100. */}
      <div className="mt-4 flex gap-1.5">
        <div className="relative h-28 flex-1">
          <div className="flex h-full items-end gap-[3px]">
            {hourly.map((p, i) => (
              <button
                key={p.time}
                onClick={() => setPicked(i)}
                aria-label={`Pukul ${clockLabel(p.time)}, AQI ${p.aqi ?? "tidak ada"}`}
                aria-pressed={i === sel}
                className="flex h-full flex-1 items-end"
              >
                <span
                  className={`block w-full rounded-t-[3px] ${i === sel ? "border-t-[3px] border-paper" : ""}`}
                  style={{
                    height: p.aqi != null ? `${Math.max(4, (p.aqi / top) * 100)}%` : "4%",
                    background: p.aqi != null ? aqiBand(p.aqi).color : "var(--color-ink-3)",
                  }}
                />
              </button>
            ))}
          </div>
          <div aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-dashed border-paper/40" style={{ bottom: `${line}%` }} />
        </div>
        <div aria-hidden className="relative w-7 text-[10px] leading-none text-faint tabular">
          <span className="absolute left-0 translate-y-1/2" style={{ bottom: `${line}%` }}>
            100
          </span>
        </div>
      </div>
      <div className="relative mr-[2.125rem] mt-1.5 h-3 text-[10px] leading-none text-faint tabular">
        {hourly.map((p, i) =>
          Number(p.time.slice(11, 13)) % 6 === 0 ? (
            <span key={p.time} className="absolute -translate-x-1/2" style={{ left: `${((i + 0.5) / hourly.length) * 100}%` }}>
              {clockLabel(p.time)}
            </span>
          ) : null,
        )}
      </div>

      {hi.aqi !== lo.aqi && (
        <p className="mt-4 text-sm text-muted">
          Tertinggi <b className="text-paper">{hi.aqi}</b> pukul {clockLabel(hi.time)} · terendah <b className="text-paper">{lo.aqi}</b> pukul{" "}
          {clockLabel(lo.time)}
        </p>
      )}
    </Card>
  );
}

function PollutantCard({ snap }: { snap: Snapshot }) {
  const air = snap.air!;
  return (
    <Card>
      <div className="flex items-baseline justify-between gap-3">
        <p className="label">Polutan</p>
        <p className="text-xs text-faint">µg/m³{air.station && " · model CAMS"}</p>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-x-4 gap-y-4 sm:grid-cols-5 lg:grid-cols-3">
        <Pollutant name="PM2.5" value={air.pm25} who={whoNote(air.pm25Avg24, 15)} />
        <Pollutant name="PM10" value={air.pm10} who={whoNote(air.pm10Avg24, 45)} />
        <Pollutant name="O₃" value={air.o3} />
        <Pollutant name="NO₂" value={air.no2} />
        <Pollutant name="CO" value={air.co} />
      </dl>
    </Card>
  );
}

/** Pedoman WHO berlaku untuk rata-rata 24 jam, bukan nilai sesaat. */
function whoNote(avg24: number | null, limit: number): { text: string; over: boolean } | undefined {
  if (avg24 == null) return undefined;
  const x = avg24 / limit;
  return x > 1 ? { text: `${fmt(x, 1)}× batas WHO`, over: true } : { text: "di bawah batas WHO", over: false };
}

function Pollutant({ name, value, who }: { name: string; value: number; who?: { text: string; over: boolean } }) {
  return (
    <div>
      <dt className="text-sm text-muted">{name}</dt>
      <dd className="text-xl font-bold tabular">{fmt(value)}</dd>
      {who && <dd className={`text-[11px] leading-snug ${who.over ? "text-warn" : "text-faint"}`}>{who.text}</dd>}
    </div>
  );
}

function WeatherCard({ snap }: { snap: Snapshot }) {
  const c = snap.current;
  const sky = skyOf(snap);
  const rain3h = Math.max(0, ...snap.hourly.slice(0, 4).map((p) => p.pop));
  const today = snap.daily[0];

  return (
    <Card>
      <p className="label">Cuaca</p>
      <div className="mt-2 flex items-center gap-4">
        <SkyIcon kind={sky.kind} isDay={c.isDay} className="h-12 w-12 shrink-0 text-gold" />
        <div className="min-w-0">
          <p className="text-4xl font-bold leading-none tabular">{Math.round(c.temp)}°</p>
          <p className="mt-1 text-sm text-muted">
            {sky.label} · terasa {Math.round(c.feels)}°{today && ` · ${Math.round(today.min)}°–${Math.round(today.max)}°`}
          </p>
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <Fact label="Angin" value={`${fmt(c.wind)} km/j`} sub={`dari ${compass(c.windDir)}`} />
        <Fact label="Jarak pandang" value={`${fmt(c.visibility / 1000, c.visibility < 10_000 ? 1 : 0)} km`} />
        <Fact label="Kelembapan" value={`${c.humidity}%`} />
        <Fact label="Peluang hujan" value={`${rain3h}%`} sub="3 jam ke depan" />
      </dl>
    </Card>
  );
}

function Fact({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-lg font-bold tabular">{value}</dd>
      {sub && <dd className="text-[11px] text-faint">{sub}</dd>}
    </div>
  );
}

function WeekCard({ snap }: { snap: Snapshot }) {
  const weekday = new Intl.DateTimeFormat("id-ID", { weekday: "short", timeZone: "UTC" });

  return (
    <Card className="lg:col-span-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="label">7 hari ke depan</p>
        <p className="text-xs text-faint">AQI tertinggi · hujan · suhu</p>
      </div>
      <ul className="mt-2 divide-y divide-line">
        {snap.daily.map((d, i) => {
          const sky = describeCode(d.code);
          const band = d.aqiMax != null ? aqiBand(d.aqiMax) : null;
          const name = i === 0 ? "Hari ini" : i === 1 ? "Besok" : `${weekday.format(new Date(`${d.date}T00:00Z`))} ${Number(d.date.slice(8))}`;
          return (
            <li
              key={d.date}
              className="grid grid-cols-[minmax(0,1fr)_2.75rem_1.25rem_2.5rem_4.75rem] items-center gap-x-2.5 py-2.5 sm:grid-cols-[minmax(0,8rem)_minmax(0,1fr)_1.5rem_3rem_5rem] sm:gap-x-4"
            >
              <span className="truncate text-sm font-semibold">{name}</span>
              {band ? (
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="w-11 shrink-0 rounded-md py-0.5 text-center text-xs font-bold tabular"
                    style={{ background: band.color, color: band.onColor }}
                  >
                    {d.aqiMax}
                  </span>
                  <span className="hidden truncate text-sm text-muted sm:inline">{band.label}</span>
                </span>
              ) : (
                <span className="w-11 text-center text-xs text-faint" title="Di luar jangkauan model kualitas udara (± 5 hari)">
                  —
                </span>
              )}
              <span title={sky.label}>
                <SkyIcon kind={band && d.aqiMax! > 150 && sky.kind !== "rain" && sky.kind !== "storm" ? "haze" : sky.kind} isDay className="h-5 w-5 text-muted" />
              </span>
              <span className="text-right text-xs text-muted tabular">{d.pop}%</span>
              <span className="text-right text-sm tabular">
                <span className="text-muted">{Math.round(d.min)}°</span> {Math.round(d.max)}°
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Skeleton() {
  return (
    <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2 lg:gap-4">
      {["h-72", "h-56", "h-48", "h-40"].map((h, i) => (
        <div key={i} className={`${h} animate-pulse rounded-3xl border border-line bg-ink-2`} />
      ))}
    </div>
  );
}

function tzLabel(tz?: string) {
  return tz === "Asia/Jakarta" || tz === "Asia/Pontianak" ? "WIB" : tz === "Asia/Makassar" ? "WITA" : tz === "Asia/Jayapura" ? "WIT" : "";
}
