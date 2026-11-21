"use client";

// "How does this answer the brief?": a short presentation over the overview, one slide per
// question. Each slide says what Undercurrent does about it (from the README's feature list)
// and links to where it's shown. Arrow keys move, Esc closes.

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeftIcon, ArrowRightIcon, XIcon } from "lucide-react";

export const TOUR: { n: number; title: string; ask: string; answer: string; status: "live" | "design"; see: { label: string; href: string } }[] = [
  { n: 1, title: "Warn before blackouts", ask: "How would you warn people before the power or air cuts out?", status: "live",
    answer: "A relay box signs its voltage readings. The hub fits a trend through the last eight and warns when the supply will drop to 180 V, with a range, and only when the fall is clear of the noise.",
    see: { label: "The blackout forecast", href: "#forecast" } },
  { n: 2, title: "Share fairly", ask: "How would you share power, water and food fairly when there isn't enough?", status: "live",
    answer: "A Have / Need board of signed offers and requests. Each need is matched to the nearest offer of the same kind: medicine and water first, then whoever has waited longest. Only the poster can close a post.",
    see: { label: "The Have / Need board", href: "#exchange" } },
  { n: 3, title: "Keep levels livable", ask: "How would you keep the lower levels livable?", status: "live",
    answer: "The Livability Index: one 0–100 score per level from signed readings, reports and the blackout forecast. No data never counts as fine, one unsafe dimension makes the level unsafe, and every number links to its events.",
    see: { label: "The Livability Index", href: "#livability" } },
  { n: 4, title: "Catch bad water", ask: "How would you catch bad water before people drink it?", status: "live",
    answer: "Bad-water reports land on the 3D map and are traced up the pipes to a likely source (labelled as a guess), so the level knows which taps to avoid.",
    see: { label: "The 3D map", href: "/hollow" } },
  { n: 5, title: "Safe tunnels", ask: "How would you keep the tunnels safe to live and move through?", status: "live",
    answer: "A Canary box's water probe raises a signed alert within a second. The map closes the flooded streets and draws the safest route around them.",
    see: { label: "The 3D map", href: "/hollow" } },
  { n: 6, title: "Share space", ask: "How would you find space, or help people share what little there is?", status: "live",
    answer: "Spare space goes on the Have / Need board like food or medicine, and is matched to whoever needs it nearest.",
    see: { label: "The Have / Need board", href: "#exchange" } },
  { n: 7, title: "Organize without their network", ask: "How would people organize and call for help without the Directorate's network?", status: "live",
    answer: "Phones and boxes sign every message, and hubs check and sync with no internet. Forgeries are refused, an edited record is caught at its row, and cutting the link loses nothing.",
    see: { label: "Attack it live", href: "#beats" } },
  { n: 8, title: "Reconnect families", ask: "When a blackout hits, how would families know each other are okay?", status: "live",
    answer: "A daily signed check-in and a roll call of who hasn't been heard from today. Missing-person reports are on every hub and searchable from the console.",
    see: { label: "People", href: "#wellbeing" } },
  { n: 9, title: "The real outbreak", ask: "How would you track the real outbreak and get supplies where they're needed?", status: "live",
    answer: "Symptom reports are signed and counted per level, shown next to the Directorate's published figure, so the gap is plain to see.",
    see: { label: "The 3D map", href: "/hollow" } },
  { n: 10, title: "Care that reaches people", ask: "How would you get basic care to people who can't reach a clinic?", status: "live",
    answer: "An AI on the hub reads panicked free text and puts the SOS first on a slow link. Medicine requests are matched first on the board.",
    see: { label: "AI triage", href: "#triage" } },
  { n: 11, title: "Life without sunlight", ask: "How would you track what living underground does to people?", status: "live",
    answer: "Optional sleep and mood answers on the daily check-in, averaged per level only once two or more people answer, so nobody is singled out.",
    see: { label: "People", href: "#wellbeing" } },
  { n: 12, title: "Grow and share food", ask: "How would a neighbourhood grow and share its own food?", status: "live",
    answer: "Days of food at home per level feeds a Food score in the Livability Index, and food and seeds are shared across levels on the board. Growing itself isn't tracked.",
    see: { label: "The Livability Index", href: "#livability" } },
  { n: 13, title: "Is the surface safe?", ask: "How would you prove whether the surface is safe, and get the answer to everyone?", status: "live",
    answer: "A box at the top of the shaft signs its CO₂ and oxygen readings, shown next to the Directorate's claim that the air kills in minutes.",
    see: { label: "Surface air", href: "#surface" } },
  { n: 14, title: "Suits, domes or outposts", ask: "Which option works, and who should try it first?", status: "design",
    answer: "Designed, not built: a Canary box in every trial suit, dome and outpost, compared on signed readings, with the forecast flagging one heading toward unsafe.",
    see: { label: "Going back up", href: "#next" } },
  { n: 15, title: "Plan the move up", ask: "If the surface is safe, how would you plan the move?", status: "design",
    answer: "Designed, not built: plan it from the signed census, the surface readings, outpost beds on the Have / Need board and the roll call.",
    see: { label: "Going back up", href: "#next" } },
];

