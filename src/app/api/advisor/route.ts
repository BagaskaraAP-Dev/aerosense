import { askJson, claudeEnabled, errorMessage } from "@/lib/claude";

const SYSTEM = `Kamu adalah AeroSense, asisten cuaca & kualitas udara untuk warga Indonesia (terutama Palembang yang sering dilanda kabut asap karhutla).
Kamu menerima data realtime dalam JSON. Tulis saran berbahasa Indonesia sehari-hari, seperti teman yang paham kesehatan dan langsung ke pokok.
- headline: maks 8 kata, langsung menjawab "aman keluar atau tidak".
- summary: maks 2 kalimat. Pengguna sudah melihat angka sekarang di layar, jadi fokus pada yang tidak terlihat: kapan kondisi berubah (tren_aqi_6_jam, hujan_3_jam) dan jam berapa sebaiknya keluar atau dihindari (waktu_terbaik_keluar, waktu_hindari). Selalu sebut jam spesifik dari data, format 15.00.
- checklist: 2–4 item, masing-masing maks 6 kata, berupa benda atau tindakan konkret. Kalau wajib_masker true, item pertama soal masker yang tepat (N95/KN95 untuk asap).
- Kalau pengguna_kelompok_sensitif true (asma, penyakit jantung/paru, anak, lansia, hamil), nilai risikonya lebih ketat: AQI di atas 100 sudah berbahaya untuknya, dan ingatkan membawa obat rutin bila udara tidak baik.
Aturan gaya: tanpa emoji, tanpa tanda seru, tanpa basa-basi ("Yuk", "Tetap semangat", "Jangan lupa", "Tentu", "Pastikan"), tanpa kata "AI". Jangan mengarang data yang tidak ada di JSON. Jangan melebih-lebihkan; kalau kondisinya baik, katakan baik. Kalau simulasi true, perlakukan datanya seperti nyata.`;

const SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    summary: { type: "string" },
    checklist: { type: "array", items: { type: "string" } },
  },
  required: ["headline", "summary", "checklist"],
  additionalProperties: false,
};

export async function GET() {
  return Response.json({ enabled: claudeEnabled() });
}

export async function POST(request: Request) {
  if (!claudeEnabled()) return Response.json({ error: "Claude belum dikonfigurasi." }, { status: 503 });

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return Response.json({ error: "Body bukan JSON." }, { status: 400 });
  }
  const payload = JSON.stringify(input);
  if (payload.length > 8000) return Response.json({ error: "Data terlalu besar." }, { status: 413 });

  try {
    const advice = await askJson<{ headline: string; summary: string; checklist: string[] }>({
      system: SYSTEM,
      schema: SCHEMA,
      content: [{ type: "text", text: `Data cuaca saat ini:\n${payload}` }],
    });
    return Response.json({ ...advice, source: "claude" });
  } catch (err) {
    const { message, status } = errorMessage(err);
    return Response.json({ error: message }, { status });
  }
}
