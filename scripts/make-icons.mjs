// Rasterizes src/app/icon.svg into the PNG icons used by the PWA manifest.
// Run with: node scripts/make-icons.mjs
import { readFile, mkdir } from "node:fs/promises";
import sharp from "sharp";

const svg = await readFile("src/app/icon.svg");
// Maskable icons need a full-bleed background; Android crops them itself.
const maskable = Buffer.from(
  svg.toString().replace('rx="116"', 'rx="0"'),
);

await mkdir("public/icons", { recursive: true });
await sharp(svg).resize(192, 192).png().toFile("public/icons/icon-192.png");
await sharp(svg).resize(512, 512).png().toFile("public/icons/icon-512.png");
await sharp(maskable).resize(512, 512).png().toFile("public/icons/maskable-512.png");
await sharp(maskable).resize(180, 180).png().toFile("src/app/apple-icon.png");
console.log("icons written");