export function BriefTour({ open, onClose, q }: { open: boolean; onClose: () => void; q: string }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setI((x) => Math.min(TOUR.length - 1, x + 1));
      if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open, onClose]);
  if (!open) return null;
  const s = TOUR[i];
  const live = s.status === "live";
  const href = s.see.href.startsWith("#") ? s.see.href : `${s.see.href}${q}`;
  return (
    <div className="fixed inset-0 z-[var(--z-popover)] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="How Undercurrent answers the brief" onClick={onClose}>
      <div className="pop-in flex w-full max-w-2xl flex-col gap-6 rounded-2xl border border-border bg-card p-6 shadow-2xl shadow-[color-mix(in_srgb,var(--accent)_25%,transparent)] sm:p-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <span className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">The brief · {s.n} of {TOUR.length}</span>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"><XIcon className="size-5" /></button>
        </div>
        <div key={s.n} className="tab-in flex min-h-[15rem] flex-col gap-4">
          <p className="text-[15px] text-muted-foreground">“{s.ask}”</p>
          <h2 className="text-3xl font-semibold tracking-tight">{s.title}</h2>
          <p className="text-lg leading-relaxed text-foreground/85">{s.answer}</p>
          <div className="mt-auto flex flex-wrap items-center gap-3">
            <span className="rounded-full border px-2.5 py-1 text-xs font-medium" style={{ borderColor: live ? "var(--ok)" : "var(--border-strong)", color: live ? "var(--ok)" : "var(--muted)" }}>
              {live ? "Built and live" : "Designed, not built"}
            </span>
            {s.see.href.startsWith("#")
              ? <a href={href} onClick={onClose} className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground hover:underline">See it: {s.see.label} <ArrowRightIcon className="size-4" /></a>
              : <Link href={href} className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground hover:underline">See it: {s.see.label} <ArrowRightIcon className="size-4" /></Link>}
          </div>
        </div>
        <div className="flex items-center justify-between gap-4">
          <button onClick={() => setI((x) => Math.max(0, x - 1))} disabled={i === 0} className="inline-flex items-center gap-1.5 rounded-md border border-border-strong px-3 py-2 text-sm disabled:opacity-30"><ArrowLeftIcon className="size-4" />Back</button>
          <div className="flex flex-wrap justify-center gap-1.5" aria-label="Questions">
            {TOUR.map((t, k) => (
              <button key={t.n} onClick={() => setI(k)} aria-label={`Question ${t.n}: ${t.title}`} className="size-2.5 rounded-full transition" style={{ background: k === i ? "var(--foreground)" : t.status === "live" ? "color-mix(in srgb, var(--ok) 55%, transparent)" : "var(--border-strong)" }} />
            ))}
          </div>
          <button onClick={() => setI((x) => Math.min(TOUR.length - 1, x + 1))} disabled={i === TOUR.length - 1} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-30">Next<ArrowRightIcon className="size-4" /></button>
        </div>
      </div>
    </div>
  );
}
