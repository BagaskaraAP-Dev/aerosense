import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudMoon, CloudRain, CloudSun, Haze, Moon, Snowflake, Sun } from "lucide-react";
import type { SkyKind } from "@/lib/weather";

export default function SkyIcon({ kind, isDay, className }: { kind: SkyKind; isDay: boolean; className?: string }) {
  const Icon = {
    clear: isDay ? Sun : Moon,
    partly: isDay ? CloudSun : CloudMoon,
    cloudy: Cloud,
    fog: CloudFog,
    drizzle: CloudDrizzle,
    rain: CloudRain,
    storm: CloudLightning,
    snow: Snowflake,
    // Ikon Haze bergambar matahari; di malam hari pakai kabut supaya tidak menyesatkan.
    haze: isDay ? Haze : CloudFog,
  }[kind];
  return <Icon className={className} strokeWidth={1.6} aria-hidden />;
}
