import { guard } from "@/lib/guard";
import { nearestStation, stationEnabled } from "@/lib/station";

/** AQI terukur dari stasiun darat terdekat. `station: null` berarti tidak ada stasiun aktif di sekitar. */
export async function GET(request: Request) {
  if (!stationEnabled()) return Response.json({ enabled: false, station: null });

  // Tiap panggilan memicu beberapa request ke WAQI dengan token kita.
  const blocked = guard(request, "station", 30, 60_000);
  if (blocked) return blocked;

  const { searchParams } = new URL(request.url);
  const rawLat = searchParams.get("lat");
  const rawLon = searchParams.get("lon");
  const lat = Number(rawLat);
  const lon = Number(rawLon);
  if (!rawLat || !rawLon || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return Response.json({ error: "Parameter lat/lon tidak valid." }, { status: 400 });
  }

  try {
    return Response.json({ enabled: true, station: await nearestStation(lat, lon) });
  } catch {
    return Response.json({ enabled: true, station: null });
  }
}
