"use client";

import { useEffect, useRef } from "react";
import type { SkyKind } from "@/lib/weather";

type Props = { kind: SkyKind; isDay: boolean; /** 0..1 */ intensity: number };

/** Gambar ± 30 fps, jadi gerakan per frame dua kali lipat dari versi 60 fps. */
const STEP = 2;

type Particle = { x: number; y: number; r: number; vx: number; vy: number; a: number; t: number };

/** Latar belakang animasi yang mengikuti kondisi langit sebenarnya. */
export default function Atmosphere({ kind, isDay, intensity }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // HP kelas bawah: resolusi kanvas 1×, partikel separuh. Latar ini hanya hiasan.
    const nav = navigator as Navigator & { deviceMemory?: number };
    const lowEnd = (nav.hardwareConcurrency || 8) <= 4 || (nav.deviceMemory ?? 8) <= 4;
    let w = 0;
    let h = 0;
    let raf = 0;
    let flash = 0;
    let last = 0;

    const resize = () => {
      const dpr = lowEnd ? 1 : Math.min(window.devicePixelRatio || 1, 1.5);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const wet = kind === "rain" || kind === "drizzle" || kind === "storm";
    const small = w < 640;
    const scale = lowEnd ? 0.5 : 1;
    const count = Math.round(
      scale *
        (kind === "haze" ? (small ? 70 : 140) * (0.4 + intensity)
        : wet ? (small ? 90 : 180) * (kind === "drizzle" ? 0.5 : 1)
        : kind === "clear" && !isDay ? (small ? 60 : 110)
        : kind === "cloudy" || kind === "fog" || kind === "partly" ? (small ? 6 : 9)
        : 0),
    );

    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    const particles: Particle[] = Array.from({ length: count }, () => spawn(true));

    function spawn(anywhere: boolean): Particle {
      if (wet) return { x: rnd(-100, w + 100), y: anywhere ? rnd(0, h) : rnd(-60, -10), r: rnd(10, 22), vx: -1.4, vy: rnd(9, 15), a: rnd(0.12, 0.32), t: 0 };
      if (kind === "haze") return { x: rnd(0, w), y: rnd(0, h), r: rnd(0.6, 2.2), vx: rnd(0.05, 0.35), vy: rnd(-0.12, 0.08), a: rnd(0.15, 0.5), t: rnd(0, 6.28) };
      if (kind === "clear") return { x: rnd(0, w), y: rnd(0, h * 0.7), r: rnd(0.4, 1.3), vx: 0, vy: 0, a: rnd(0.2, 0.8), t: rnd(0, 6.28) };
      return { x: rnd(-200, w), y: rnd(-50, h * 0.6), r: rnd(140, 280), vx: rnd(0.04, 0.16), vy: 0, a: rnd(0.025, 0.06), t: 0 };
    }

    // ± 30 fps sudah cukup halus untuk latar dan menghemat baterai separuhnya.
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < 32) return;
      last = t;
      draw();
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);

      // Pencahayaan dasar
      if (kind === "haze") {
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, `rgba(176, 112, 52, ${0.16 + intensity * 0.18})`);
        g.addColorStop(0.6, `rgba(120, 84, 52, ${0.06 + intensity * 0.08})`);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      } else if (isDay && (kind === "clear" || kind === "partly")) {
        const g = ctx.createRadialGradient(w * 0.82, -40, 10, w * 0.82, -40, Math.max(w, h) * 0.7);
        g.addColorStop(0, "rgba(227, 169, 59, 0.22)");
        g.addColorStop(1, "rgba(227, 169, 59, 0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      } else if (wet) {
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, "rgba(70, 110, 130, 0.18)");
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }

      for (const p of particles) {
        if (wet) {
          ctx.strokeStyle = `rgba(180, 210, 225, ${p.a})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x + p.vx * 2, p.y + p.r);
          ctx.stroke();
          p.x += p.vx * STEP;
          p.y += p.vy * STEP;
          if (p.y > h) Object.assign(p, spawn(false));
        } else if (kind === "haze") {
          p.t += 0.01 * STEP;
          const a = p.a * (0.6 + 0.4 * Math.sin(p.t));
          ctx.fillStyle = `rgba(214, 170, 120, ${a})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
          p.x += p.vx * STEP;
          p.y += (p.vy + Math.sin(p.t) * 0.1) * STEP;
          if (p.x > w + 5) p.x = -5;
          if (p.y < -5) p.y = h + 5;
          if (p.y > h + 5) p.y = -5;
        } else if (kind === "clear") {
          p.t += 0.02 * STEP;
          ctx.fillStyle = `rgba(236, 228, 211, ${p.a * (0.5 + 0.5 * Math.sin(p.t))})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
        } else {
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
          const tone = kind === "fog" ? "200, 200, 195" : "160, 175, 180";
          g.addColorStop(0, `rgba(${tone}, ${p.a})`);
          g.addColorStop(1, `rgba(${tone}, 0)`);
          ctx.fillStyle = g;
          ctx.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
          p.x += p.vx * STEP;
          if (p.x - p.r > w) p.x = -p.r;
        }
      }

      if (kind === "storm") {
        if (flash <= 0 && Math.random() < 0.004 * STEP) flash = 1;
        if (flash > 0) {
          ctx.fillStyle = `rgba(220, 230, 255, ${flash * 0.18})`;
          ctx.fillRect(0, 0, w, h);
          flash -= 0.06 * STEP;
        }
      }

    };
    draw();
    if (!reduced) raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [kind, isDay, intensity]);

  return <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 -z-10 h-full w-full" />;
}
