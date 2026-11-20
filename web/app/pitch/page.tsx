"use client";

// The 3-minute pitch: eight full-screen slides, each built on a live component from /overview
// (./sections.tsx), so judges watch the real hubs react. Words live in ./slides.ts.
//
// Keys: → / Space next · ← back · 1-8 jump · N speaker notes · P auto-play · F full screen.
// URL: ?slide=3 opens slide 3; ?auto=1 starts auto-play; ?hub= and ?peer= are kept.

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Toaster } from "sonner";
import { ChevronLeftIcon, ChevronRightIcon, MaximizeIcon, PauseIcon, PlayIcon, ScrollTextIcon, WavesIcon } from "lucide-react";
import { StatusChip, useCarriedQuery, useStatusChips } from "@/components/app-bar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { TooltipProvider } from "@/components/ui/tooltip";
import { isSimulated, useUndercurrent, type Undercurrent } from "@/lib/useUndercurrent";
import {
  Dot, ExchangeSection, ForecastSection, HowItWorks, TONE, TriageSection, WellbeingSection, useLiveToasts, useProofs,
} from "../overview/sections";
import { LivabilityReplayStrip } from "../overview/livability-replay";
import { BOX_PARTS, PROOF, QUESTIONS, SLIDES, STACK, TEAM, TEAM_PLACEHOLDER, THREATS, TOTAL_SECONDS } from "./slides";

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const STATUS_COLOR = { live: "var(--ok)", partial: "var(--warn)", design: "var(--muted)" } as const;

// ------------------------------------------------------------------ the slides' bodies

function QuestionsGrid() {
  const count = (s: string) => QUESTIONS.filter((q) => q.status === s).length;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {QUESTIONS.map((q) => (
          <div key={q.n} className="flex min-h-20 flex-col justify-between gap-2 rounded-lg border bg-card p-3" style={{ borderColor: `color-mix(in srgb, ${STATUS_COLOR[q.status]} 55%, var(--border))` }}>
            <span className="font-mono text-xs" style={{ color: STATUS_COLOR[q.status] }}>{q.n}</span>
            <span className="text-sm leading-snug">{q.short}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 font-mono text-sm">
        <span><span style={{ color: STATUS_COLOR.live }}>■</span> {count("live")} built and live</span>
        <span><span style={{ color: STATUS_COLOR.partial }}>■</span> {count("partial")} partly</span>
        <span><span style={{ color: STATUS_COLOR.design }}>■</span> {count("design")} designed</span>
      </div>
    </div>
  );
}

function ThreatSlide() {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {THREATS.map((t) => (
        <Card key={t.verb} className="gap-2 p-6" style={{ borderColor: "color-mix(in srgb, var(--directorate) 55%, var(--border))" }}>
          <span className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--directorate)]">The Directorate</span>
          <span className="text-3xl font-semibold">{t.verb}</span>
          <span className="text-lg text-foreground/80">{t.what}</span>
        </Card>
      ))}
    </div>
  );
}

function BoxSlide({ net }: { net: Undercurrent }) {
  const p = useProofs(net);
  return (
    <div className="grid items-start gap-3 lg:grid-cols-[1.2fr_1fr]">
      <Card className="gap-3 p-6">
        <span className="caption">Arduino UNO Q · Tisya&apos;s build</span>
        <ul className="flex flex-col divide-y divide-border">
          {BOX_PARTS.map((b) => (
            <li key={b.part} className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 py-2.5">
              <span className="w-44 shrink-0 font-semibold">{b.part}</span>
              <span className="min-w-0 flex-1 text-foreground/80">{b.does}</span>
            </li>
          ))}
        </ul>
      </Card>
      <div className="flex flex-col gap-3">
        <Card className="gap-2 p-6" style={{ borderColor: TONE[p.box.tone] }} aria-live="polite">
          <span className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.14em]" style={{ color: TONE[p.box.tone] }}>
            <Dot tone={p.box.tone} /> Live from the hubs
          </span>
          <span className="text-2xl font-semibold leading-snug">{p.box.headline}</span>
          <span className="text-sm text-muted-foreground">{p.box.detail}</span>
        </Card>
        <Card className="gap-1 p-6">
          <span className="font-mono text-3xl font-medium tabular-nums">0.81 s</span>
          <span className="text-foreground/80">water on the probe to the alert on the other hub</span>
          <span className="text-xs text-muted-foreground">median of 30, dry run with a simulated box; the real-box run uses the same script</span>
        </Card>
      </div>
    </div>
  );
}

