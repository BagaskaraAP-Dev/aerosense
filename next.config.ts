import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Supaya `npm run dev:hp` bisa dibuka dari HP lewat IP laptop di Wi-Fi rumah (192.168.x.x).
  allowedDevOrigins: ["192.168.*.*"],
};

export default nextConfig;
