# AeroSense — baca udara sebelum melangkah

> Dibuat oleh **Bagaskara Amukti Palapa**, mahasiswa **Universitas Bina Darma**, Palembang.

**Coba langsung:** https://aerosense-pied.vercel.app (buka di Chrome HP, lalu ⋮ → Tambahkan ke layar utama)

Berjalan di Chrome/Edge 99+, Safari/iOS 15.4+, Firefox 97+, dan Samsung Internet 18+, baik di HP maupun laptop.

**AeroSense** adalah aplikasi cuaca berbasis AI untuk Palembang (dan kota lain). Namanya berarti
"merasakan udara": *aero* (udara) + *sense* (indra). Logonya adalah perahu Sungai Musi yang memancarkan
gelombang radar.

Ada tiga hal yang dilakukan AeroSense:

1. **Data realtime.** Suhu, hujan, angin, UV, dan kualitas udara (AQI, PM2.5, PM10) diambil langsung
   untuk lokasi GPS kamu. Data diperbarui otomatis tiap 10 menit dan setiap kali aplikasi dibuka lagi.
2. **Keputusan "boleh keluar?"** Data itu diolah menjadi status **Aman / Waspada / Bahaya**, indeks
   layak keluar 0–100, serta jam terbaik dan jam yang sebaiknya dihindari dalam 24 jam ke depan.
   Ada juga prakiraan 7 hari lengkap dengan AQI maksimum harian.
3. **Gerbang masker (AI kamera).** Kalau udara buruk (AQI > 100), AeroSense meminta kamu memindai wajah.
   AI di perangkat memeriksa apakah masker sudah menutup **hidung dan mulut** sebelum kamu keluar.

## Cara kerja AI-nya

| Bagian | Teknologi | Jalan di mana |
|---|---|---|
| Deteksi wajah | **MediaPipe BlazeFace** (neural network, Google) | Browser/HP, offline |
| Deteksi masker | Warna kulit di sekitar mata dipelajari, lalu dibandingkan dengan area hidung & mulut (ruang warna YCbCr) | Browser/HP |
| Saran teks | **Gemini** (Google) atau **Claude** (Anthropic), dengan cadangan mesin aturan lokal | Server Next.js |
| Pendapat kedua foto masker | **Gemini** atau **Claude** (vision) | Server, hanya kalau pengguna menekan tombolnya |

Foto dari kamera **tidak dikirim ke mana pun**, kecuali pengguna sendiri menekan "Minta pendapat kedua".

Keterbatasan detektor masker: masker berwarna krem atau sewarna kulit, serta janggut lebat, bisa salah
terbaca. Cahaya yang terlalu gelap akan memunculkan pesan "Cahaya kurang".

## Sumber data

