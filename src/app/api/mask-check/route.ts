import { aiName, askJson, errorMessage } from "@/lib/ai";

const SYSTEM = `Kamu memeriksa foto selfie untuk aplikasi AeroSense: apakah orang di foto memakai masker dengan benar sebelum keluar saat udara berasap.
Nilai hanya pemakaian masker, jangan mengomentari wajah, identitas, atau penampilan.
- status: "benar" bila masker menutup hidung DAN mulut; "salah" bila ada masker tapi hidung/mulut terbuka; "tanpa_masker" bila tidak ada masker; "tidak_jelas" bila wajah tidak terlihat cukup jelas.
- jenis: perkiraan jenis masker (mis. "N95/KN95", "masker medis", "kain", "scuba") atau "-" bila tidak ada.
- catatan: satu kalimat bahasa Indonesia yang santai berisi saran. Ingatkan bahwa masker kain/scuba kurang efektif menyaring PM2.5 bila itu jenisnya.`;

const SCHEMA = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["benar", "salah", "tanpa_masker", "tidak_jelas"] },
    jenis: { type: "string" },
    catatan: { type: "string" },
  },
  required: ["status", "jenis", "catatan"],
  additionalProperties: false,
};

const STATUS = ["benar", "salah", "tanpa_masker", "tidak_jelas"];

const MAX_BYTES = 2_000_000;

export async function POST(request: Request) {
  if (!aiName()) return Response.json({ error: "AI belum dikonfigurasi." }, { status: 503 });

  let image: unknown;
  try {
    ({ image } = await request.json());
  } catch {
    return Response.json({ error: "Body bukan JSON." }, { status: 400 });
  }
  const match = typeof image === "string" ? /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(image) : null;
  if (!match) return Response.json({ error: "Gambar harus JPEG base64." }, { status: 400 });
  if (match[1].length > MAX_BYTES) return Response.json({ error: "Gambar terlalu besar." }, { status: 413 });

  try {
    const verdict = await askJson<{ status: string; jenis: string; catatan: string }>({
      system: SYSTEM,
      schema: SCHEMA,
      text: "Periksa pemakaian masker di foto ini.",
      imageJpeg: match[1],
    });
    if (!STATUS.includes(verdict.status) || typeof verdict.catatan !== "string") {
      return Response.json({ error: "Jawaban AI tidak lengkap." }, { status: 502 });
    }
    return Response.json({ status: verdict.status, jenis: String(verdict.jenis ?? "-").slice(0, 40), catatan: verdict.catatan.slice(0, 300) });
  } catch (err) {
    const { message, status } = errorMessage(err);
    return Response.json({ error: message }, { status });
  }
}
