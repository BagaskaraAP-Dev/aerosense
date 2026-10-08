// Pilih penyedia AI untuk saran teks dan pendapat kedua foto masker. Hanya dipakai di server.
// Gemini dipakai bila GEMINI_API_KEY ada, kalau tidak Claude bila ANTHROPIC_API_KEY ada.
// AI_PROVIDER=claude|gemini memaksa pilihan saat kedua key terisi.

import { askJsonClaude, claudeEnabled, claudeErrorMessage } from "./claude";
import { askJsonGemini, geminiEnabled, GeminiError, geminiErrorMessage } from "./gemini";

export type Provider = "gemini" | "claude";

export function provider(): Provider | null {
  const want = process.env.AI_PROVIDER;
  if (want === "claude" && claudeEnabled()) return "claude";
  if (want === "gemini" && geminiEnabled()) return "gemini";
  if (geminiEnabled()) return "gemini";
  if (claudeEnabled()) return "claude";
  return null;
}

export function aiName(): string | null {
  const p = provider();
  return p === "gemini" ? "Gemini" : p === "claude" ? "Claude" : null;
}

export async function askJson<T>(opts: {
  system: string;
  schema: Record<string, unknown>;
  text: string;
  /** JPEG base64 tanpa awalan data:. */
  imageJpeg?: string;
}): Promise<T> {
  return provider() === "gemini" ? askJsonGemini<T>(opts) : askJsonClaude<T>(opts);
}

export function errorMessage(err: unknown): { message: string; status: number } {
  if (err instanceof GeminiError) return geminiErrorMessage(err);
  return claudeErrorMessage(err);
}
