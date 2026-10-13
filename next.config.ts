import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// File AI kamera (± 12 MB WASM + model) jarang berubah: simpan seminggu di browser/CDN supaya
// kunjungan berikutnya tidak mengunduh atau mengecek ulang ke server.
const LONG_CACHE = [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }];

// CSP tanpa nonce (halaman tetap statis). 'wasm-unsafe-eval' dibutuhkan MediaPipe untuk menjalankan WASM;
// connect-src berisi API cuaca/geocoding yang dipanggil langsung dari browser (lihat src/lib/weather.ts).
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  `connect-src 'self' https://api.open-meteo.com https://air-quality-api.open-meteo.com https://geocoding-api.open-meteo.com https://api-bdc.io https://api.bigdatacloud.net${isDev ? " ws:" : ""}`,
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Kamera & GPS hanya untuk halaman AeroSense sendiri; fitur lain dimatikan.
  { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  // Supaya `npm run dev:hp` bisa dibuka dari HP lewat IP laptop di Wi-Fi rumah (192.168.x.x).
  allowedDevOrigins: ["192.168.*.*"],
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      { source: "/mediapipe/:path*", headers: LONG_CACHE },
      { source: "/models/:path*", headers: LONG_CACHE },
      { source: "/icons/:path*", headers: LONG_CACHE },
    ];
  },
};

export default nextConfig;
