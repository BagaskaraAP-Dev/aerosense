import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AeroSense — Baca udara sebelum melangkah",
    short_name: "AeroSense",
    description: "Cuaca & kualitas udara realtime dengan pemeriksa masker berbasis AI kamera.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0b1315",
    theme_color: "#0b1315",
    lang: "id",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
