// Pelindung route handler (server): tolak panggilan dari situs lain dan batasi jumlah permintaan per IP
// supaya kuota API berbayar (Gemini/Claude, WAQI) tidak dihabiskan orang lain.
//
// Rate limit disimpan di memori instance fungsi, jadi sifatnya "best effort": cukup untuk menahan skrip
// spam sederhana, tapi bukan pengganti aturan rate limit di Vercel Firewall.

type Bucket = { count: number; reset: number };

const buckets = new Map<string, Bucket>();
/** Batas ukuran peta supaya memori tidak membengkak saat diserang dari banyak IP. */
const MAX_KEYS = 10_000;

function clientIp(request: Request): string {
  // Di Vercel, x-real-ip dan entri pertama x-forwarded-for diisi oleh proxy Vercel sendiri.
  return request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
}

/** true bila permintaan datang dari situs lain (browser mengirim Sec-Fetch-Site / Origin). */
function crossSite(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return true;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host !== new URL(request.url).host;
  } catch {
    return true;
  }
}

/**
 * Kembalikan Response penolakan bila permintaan harus diblokir, atau null bila boleh lanjut.
 * `limit` permintaan per `windowMs` untuk tiap IP + nama route.
 */
export function guard(request: Request, route: string, limit: number, windowMs: number): Response | null {
  if (crossSite(request)) return Response.json({ error: "Permintaan lintas situs ditolak." }, { status: 403 });

  const now = Date.now();
  const key = `${route}:${clientIp(request)}`;
  let b = buckets.get(key);
  if (!b || b.reset <= now) {
    if (buckets.size >= MAX_KEYS) {
      for (const [k, v] of buckets) if (v.reset <= now) buckets.delete(k);
      if (buckets.size >= MAX_KEYS) buckets.clear();
    }
    b = { count: 0, reset: now + windowMs };
    buckets.set(key, b);
  }
  b.count++;
  if (b.count > limit) {
    const retry = Math.ceil((b.reset - now) / 1000);
    return Response.json(
      { error: "Terlalu banyak permintaan, coba lagi sebentar." },
      { status: 429, headers: { "Retry-After": String(retry) } },
    );
  }
  return null;
}
