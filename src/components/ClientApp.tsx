"use client";

import dynamic from "next/dynamic";
import { AeroSenseMark } from "./AeroSenseLogo";

// AeroSense sepenuhnya bergantung pada API browser (GPS, kamera, localStorage),
// jadi dirender di klien saja. Selama memuat, tampilkan logo.
const AeroSenseApp = dynamic(() => import("./AeroSenseApp"), {
  ssr: false,
  loading: () => (
    <div className="grid min-h-svh place-items-center">
      <AeroSenseMark className="h-16 w-16 animate-pulse" />
    </div>
  ),
});

export default function ClientApp() {
  return <AeroSenseApp />;
}
