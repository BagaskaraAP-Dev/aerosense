// Hanya dipakai di route handler (server) — API key tidak pernah sampai ke browser.
import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-opus-5-5";

export function claudeEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

let client: Anthropic | null = null;
export function claude(): Anthropic {
  client ??= new Anthropic();
  return client;
}

/**
 * Satu panggilan Claude yang mengembalikan JSON sesuai skema.
 * Fallback server-side aktif: kalau model menolak, API otomatis mencoba
 * model cadangan yang direkomendasikan Anthropic.
 */
export async function askJsonClaude<T>(opts: {
  system: string;
  schema: Record<string, unknown>;
  text: string;
  imageJpeg?: string;
}): Promise<T> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (opts.imageJpeg) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: opts.imageJpeg } });
  content.push({ type: "text", text: opts.text });

  const res = await claude().beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: opts.schema } },
    system: opts.system,
    messages: [{ role: "user", content }],
  });

  if (res.stop_reason === "refusal") throw new Error("Claude menolak permintaan ini.");
  const text = res.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text");
  if (!text) throw new Error("Claude tidak mengembalikan teks.");
  return JSON.parse(text.text) as T;
}

export function claudeErrorMessage(err: unknown): { message: string; status: number } {
  if (err instanceof Anthropic.AuthenticationError) return { message: "API key Claude tidak valid.", status: 502 };
  if (err instanceof Anthropic.RateLimitError) return { message: "Claude sedang sibuk, coba lagi sebentar.", status: 429 };
  if (err instanceof Anthropic.APIError) return { message: `Claude error ${err.status}.`, status: 502 };
  if (err instanceof Anthropic.APIConnectionError) return { message: "Tidak bisa terhubung ke Claude.", status: 502 };
  return { message: err instanceof Error ? err.message : "Kesalahan tak dikenal.", status: 500 };
}
