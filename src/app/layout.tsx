import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin", "latin-ext"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AeroSense — Baca udara sebelum melangkah",
  description:
    "AeroSense memantau cuaca dan kualitas udara secara realtime, lalu memakai AI kamera untuk memastikan kamu bermasker sebelum keluar saat udara buruk.",
  applicationName: "AeroSense",
  appleWebApp: { capable: true, title: "AeroSense", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#0b1315",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="id" className={`${bricolage.variable} ${jetbrains.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
