"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, LocateFixed, MapPin, Search, X } from "lucide-react";
import { PALEMBANG, searchPlaces, type Place } from "@/lib/weather";

const RECENT_KEY = "aerosense:recent";
const RECENT_MAX = 5;

const samePlace = (a: Place, b: Place) => a.lat === b.lat && a.lon === b.lon;

/** Kota yang pernah dipilih dari pencarian, terbaru di depan. */
function readRecent(): Place[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

type Props = {
  open: boolean;
  onClose: () => void;
  onPick: (p: Place) => void;
  onUseGps: () => void;
  locating: boolean;
};

export default function LocationPicker({ open, onClose, onPick, onUseGps, locating }: Props) {
  const [q, setQ] = useState("");
  // Hasil disimpan bersama kuerinya, supaya "tidak ditemukan" tidak muncul untuk hasil kueri lama.
  const [found, setFound] = useState<{ q: string; places: Place[] }>({ q: "", places: [] });
  const [busy, setBusy] = useState(false);
  // Hanya dirender di browser (lewat ClientApp), jadi localStorage aman dibaca di sini.
  const [recent, setRecent] = useState(readRecent);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const query = q.trim();
  const searching = query.length >= 2;
  const notFound = searching && !busy && found.q === query && found.places.length === 0;
  const shown = searching ? found.places : [...recent, ...(recent.some((r) => samePlace(r, PALEMBANG)) ? [] : [PALEMBANG])];

  const pick = (p: Place) => {
    const next = [p, ...recent.filter((r) => !samePlace(r, p))].slice(0, RECENT_MAX);
    setRecent(next);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {}
    setQ("");
    onPick(p);
  };

  useEffect(() => {
    if (query.length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        setFound({ q: query, places: await searchPlaces(query, ctrl.signal) });
      } catch {
        /* diabaikan: request lama dibatalkan */
      } finally {
        setBusy(false);
      }
    }, 280);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 sm:items-start sm:pt-24" onClick={onClose}>
      <div
        className="w-full max-w-md animate-rise rounded-t-3xl border border-line-strong bg-ink-2 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Pilih lokasi"
      >
        <div className="mb-3 flex items-center justify-between">
          <p className="label">Ganti lokasi</p>
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full hover:bg-ink-3" aria-label="Tutup">
            <X className="h-4 w-4" />
          </button>
        </div>

        <label className="flex items-center gap-2 rounded-xl border border-line-strong bg-ink px-3 focus-within:border-gold">
          <Search className="h-4 w-4 text-muted" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari kota… (mis. Prabumulih)"
            className="h-12 flex-1 bg-transparent text-base outline-none placeholder:text-faint"
          />
          {busy && <Loader2 className="h-4 w-4 animate-spin text-muted" />}
        </label>

        <div className="mt-3 space-y-1">
          <button onClick={onUseGps} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-ink-3">
            {locating ? <Loader2 className="h-4 w-4 animate-spin text-gold" /> : <LocateFixed className="h-4 w-4 text-gold" />}
            <span className="font-semibold">Pakai lokasi saya sekarang</span>
          </button>
          {!searching && recent.length > 0 && <p className="label px-3 pt-3">Terakhir dipilih</p>}
          {notFound && <p className="px-3 py-3 text-sm text-muted">Kota &ldquo;{query}&rdquo; tidak ditemukan.</p>}
          {shown.map((p) => (
            <button
              key={`${p.lat},${p.lon}`}
              onClick={() => pick(p)}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-ink-3"
            >
              <MapPin className="h-4 w-4 text-muted" />
              <span>
                <span className="font-semibold">{p.name}</span>
                {p.region && <span className="block text-sm text-muted">{p.region}</span>}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