function HowSlide({ net }: { net: Undercurrent }) {
  const chips = useStatusChips(net);
  return (
    <div className="flex flex-col gap-4">
      <HowItWorks net={net} />
      <div className="flex flex-wrap gap-1.5">{chips.map((c) => <StatusChip key={c.key} chip={c} />)}</div>
    </div>
  );
}

function HoldsSlide({ net }: { net: Undercurrent }) {
  const p = useProofs(net);
  const tiles = [
    { label: "Forge an all-clear", proof: p.forge, measured: "0 of 300 forgeries accepted" },
    { label: "Cut the link", proof: p.cut, measured: "200 of 200 delivered after 26 cuts" },
    { label: "Edit a stored record", proof: p.edit, measured: "160 of 160 edits caught at the row" },
  ];
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {tiles.map((t) => (
        <Card key={t.label} className="gap-3 p-6" style={{ borderColor: TONE[t.proof.tone] }} aria-live="polite">
          <span className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.14em]" style={{ color: TONE[t.proof.tone] }}>
            <Dot tone={t.proof.tone} /> {t.label}
          </span>
          <span className="text-2xl font-semibold leading-snug">{t.proof.headline}</span>
          <span className="text-sm text-muted-foreground">{t.proof.detail}</span>
          <span className="mt-auto border-t border-border pt-3 font-mono text-sm">{t.measured}</span>
        </Card>
      ))}
    </div>
  );
}

function SharesSlide({ net }: { net: Undercurrent }) {
  const surface = net.events.filter((e) => e.device_id === "canary-surface").sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const o2 = surface && typeof (surface.payload as { oxygen_pct?: unknown }).oxygen_pct === "number" ? (surface.payload as { oxygen_pct: number }).oxygen_pct : null;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid items-start gap-3 lg:grid-cols-[1.3fr_1fr]">
        <ExchangeSection net={net} compact />
        <WellbeingSection net={net} compact />
      </div>
      <LivabilityReplayStrip />
      {o2 !== null && (
        <p className="font-mono text-sm text-muted-foreground">
          And the surface: {o2}% oxygen, signed by the box at the top of the shaft{isSimulated(surface) ? " (simulated)" : ""}. The Directorate says it kills in minutes.
        </p>
      )}
    </div>
  );
}

