import type { NextConfig } from "next";

// File AI kamera (± 12 MB WASM + model) jarang berubah: simpan seminggu di browser/CDN supaya
// kunjungan berikutnya tidak mengunduh atau mengecek ulang ke server.
const LONG_CACHE = [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }];

const nextConfig: NextConfig = {
  // Supaya `npm run dev:hp` bisa dibuka dari HP lewat IP laptop di Wi-Fi rumah (192.168.x.x).
  allowedDevOrigins: ["192.168.*.*"],
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/mediapipe/:path*", headers: LONG_CACHE },
      { source: "/models/:path*", headers: LONG_CACHE },
      { source: "/icons/:path*", headers: LONG_CACHE },
    ];
  },
};

export default nextConfig;
