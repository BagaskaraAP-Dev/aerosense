"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Loader2, RotateCcw, ShieldAlert, Sparkles, TriangleAlert, X } from "lucide-react";
import { analyze, captureJpeg, loadDetector, type Reading, type Verdict } from "@/lib/mask-detector";

export type ScanOutcome = "mask" | "nose_open" | "no_mask";

type Props = {
  open: boolean;
  onClose: () => void;
  onResult: (r: ScanOutcome) => void;
  aqi: number | null;
  /** Nama penyedia AI ('Gemini' / 'Claude'); null berarti opsi pendapat kedua disembunyikan. */
  aiName: string | null;
};

type Phase = "loading" | "scanning" | "result" | "error";

const WINDOW = 30;
const LOCK = 22;

const LIVE_TEXT: Record<Verdict, string> = {
  no_face: "Arahkan wajahmu ke kamera",
  far: "Dekatkan wajah sedikit",
  dim: "Cahaya kurang — cari tempat lebih terang",
  unsure: "Menganalisis…",
  mask: "Masker terdeteksi, tahan sebentar",
  nose_open: "Hidungmu masih terbuka",
  no_mask: "Belum terlihat masker",
};

export default function MaskScanner({ open, onClose, ...rest }: Props) {
  const [run, setRun] = useState(0);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;
  // key baru = sesi baru: kamera, model, dan state mulai dari nol.
  return <ScanSession key={run} onClose={onClose} onRetry={() => setRun((n) => n + 1)} {...rest} />;
}

function ScanSession({
  onClose,
  onRetry,
  onResult,
  aqi,
  aiName,
}: Omit<Props, "open"> & { onRetry: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const historyRef = useRef<Verdict[]>([]);
  // Disimpan di ref supaya callback baru dari parent tidak me-restart kamera.
  const onResultRef = useRef(onResult);
  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState("");
  const [reading, setReading] = useState<Reading | null>(null);
  const [progress, setProgress] = useState(0);
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);
  const [ratio, setRatio] = useState(3 / 4);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [claude, setClaude] = useState<{ loading: boolean; status?: string; jenis?: string; catatan?: string; error?: string } | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // Nyalakan kamera + model sekali per sesi.
  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let lastT = -1;

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Kamera butuh koneksi aman (HTTPS). Buka AeroSense lewat https:// atau localhost.");
        }
        const [stream, detector] = await Promise.all([
          navigator.mediaDevices.getUserMedia({
            video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
            audio: false,
          }),
          loadDetector(),
        ]);
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        setRatio(video.videoWidth / video.videoHeight || 3 / 4);
        setPhase("scanning");

        const tick = () => {
          if (cancelled) return;
          if (video.readyState >= 2 && video.currentTime !== lastT) {
            lastT = video.currentTime;
            const r = analyze(detector, video, performance.now());
            draw(overlayRef.current, r);
            setReading(r);

            const h = historyRef.current;
            h.push(r.verdict);
            if (h.length > WINDOW) h.shift();
            const counts = (v: Verdict) => h.filter((x) => x === v).length;
            const best = (["mask", "nose_open", "no_mask"] as const).reduce((a, b) => (counts(b) > counts(a) ? b : a));
            setProgress(Math.min(1, counts(best) / LOCK));
            if (counts(best) >= LOCK) {
              setSnapshot(captureJpeg(video));
              setOutcome(best);
              setPhase("result");
              onResultRef.current(best);
              stopCamera();
              return;
            }
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch (e) {
        if (cancelled) return;
        const err = e as DOMException;
        setError(
          err.name === "NotAllowedError"
            ? "Izin kamera ditolak. Izinkan akses kamera di pengaturan browser, lalu coba lagi."
            : err.name === "NotFoundError"
              ? "Kamera tidak ditemukan di perangkat ini."
              : err.message || "Gagal menyalakan kamera.",
        );
        setPhase("error");
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stopCamera();
    };
  }, [stopCamera]);

  const askClaude = async () => {
    if (!snapshot) return;
    setClaude({ loading: true });
    try {
      const res = await fetch("/api/mask-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: snapshot }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Gagal");
      setClaude({ loading: false, ...j });
    } catch (e) {
      setClaude({ loading: false, error: (e as Error).message });
    }
  };

  const live = reading?.verdict ?? "no_face";
  const tone = live === "mask" ? "text-ok" : live === "no_mask" ? "text-danger" : live === "nose_open" ? "text-warn" : "text-paper";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ink/95" role="dialog" aria-modal aria-label="Pemeriksa masker">
      <header className="flex items-center justify-between px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))]">
        <div>
          <p className="label">Gerbang masker · AI di perangkat</p>
          <h2 className="text-xl font-bold">Cek masker sebelum keluar</h2>
        </div>
        <button onClick={onClose} className="grid h-11 w-11 place-items-center rounded-full border border-line-strong hover:bg-ink-3" aria-label="Tutup">
          <X className="h-5 w-5" />
        </button>
      </header>

      <div className="flex flex-1 flex-col items-center gap-4 overflow-y-auto px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        {phase === "error" ? (
          <div className="mt-10 max-w-sm space-y-4 text-center">
            <TriangleAlert className="mx-auto h-10 w-10 text-warn" />
            <p className="text-lg">{error}</p>
            <button onClick={onRetry} className="rounded-full bg-paper px-5 py-3 font-semibold text-ink">
              Coba lagi
            </button>
          </div>
        ) : phase === "result" && outcome ? (
          <Result outcome={outcome} aqi={aqi} snapshot={snapshot} aiName={aiName} claude={claude} onAskClaude={askClaude} onRetry={onRetry} onDone={onClose} />
        ) : (
          <>
            <div
              className="relative overflow-hidden rounded-2xl border border-line-strong bg-black"
              style={{ aspectRatio: ratio, width: `min(100%, calc(58svh * ${ratio}))` }}
            >
              <video ref={videoRef} playsInline muted className="h-full w-full -scale-x-100 object-fill" />
              <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full -scale-x-100" />
              {phase === "loading" && (
                <div className="absolute inset-0 grid place-items-center bg-ink-2">
                  <div className="flex items-center gap-2 text-muted">
                    <Loader2 className="h-5 w-5 animate-spin" /> Menyalakan kamera & model AI…
                  </div>
                </div>
              )}
              {/* Sapuan radar saat memindai */}
              {phase === "scanning" && (
                <div className="pointer-events-none absolute inset-x-0 top-0 h-1/3 animate-[scan_2.6s_ease-in-out_infinite] bg-gradient-to-b from-gold/0 via-gold/10 to-gold/0" />
              )}
              <ProgressRing value={progress} />
            </div>

            <div className="w-full max-w-md space-y-3">
              <p className={`text-center text-xl font-semibold ${tone}`} aria-live="polite">
                {phase === "loading" ? "Bersiap…" : LIVE_TEXT[live]}
              </p>
              <Meter label="Mulut & dagu tertutup" value={reading?.mouthCover ?? 0} />
              <Meter label="Hidung tertutup" value={reading?.noseCover ?? 0} />
              <p className="text-center text-xs leading-relaxed text-faint">
                Foto tidak dikirim ke mana pun. BlazeFace mencari wajahmu, lalu AeroSense membandingkan warna kulit di sekitar mata
                dengan area hidung & mulut. Kotak emas = acuan kulit, kotak hijau = tertutup, merah = terbuka.
              </p>
            </div>
          </>
        )}
      </div>
      <style>{`@keyframes scan { 0%,100% { transform: translateY(-40%) } 50% { transform: translateY(240%) } }`}</style>
    </div>
  );
}

