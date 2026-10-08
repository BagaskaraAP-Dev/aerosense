// Hanya dipakai di route handler (server) — API key tidak pernah sampai ke browser.
// Memanggil REST generateContent langsung (tanpa SDK) supaya bundle tetap ringan.

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
/** Model utama; bisa diganti lewat GEMINI_MODEL tanpa mengubah kode. */
const DEFAULT_MODEL = "gemini-3.8-flash";
/** Dipakai bila model utama sedang kelebihan beban di sisi Google (503) atau kuotanya habis (429). */
const FALLBACK_MODEL = "gemini-3.5-flash-lite";
/** Per model. Dua model berurutan harus tetap selesai dalam batas waktu fungsi (maxDuration di route). */
const TIMEOUT_MS = 12_000;

export function geminiEnabled(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type Part = { text?: string; inlineData?: { mimeType: string; data: string } };

type GeminiResponse = {
  candidates?: { content?: { parts?: Part[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; message?: string; status?: string };
};

/** Galat sementara di sisi Google: layak dicoba dengan model cadangan. */
const retryable = (e: GeminiError) => e.status === 429 || e.status === 500 || e.status === 503 || e.status === 504;

/** Satu panggilan Gemini yang mengembalikan JSON. Bentuk JSON dijelaskan di prompt dan divalidasi pemanggil. */
export async function askJsonGemini<T>(opts: {
  system: string;
  schema: Record<string, unknown>;
  text: string;
  imageJpeg?: string;
}): Promise<T> {
  const primary = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const parts: Part[] = [{ text: opts.text }];
  // Teks lebih dulu, baru gambar (urutan yang disarankan Google untuk satu gambar).
  if (opts.imageJpeg) parts.push({ inlineData: { mimeType: "image/jpeg", data: opts.imageJpeg } });

  const body = JSON.stringify({
    systemInstruction: {
      parts: [{ text: `${opts.system}\n\nBalas HANYA dengan satu objek JSON mentah (tanpa markdown) sesuai skema ini:\n${JSON.stringify(opts.schema)}` }],
    },
    contents: [{ role: "user", parts }],
    // Batas besar karena model berpikir juga menghabiskan token keluaran.
    generationConfig: { responseMimeType: "application/json", temperature: 0.4, maxOutputTokens: 4000 },
  });

  const models = primary === FALLBACK_MODEL ? [primary] : [primary, FALLBACK_MODEL];
  let lastError: GeminiError | null = null;
  for (const model of models) {
    try {
      return await call<T>(model, body);
    } catch (e) {
      if (!(e instanceof GeminiError) || !retryable(e)) throw e;
      lastError = e;
    }
  }
  throw lastError!;
}

async function call<T>(model: string, body: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    // Timeout dianggap sementara (504) agar model cadangan dicoba; gagal sambung biasa tidak.
    const timedOut = e instanceof DOMException && e.name === "TimeoutError";
    throw new GeminiError(timedOut ? "Gemini terlalu lama menjawab." : "Tidak bisa terhubung ke Gemini.", timedOut ? 504 : 502);
  }

  const j: GeminiResponse = await res.json().catch(() => ({}));
  if (!res.ok) throw new GeminiError(j.error?.message ?? `HTTP ${res.status}`, res.status);
  if (j.promptFeedback?.blockReason) throw new GeminiError("Gemini menolak permintaan ini.", 422);

  const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
  if (!text) throw new GeminiError("Gemini tidak mengembalikan teks.", 502);

  try {
    // Beberapa model tetap membungkus JSON dengan ```json … ``` walau sudah diminta mentah.
    return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")) as T;
  } catch {
    throw new GeminiError("Jawaban Gemini bukan JSON yang valid.", 502);
  }
}

export function geminiErrorMessage(err: GeminiError): { message: string; status: number } {
  // Key salah dikembalikan Google sebagai 400 ("API key not valid"), key diblokir sebagai 403.
  if (err.status === 403 || /api key/i.test(err.message)) return { message: "API key Gemini tidak valid.", status: 502 };
  if (err.status === 404) return { message: "Model Gemini tidak ditemukan. Periksa GEMINI_MODEL.", status: 502 };
  if (err.status === 429) return { message: "Kuota Gemini habis atau sedang sibuk, coba lagi sebentar.", status: 429 };
  if (err.status === 503 || err.status === 504) return { message: "Gemini sedang sibuk, coba lagi sebentar.", status: 503 };
  return { message: err.message, status: err.status >= 400 && err.status < 600 ? 502 : 500 };
}