function ProofSlide() {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
        {PROOF.map((r) => (
          <Card key={r.label} className="gap-1 p-4">
            <span className="font-mono text-2xl font-medium whitespace-nowrap tabular-nums sm:text-3xl lg:text-2xl 2xl:text-3xl">{r.value}</span>
            <span className="text-sm text-foreground/80">{r.label}</span>
          </Card>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Card className="gap-3 p-5">
          <span className="caption">Built with</span>
          <div className="flex flex-wrap gap-1.5">{STACK.map((s) => <Badge key={s} variant="secondary">{s}</Badge>)}</div>
        </Card>
        <Card className="gap-3 p-5" style={TEAM_PLACEHOLDER ? { borderColor: "var(--warn)", borderStyle: "dashed" } : undefined}>
          <span className="caption">Who built what{TEAM_PLACEHOLDER && <span className="ml-2 text-[var(--warn)]">fill in before recording: web/app/pitch/slides.ts</span>}</span>
          <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {TEAM.map((m, i) => (
              <li key={i} className="text-sm"><span className="font-semibold">{m.name}</span> · <span className="text-foreground/80">{m.built}</span></li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function Body({ id, net }: { id: (typeof SLIDES)[number]["id"]; net: Undercurrent }) {
  switch (id) {
    case "problem": return <ThreatSlide />;
    case "answer": return <HowSlide net={net} />;
    case "box": return <BoxSlide net={net} />;
    case "reach": return <QuestionsGrid />;
    case "holds": return <HoldsSlide net={net} />;
    case "thinks":
      return (
        <div className="grid items-start gap-3 xl:grid-cols-2">
          <TriageSection net={net} compact />
          <ForecastSection net={net} compact />
        </div>
      );
    case "shares": return <SharesSlide net={net} />;
    case "proof": return <ProofSlide />;
  }
}

// ------------------------------------------------------------------ the stage

/** The width every slide is laid out at: the 1080p recording. */
const DESIGN_W = 1920;

/**
 * Lays the slide out at 1920 px wide (or the screen's width, if wider) and scales it down to
 * fit the space between the top bar and the controls, centred. A slide made for 1080p then
 * shows whole on a 1440x900 laptop or in a 720p capture, and nothing changes at 1080p (the
 * scale never goes above 1). It refits when the notes open or live data changes the height.
 * Screens under 1024 px wide (phones) scroll instead, as before.
 */
function FitStage({ children }: { children: React.ReactNode }) {
  const outer = useRef<HTMLElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ s: number; left: number; top: number } | null>(null);

  useEffect(() => {
    const o = outer.current, i = inner.current;
    if (!o || !i) return;
    const measure = () => {
      if (window.innerWidth < 1024) {
        i.style.width = "";
        setFit(null);
        return;
      }
      const aw = o.clientWidth, ah = o.clientHeight;
      const w = Math.max(aw, DESIGN_W);
      if (i.style.width !== `${w}px`) i.style.width = `${w}px`;
      const h = i.offsetHeight; // layout size, not affected by the transform
      const s = Math.min(1, aw / w, ah / h);
      setFit({ s, left: (aw - w * s) / 2, top: Math.max(0, (ah - h * s) / 2) });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(o);
    ro.observe(i);
    measure();
    return () => ro.disconnect();
  }, []);

  return (
    <main ref={outer} className={`relative flex min-h-0 flex-1 flex-col ${fit ? "overflow-hidden" : "overflow-y-auto"}`}>
      <div ref={inner} data-scale={fit ? fit.s.toFixed(3) : undefined}
        className={fit ? "absolute flex origin-top-left flex-col gap-6 px-20 py-8" : "my-auto flex flex-col gap-6 px-6 py-8 sm:px-12 lg:px-20"}
        style={fit ? { left: fit.left, top: fit.top, transform: `scale(${fit.s})` } : undefined}>
        {children}
      </div>
    </main>
  );
}

export default function Pitch() {
  const net = useUndercurrent();
  useLiveToasts(net);
  const q = useCarriedQuery();
  const [i, setI] = useState(0);
  const [notes, setNotes] = useState(false);
  const [auto, setAuto] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const ready = useRef(false);

  // ?slide= and ?auto= on load
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const n = Number(p.get("slide"));
    if (Number.isInteger(n) && n >= 1 && n <= SLIDES.length) setI(n - 1);
    if (p.get("auto") === "1") { setAuto(true); setStartedAt(Date.now()); }
    ready.current = true;
  }, []);

  // keep ?slide= in the address, so a reload or a shared link lands on the same slide
  useEffect(() => {
    if (!ready.current) return;
    const p = new URLSearchParams(window.location.search);
    p.set("slide", String(i + 1));
    history.replaceState(null, "", `${window.location.pathname}?${p}`);
  }, [i]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const go = useCallback((to: number) => {
    setStartedAt((s) => s ?? Date.now());
    setI(Math.max(0, Math.min(SLIDES.length - 1, to)));
  }, []);

  // auto-play: advance after each slide's planned seconds, stop on the last
  useEffect(() => {
    if (!auto || i >= SLIDES.length - 1) return;
    const t = setTimeout(() => go(i + 1), SLIDES[i].seconds * 1000);
    return () => clearTimeout(t);
  }, [auto, i, go]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.isContentEditable)) return;
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") { e.preventDefault(); go(i + 1); }
      else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); go(i - 1); }
      else if (/^[1-9]$/.test(e.key) && Number(e.key) <= SLIDES.length) go(Number(e.key) - 1);
      else if (e.key === "n" || e.key === "N") setNotes((v) => !v);
      else if (e.key === "p" || e.key === "P") { setAuto((v) => !v); setStartedAt((s) => s ?? Date.now()); }
      else if (e.key === "f" || e.key === "F") document.documentElement.requestFullscreen?.().catch(() => {});
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [i, go]);

  const s = SLIDES[i];
  const elapsed = startedAt && now ? (now - startedAt) / 1000 : 0;
  const target = SLIDES.slice(0, i + 1).reduce((t, x) => t + x.seconds, 0);
  const over = elapsed > TOTAL_SECONDS;

  return (
    <TooltipProvider>
      <div className="flex h-[100dvh] flex-col overflow-hidden bg-background">
        <Toaster theme="dark" position="top-right" richColors />
        {/* top strip */}
        <header className="flex shrink-0 items-center gap-4 border-b border-border px-6 py-3">
          <Link href={`/overview${q}`} className="flex items-center gap-2 text-foreground">
            <WavesIcon className="size-5 text-primary" aria-hidden="true" />
            <span className="font-mono text-xs font-medium tracking-[0.18em]">UNDERCURRENT</span>
          </Link>
          <span className="font-mono text-xs text-muted-foreground">{i + 1} / {SLIDES.length}</span>
          <span className="ml-auto font-mono text-sm tabular-nums" style={{ color: over ? "var(--danger)" : elapsed > target ? "var(--warn)" : "var(--muted)" }} title="Elapsed / planned by the end of this slide">
            {clock(elapsed)} <span className="text-muted-foreground">/ {clock(target)} · {clock(TOTAL_SECONDS)}</span>
          </span>
          {net.mode === "demo" && <Badge variant="outline" className="border-[var(--sim)] text-[var(--sim)]">Demo data: no hub</Badge>}
        </header>

        {/* the slide */}
        <FitStage key={s.id}>
          <div className="flex max-w-5xl flex-col gap-3">
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-primary">{s.kicker}</p>
            <h1 className="text-balance text-4xl font-semibold leading-[1.05] tracking-tight lg:text-6xl">{s.title}</h1>
            <p className="max-w-[70ch] text-lg text-foreground/75 lg:text-xl">{s.sub}</p>
          </div>
          <div className="min-w-0">
            <Body id={s.id} net={net} />
          </div>
          <p className="flex items-baseline gap-3 border-l-2 border-primary pl-4 text-lg font-medium lg:text-xl">
            <span className="font-mono text-xs uppercase tracking-[0.16em] text-primary">Takeaway</span>
            {s.takeaway}
          </p>
        </FitStage>

        {/* speaker notes */}
        {notes && (
          <aside className="shrink-0 border-t border-border bg-card px-6 py-3 sm:px-12 lg:px-20" aria-label="Speaker notes">
            <p className="text-sm text-muted-foreground"><span className="caption mr-2">Why this slide</span>{s.purpose}</p>
            <p className="mt-1 text-sm leading-relaxed"><span className="caption mr-2">Say ({s.seconds} s)</span>{s.say}</p>
            {s.doNote && <p className="mt-1 text-sm text-muted-foreground"><span className="caption mr-2">Do</span>{s.doNote}</p>}
          </aside>
        )}

        {/* controls */}
        <footer className="flex shrink-0 items-center gap-3 border-t border-border px-6 py-2.5">
          <button onClick={() => go(i - 1)} disabled={i === 0} className="rounded-md p-2 text-muted-foreground hover:text-foreground disabled:opacity-30" aria-label="Previous slide">
            <ChevronLeftIcon className="size-5" />
          </button>
          <nav className="flex items-center gap-1.5" aria-label="Slides">
            {SLIDES.map((x, n) => (
              <button
                key={x.id}
                onClick={() => go(n)}
                aria-label={`Slide ${n + 1}: ${x.title}`}
                aria-current={n === i ? "step" : undefined}
                className="h-2 rounded-full"
                style={{ width: n === i ? 28 : 8, background: n === i ? "var(--accent)" : n < i ? "var(--border-strong)" : "var(--border)" }}
              />
            ))}
          </nav>
          <button onClick={() => go(i + 1)} disabled={i === SLIDES.length - 1} className="rounded-md p-2 text-muted-foreground hover:text-foreground disabled:opacity-30" aria-label="Next slide">
            <ChevronRightIcon className="size-5" />
          </button>
          <div className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
            <button onClick={() => setNotes((v) => !v)} className="flex items-center gap-1.5 rounded-md px-2 py-1.5 hover:text-foreground" aria-pressed={notes}>
              <ScrollTextIcon className="size-4" /> Notes <kbd className="font-mono">N</kbd>
            </button>
            <button onClick={() => { setAuto((v) => !v); setStartedAt((st) => st ?? Date.now()); }} className="flex items-center gap-1.5 rounded-md px-2 py-1.5 hover:text-foreground" aria-pressed={auto}>
              {auto ? <PauseIcon className="size-4" /> : <PlayIcon className="size-4" />} Auto-play <kbd className="font-mono">P</kbd>
            </button>
            <button onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})} className="hidden items-center gap-1.5 rounded-md px-2 py-1.5 hover:text-foreground sm:flex">
              <MaximizeIcon className="size-4" /> Full screen <kbd className="font-mono">F</kbd>
            </button>
          </div>
        </footer>
      </div>
    </TooltipProvider>
  );
}