function Result({
  outcome,
  aqi,
  snapshot,
  aiName,
  claude,
  onAskClaude,
  onRetry,
  onDone,
}: {
  outcome: ScanOutcome;
  aqi: number | null;
  snapshot: string | null;
  aiName: string | null;
  claude: { loading: boolean; status?: string; jenis?: string; catatan?: string; error?: string } | null;
  onAskClaude: () => void;
  onRetry: () => void;
  onDone: () => void;
}) {
  const copy = {
    mask: {
      icon: <CheckCircle2 className="h-8 w-8" />,
      color: "text-ok border-ok/40 bg-ok/10",
      title: "Siap berangkat.",
      body: "Masker menutup hidung dan mulut. Pastikan kawat hidungnya ditekan rapat supaya asap tidak bocor dari samping.",
    },
    nose_open: {
      icon: <TriangleAlert className="h-8 w-8" />,
      color: "text-warn border-warn/40 bg-warn/10",
      title: "Naikkan masker sampai hidung.",
      body: "Hidung adalah jalan masuk utama partikel asap. Masker di bawah hidung hampir tidak melindungi.",
    },
    no_mask: {
      icon: <ShieldAlert className="h-8 w-8" />,
      color: "text-danger border-danger/40 bg-danger/10",
      title: "Pakai masker dulu.",
      body: `${aqi != null ? `AQI di luar ${aqi}. ` : ""}Partikel PM2.5 dari asap bisa masuk sampai ke aliran darah. Gunakan N95/KN95 kalau ada.`,
    },
  }[outcome];

  const claudeLabel: Record<string, string> = {
    benar: "Masker dipakai dengan benar",
    salah: "Masker belum dipakai dengan benar",
    tanpa_masker: "Tidak memakai masker",
    tidak_jelas: "Foto kurang jelas",
  };

  return (
    <div className="mt-2 w-full max-w-md animate-rise space-y-4">
      <div className={`rounded-2xl border p-5 ${copy.color}`}>
        <div className="flex items-start gap-4">
          {snapshot && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={snapshot} alt="Foto pemeriksaan" className="h-24 w-20 shrink-0 -scale-x-100 rounded-xl object-cover" />
          )}
          <div className="space-y-1">
            {copy.icon}
            <h3 className="text-2xl font-bold text-paper">{copy.title}</h3>
          </div>
        </div>
        <p className="mt-3 leading-relaxed text-paper/85">{copy.body}</p>
      </div>

      {aiName && (
        <div className="rounded-2xl border border-line bg-ink-2 p-4">
          {!claude ? (
            <button onClick={onAskClaude} className="flex w-full items-center justify-center gap-2 rounded-xl border border-line-strong py-3 font-semibold hover:bg-ink-3">
              <Sparkles className="h-4 w-4 text-gold" /> Minta pendapat kedua dari {aiName}
            </button>
          ) : claude.loading ? (
            <p className="flex items-center gap-2 text-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> {aiName} sedang melihat fotonya…
            </p>
          ) : claude.error ? (
            <p className="text-warn">{claude.error}</p>
          ) : (
            <div className="space-y-1">
              <p className="label">Pendapat kedua · {aiName}</p>
              <p className="font-semibold">
                {claudeLabel[claude.status ?? ""] ?? claude.status}
                {claude.jenis && claude.jenis !== "-" ? ` · ${claude.jenis}` : ""}
              </p>
              <p className="text-paper/80">{claude.catatan}</p>
            </div>
          )}
          <p className="mt-2 text-[11px] text-faint">Opsi ini mengirim foto ke {aiName === "Gemini" ? "Gemini (Google)" : "Claude (Anthropic)"} untuk diperiksa.</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <button onClick={onRetry} className="flex items-center justify-center gap-2 rounded-full border border-line-strong py-3 font-semibold hover:bg-ink-3">
          <RotateCcw className="h-4 w-4" /> Scan ulang
        </button>
        <button onClick={onDone} className="flex items-center justify-center gap-2 rounded-full bg-paper py-3 font-semibold text-ink">
          <Camera className="h-4 w-4" /> Selesai
        </button>
      </div>
    </div>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div>
      <div className="mb-1 flex justify-between">
        <span className="label">{label}</span>
        <span className="font-mono text-xs tabular text-muted">{pct}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-ink-3">
        <div className="h-full rounded-full bg-ok transition-[width] duration-200" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function ProgressRing({ value }: { value: number }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 44 44" className="absolute right-3 top-3 h-11 w-11 -rotate-90" aria-hidden>
      <circle cx="22" cy="22" r={r} fill="rgb(11 19 21 / .6)" stroke="rgb(236 228 211 / .15)" strokeWidth="4" />
      <circle cx="22" cy="22" r={r} fill="none" stroke="#e3a93b" strokeWidth="4" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - value)} />
    </svg>
  );
}