- Cuaca: [Open-Meteo](https://open-meteo.com) (gratis, tanpa API key)
- Kualitas udara sekarang: **stasiun pemantau darat** terdekat (≤ 30 km, pembacaan ≤ 3 jam) dari jaringan
  [WAQI](https://aqicn.org). Di Palembang sumbernya antara lain **BMKG Talang Betutu** dan Musi 2. Butuh
  `WAQI_TOKEN` (gratis, lihat di bawah).
- Prakiraan kualitas udara: Open-Meteo Air Quality, berasal dari model **CAMS/Copernicus** (resolusi ± 40 km,
  jangkauan ± 5 hari). Kalau ada stasiun, selisih stasiun − model dipakai untuk mengoreksi prakiraan 24 jam
  ke depan. Tanpa stasiun, angka "sekarang" juga berasal dari model ini.

Saat kabut asap, model CAMS bisa jauh di bawah kenyataan. Contoh 8 Okt 2026 pukul 17.00: stasiun BMKG
Talang Betutu mencatat AQI 434, sedangkan model hanya membaca PM2.5 ± 200 µg/m³.

### Cara AQI dihitung

`us_aqi` bawaan Open-Meteo memakai rata-rata 24 jam (PM) dan 8 jam (ozon), sehingga tertinggal
berjam-jam: asap yang sudah menipis masih terbaca "sangat tidak sehat", dan ozon siang hari masih
terbawa sampai tengah malam. AeroSense menghitung ulang AQI dari konsentrasi per jam:

- **NowCast EPA** untuk PM2.5 dan PM10, yaitu metode yang dipakai AirNow untuk angka "saat ini".
- **Breakpoint PM2.5 revisi EPA 2024** (batas "Baik" turun dari 12 ke 9 µg/m³).
- Ozon ditampilkan sebagai peringatan terpisah bila nilai per jamnya ≥ 245 µg/m³ (≈ 0,125 ppm).
- Perbandingan dengan pedoman WHO memakai rata-rata 24 jam yang sebenarnya, bukan nilai sesaat.
- Nama lokasi dari GPS: BigDataCloud reverse geocoding

## Menjalankan

```bash
npm install
npm run dev          # buka http://localhost:3000
```

### Mencoba di HP (kamera butuh HTTPS)

Browser hanya mengizinkan kamera di `https://` atau `localhost`. Untuk mencobanya di HP lewat Wi-Fi yang
sama:

```bash
npm run dev:hp       # HTTPS dengan sertifikat self-signed
```

Buka `https://<IP-laptop>:3000` di HP, lalu terima peringatan sertifikat. Cara paling mudah untuk
presentasi adalah deploy ke Vercel, yang langsung memakai HTTPS.

AeroSense bisa dipasang seperti aplikasi: buka di Chrome HP, lalu pilih menu ⋮ → **Tambahkan ke layar utama**.

### Menghubungkan stasiun udara darat (disarankan)

1. Minta token gratis di https://aqicn.org/data-platform/token (isi email, token langsung dikirim).
2. Salin `.env.example` menjadi `.env.local`, lalu isi `WAQI_TOKEN=`.
3. Jalankan ulang `npm run dev`.

Kartu kualitas udara akan menampilkan "Terukur di <nama stasiun> · <jarak> km · BMKG". Kalau token belum
diisi atau tidak ada stasiun aktif di dekat lokasi, kartu menulis bahwa angkanya perkiraan model.

### Mengaktifkan AI untuk saran teks (opsional)

Pilih salah satu penyedia. Tanpa keduanya, semua fitur tetap berjalan dan saran teks memakai mesin aturan lokal.

- **Gemini** (ada paket gratis): ambil key di https://aistudio.google.com/apikey, isi `GEMINI_API_KEY`.
  Model bawaan `gemini-3.8-flash`, otomatis pindah ke `gemini-3.5-flash-lite` saat Google sedang sibuk; ganti lewat `GEMINI_MODEL` bila perlu.
- **Claude** (berbayar): isi `ANTHROPIC_API_KEY`.

Salin `.env.example` menjadi `.env.local`, isi key-nya, lalu jalankan ulang `npm run dev`. Di Vercel, tambahkan
lewat `npx vercel env add GEMINI_API_KEY production` lalu deploy ulang. Kalau dua key terisi, Gemini yang dipakai
(atur dengan `AI_PROVIDER=claude`).

## Mode demo

Kalau saat presentasi udaranya sedang bersih, nyalakan **Simulasi kabut asap** di bagian bawah halaman.
AQI akan dipaksa ke 268 supaya alur "wajib masker → scan kamera" bisa didemokan. Selama mode ini aktif,
sebuah banner menandai bahwa angkanya bukan data asli.

## Struktur

```
src/app/page.tsx              halaman utama
src/app/api/advisor           saran teks dari Gemini/Claude
src/app/api/mask-check        pendapat kedua AI untuk foto masker
src/lib/ai.ts                pilih penyedia AI (gemini.ts / claude.ts)
src/app/api/station           AQI terukur dari stasiun darat terdekat (WAQI)
src/lib/station.ts            cari stasiun aktif terdekat (server, memakai WAQI_TOKEN)
src/components/AeroSenseApp.tsx   UI utama
src/components/MaskScanner    kamera + overlay AI
src/components/Atmosphere     latar animasi (asap, hujan, petir, bintang)
src/lib/weather.ts            ambil data + penilaian risiko
src/lib/mask-detector.ts      deteksi wajah & masker
src/app/icon.svg              logo (npm run icons membuat versi PNG)
```
