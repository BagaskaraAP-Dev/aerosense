// Pemeriksa masker yang berjalan 100% di perangkat (tanpa upload foto).
//
// 1. MediaPipe BlazeFace (model neural network) menemukan wajah dan 6 titik
//    kunci: dua mata, ujung hidung, mulut, dua telinga.
// 2. Dari area di sekitar mata (dahi, pangkal hidung, bawah mata) kita
//    pelajari warna kulit orang ini di kondisi cahaya saat ini.
// 3. Area hidung dan sekitar mulut dibandingkan dengan warna kulit tadi.
//    Kalau area itu tidak lagi "berwarna kulit", berarti tertutup masker.
//
// Membandingkan dengan kulit orang itu sendiri (bukan ambang warna tetap)
// membuatnya tahan terhadap perbedaan warna kulit dan pencahayaan.
// Keterbatasan: masker berwarna krem/kulit dan janggut lebat bisa mengecoh.

import type { FaceDetector } from "@mediapipe/tasks-vision";

let detectorPromise: Promise<FaceDetector> | null = null;

export function loadDetector(): Promise<FaceDetector> {
  detectorPromise ??= (async () => {
    const { FilesetResolver, FaceDetector } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
    const make = (delegate: "GPU" | "CPU") =>
      FaceDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: "/models/blaze_face_short_range.tflite", delegate },
        runningMode: "VIDEO",
        minDetectionConfidence: 0.7,
      });
    try {
      return await make("GPU");
    } catch {
      return await make("CPU");
    }
  })();
  detectorPromise.catch(() => {
    detectorPromise = null;
  });
  return detectorPromise;
}

export type Verdict = "no_face" | "far" | "dim" | "mask" | "nose_open" | "no_mask" | "unsure";

export type Region = { x: number; y: number; w: number; h: number; angle: number; skin: number; role: "ref" | "nose" | "mouth" };

export type Reading = {
  verdict: Verdict;
  faces: number;
  confidence: number;
  /** Semua koordinat dinormalisasi 0..1 terhadap frame video asli (belum dicermin). */
  box: { x: number; y: number; w: number; h: number } | null;
  keypoints: { x: number; y: number }[];
  regions: Region[];
  mouthCover: number; // 0..1, seberapa tertutup area mulut
  noseCover: number; // 0..1, seberapa tertutup hidung
};

const WORK_W = 320;
let work: HTMLCanvasElement | null = null;

type Px = { y: number; cb: number; cr: number };