/** Gambar apa yang "dilihat" AI: kotak wajah, titik kunci, area sampel. */
function draw(canvas: HTMLCanvasElement | null, r: Reading) {
  if (!canvas) return;
  const { clientWidth: w, clientHeight: h } = canvas;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== w * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!r.box) return;

  // Sudut kotak wajah gaya bidik
  const { x, y, w: bw, h: bh } = { x: r.box.x * w, y: r.box.y * h, w: r.box.w * w, h: r.box.h * h };
  const k = Math.min(bw, bh) * 0.22;
  ctx.strokeStyle = r.verdict === "mask" ? "#4fc3a1" : r.verdict === "no_mask" ? "#e5483a" : "#e3a93b";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  for (const [cx, cy, dx, dy] of [
    [x, y, 1, 1],
    [x + bw, y, -1, 1],
    [x, y + bh, 1, -1],
    [x + bw, y + bh, -1, -1],
  ]) {
    ctx.moveTo(cx + dx * k, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + dy * k);
  }
  ctx.stroke();

  for (const reg of r.regions) {
    ctx.save();
    ctx.translate(reg.x * w, reg.y * h);
    ctx.rotate(reg.angle);
    const rw = reg.w * w;
    const rh = reg.h * h;
    if (reg.role === "ref") {
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = "rgba(227,169,59,.8)";
      ctx.lineWidth = 1.2;
      ctx.strokeRect(-rw / 2, -rh / 2, rw, rh);
    } else {
      const covered = reg.skin < 0.35;
      ctx.fillStyle = covered ? "rgba(79,195,161,.28)" : "rgba(229,72,58,.28)";
      ctx.strokeStyle = covered ? "rgba(79,195,161,.9)" : "rgba(229,72,58,.9)";
      ctx.lineWidth = 1.5;
      ctx.fillRect(-rw / 2, -rh / 2, rw, rh);
      ctx.strokeRect(-rw / 2, -rh / 2, rw, rh);
    }
    ctx.restore();
  }

  ctx.fillStyle = "#ece4d3";
  for (const p of r.keypoints.slice(0, 4)) {
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}
