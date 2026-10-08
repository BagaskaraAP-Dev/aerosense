import { nearestStation, stationEnabled } from "@/lib/station";

/** AQI terukur dari stasiun darat terdekat. `station: null` berarti tidak ada stasiun aktif di sekitar. */
export async function GET(request: Request) {
  if (!stationEnabled()) return Response.json({ enabled: false, station: null });

  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return Response.json({ error: "Parameter lat/lon tidak valid." }, { status: 400 });
  }

  try {
    return Response.json({ enabled: true, station: await nearestStation(lat, lon) });
  } catch {
    return Response.json({ enabled: true, station: null });
  }
}