export function analyze(detector: FaceDetector, video: HTMLVideoElement, now: number): Reading {
  const empty: Reading = { verdict: "no_face", faces: 0, confidence: 0, box: null, keypoints: [], regions: [], mouthCover: 0, noseCover: 0 };
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return empty;

  const result = detector.detectForVideo(video, now);
  const faces = result.detections.filter((d) => d.boundingBox && d.keypoints.length >= 4);
  if (faces.length === 0) return empty;

  const face = faces.reduce((a, b) => (area(b) > area(a) ? b : a));
  const bb = face.boundingBox!;
  const box = { x: bb.originX / vw, y: bb.originY / vh, w: bb.width / vw, h: bb.height / vh };
  const keypoints = face.keypoints.map((k) => ({ x: k.x, y: k.y }));
  const confidence = face.categories[0]?.score ?? 0;
  const base = { ...empty, faces: faces.length, confidence, box, keypoints };

  // Gambar frame ke kanvas kecil untuk sampling piksel.
  const W = WORK_W;
  const H = Math.round((vh / vw) * W);
  work ??= document.createElement("canvas");
  if (work.width !== W || work.height !== H) {
    work.width = W;
    work.height = H;
  }
  const ctx = work.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(video, 0, 0, W, H);
  const img = ctx.getImageData(0, 0, W, H);

  const [eyeR, eyeL, nose, mouth] = keypoints.map((k) => ({ x: k.x * W, y: k.y * H }));
  const d = Math.hypot(eyeL.x - eyeR.x, eyeL.y - eyeR.y);
  if (d < 22) return { ...base, verdict: "far" };

  // Sistem koordinat wajah: u searah garis mata, v tegak lurus ke bawah.
  const u = { x: (eyeL.x - eyeR.x) / d, y: (eyeL.y - eyeR.y) / d };
  const v = { x: -u.y, y: u.x };
  const E = { x: (eyeR.x + eyeL.x) / 2, y: (eyeR.y + eyeL.y) / 2 };
  const angle = Math.atan2(u.y, u.x);

  const sample = (cx: { x: number; y: number }, a: number, b: number, ha: number, hb: number): Px[] => {
    const out: Px[] = [];
    const step = 0.04;
    for (let i = -ha; i <= ha + 1e-6; i += step) {
      for (let j = -hb; j <= hb + 1e-6; j += step) {
        const px = Math.round(cx.x + u.x * (a + i) * d + v.x * (b + j) * d);
        const py = Math.round(cx.y + u.y * (a + i) * d + v.y * (b + j) * d);
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        const o = (py * W + px) * 4;
        out.push(ycbcr(img.data[o], img.data[o + 1], img.data[o + 2]));
      }
    }
    return out;
  };

  const regionBox = (cx: { x: number; y: number }, a: number, b: number, ha: number, hb: number, role: Region["role"], skin: number): Region => {
    const p = { x: cx.x + u.x * a * d + v.x * b * d, y: cx.y + u.y * a * d + v.y * b * d };
    return { x: p.x / W, y: p.y / H, w: (ha * 2 * d) / W, h: (hb * 2 * d) / H, angle, skin, role };
  };

  // Area referensi kulit: dahi, pangkal hidung, bawah kedua mata.
  // Dahi dibuat kecil supaya poni/jilbab tidak mendominasi median.
  const refSpecs: [number, number, number, number][] = [
    [0, -0.55, 0.2, 0.08],
    [0, -0.12, 0.12, 0.1],
    [-0.5, 0.22, 0.14, 0.07],
    [0.5, 0.22, 0.14, 0.07],
  ];
  const refPx = refSpecs.flatMap(([a, b, ha, hb]) => sample(E, a, b, ha, hb)).filter((p) => p.y > 35 && p.y < 245);
  if (refPx.length < 30) return { ...base, verdict: "dim" };

  const ref = { y: median(refPx.map((p) => p.y)), cb: median(refPx.map((p) => p.cb)), cr: median(refPx.map((p) => p.cr)) };
  const dist = refPx.map((p) => Math.hypot(p.cb - ref.cb, p.cr - ref.cr));
  const tol = clamp(median(dist) * 2.6, 6, 13);

  const isSkin = (p: Px) => Math.hypot(p.cb - ref.cb, p.cr - ref.cr) <= tol && p.y > ref.y * 0.4 && p.y < ref.y * 1.6;
  const frac = (px: Px[]) => (px.length ? px.filter(isSkin).length / px.length : 0);

  const refSkin = frac(refPx);
  if (refSkin < 0.3 || ref.y < 45) return { ...base, verdict: "dim" };

  // Hidung: di sekitar titik ujung hidung. Mulut: pipi kiri-kanan mulut & dagu
  // (bibir sengaja dilewati karena warnanya memang beda dari kulit).
  const noseSkin = frac(sample(nose, 0, -0.02, 0.13, 0.09));
  const mouthAreas: [number, number, number, number][] = [
    [-0.42, 0, 0.12, 0.1],
    [0.42, 0, 0.12, 0.1],
    [0, 0.36, 0.22, 0.09],
  ];
  const mouthSkins = mouthAreas.map(([a, b, ha, hb]) => frac(sample(mouth, a, b, ha, hb)));
  const mouthSkin = mouthSkins.reduce((s, x) => s + x, 0) / mouthSkins.length;

  const noseCover = clamp(1 - noseSkin / refSkin, 0, 1);
  const mouthCover = clamp(1 - mouthSkin / refSkin, 0, 1);

  const regions: Region[] = [
    ...refSpecs.map(([a, b, ha, hb]) => regionBox(E, a, b, ha, hb, "ref", refSkin)),
    regionBox(nose, 0, -0.02, 0.13, 0.09, "nose", noseSkin),
    ...mouthAreas.map(([a, b, ha, hb], i) => regionBox(mouth, a, b, ha, hb, "mouth", mouthSkins[i])),
  ];

  let verdict: Verdict = "unsure";
  if (mouthCover >= 0.62 && noseCover >= 0.5) verdict = "mask";
  else if (mouthCover >= 0.62 && noseCover < 0.3) verdict = "nose_open";
  else if (mouthCover <= 0.35) verdict = "no_mask";

  return { ...base, verdict, regions, mouthCover, noseCover };
}

function area(d: { boundingBox?: { width: number; height: number } }) {
  return d.boundingBox ? d.boundingBox.width * d.boundingBox.height : 0;
}

function ycbcr(r: number, g: number, b: number): Px {
  return {
    y: 0.299 * r + 0.587 * g + 0.114 * b,
    cb: 128 - 0.168736 * r - 0.331264 * g + 0.5 * b,
    cr: 128 + 0.5 * r - 0.418688 * g - 0.081312 * b,
  };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function clamp(x: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, x));
}

/** Ambil frame video sebagai JPEG (untuk verifikasi opsional ke Claude). */
export function captureJpeg(video: HTMLVideoElement, maxW = 640): string {
  const scale = Math.min(1, maxW / video.videoWidth);
  const c = document.createElement("canvas");
  c.width = Math.round(video.videoWidth * scale);
  c.height = Math.round(video.videoHeight * scale);
  c.getContext("2d")!.drawImage(video, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.82);
}
