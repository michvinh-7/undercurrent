"use client";

// The judges' front door: what Undercurrent is, how one alert travels, and each of the five
// demo beats with live proof from the hubs and the exact command that shows it, then the
// deep dives. The live sections live in ./sections.tsx and are shared with /pitch.

import Link from "next/link";
import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import { ArrowLeftRightIcon, ArrowRightIcon, BoxIcon, ChevronDownIcon, ShieldCheckIcon, SparklesIcon, ZapIcon } from "lucide-react";
import { BriefTour } from "./brief-tour";
import { NetworkBackground } from "./network-bg";
import { AppBar, useCarriedQuery } from "@/components/app-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUndercurrent } from "@/lib/useUndercurrent";
import { BEATS, RESULTS } from "./beats";
import { QUESTIONS } from "../pitch/slides";
import {
  Dot, ExchangeSection, ForecastSection, HowItWorks, SurfaceReturnSection, SurfaceSection, TONE,
  LivabilitySection, TriageSection, useLiveToasts, useProofs, WellbeingSection,
} from "./sections";

/** Where each of the brief's 15 questions is proven: a section on this page, or another page. */
const PROVEN_AT: Record<number, { label: string; href: string }> = {
  1: { label: "Forecast", href: "#forecast" }, 2: { label: "Have / Need", href: "#exchange" }, 3: { label: "Livability", href: "#livability" },
  4: { label: "3D map", href: "/hollow" }, 5: { label: "Beat 1", href: "#beats" }, 6: { label: "Have / Need", href: "#exchange" },
  7: { label: "How it works", href: "#how" }, 8: { label: "People", href: "#wellbeing" }, 9: { label: "Console", href: "/dashboard" },
  10: { label: "Have / Need", href: "#exchange" }, 11: { label: "People", href: "#wellbeing" }, 12: { label: "Food score", href: "#livability" },
  13: { label: "Surface", href: "#surface" }, 14: { label: "Next", href: "#next" }, 15: { label: "Next", href: "#next" },
};
const STATUS_COLOR = { live: "var(--ok)", partial: "var(--warn)", design: "var(--muted)" } as const;

const SECTIONS = [
  { id: "beats", label: "Attack it" }, { id: "how", label: "How it works" }, { id: "layers", label: "Built on top" },
  { id: "proof", label: "Proof" }, { id: "why", label: "Why it wins" }, { id: "questions", label: "The 15 questions" },
];

/** The features built on the signed channel, one visible at a time. Each id is also the old #anchor,
 * so links such as #forecast still land on the right tab. */
const LAYERS = [
  { id: "triage", label: "AI triage", q: "Q9, Q10" }, { id: "forecast", label: "Blackout forecast", q: "Q1" },
  { id: "exchange", label: "Have / Need", q: "Q2, Q6, Q12" }, { id: "wellbeing", label: "People", q: "Q8, Q11" },
  { id: "livability", label: "Livability", q: "Q3" }, { id: "surface", label: "Surface air", q: "Q13" },
  { id: "next", label: "Going up", q: "Q14, Q15" },
] as const;

/** An optional demo video, shown only when NEXT_PUBLIC_DEMO_VIDEO_URL is set (an .mp4 or an embed link). */
function DemoVideo() {
  const url = process.env.NEXT_PUBLIC_DEMO_VIDEO_URL;
  if (!url) return null;
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {/\.(mp4|webm)(\?|$)/.test(url)
        ? <video src={url} controls preload="metadata" className="aspect-video w-full" />
        : <iframe src={url} title="Undercurrent demo video" allow="fullscreen; picture-in-picture" allowFullScreen className="aspect-video w-full" />}
    </div>
  );
}

/** One of the four best things in the app, on the first screen. */
function Feature({ icon, image, title, body, href, action, delay = 0 }: { icon?: React.ReactNode; image?: boolean; title: string; body: string; href: string; action: string; delay?: number }) {
  const inner = (
    <>
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <span className="scan relative -mx-5 -mt-5 mb-1 block overflow-hidden rounded-t-xl">
          <img src="/overview-map.png" alt="The 3D map of level 34 with live alerts" className="block aspect-[900/520] w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.05]" />
        </span>
      ) : (
        <span className="flex size-10 items-center justify-center rounded-lg bg-accent text-primary transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-3 [&_svg]:size-5">{icon ?? <BoxIcon />}</span>
      )}
      <span className="text-lg font-semibold">{title}</span>
      <span className="text-[15px] leading-relaxed text-foreground/75">{body}</span>
      <span className="mt-auto inline-flex items-center gap-1.5 pt-2 text-sm font-medium text-primary">{action} <ArrowRightIcon className="size-4 transition-transform duration-300 group-hover:translate-x-1" /></span>
    </>
  );
  const cls = "reveal group flex flex-col gap-2 overflow-hidden rounded-xl border border-border bg-card/85 p-5 backdrop-blur-[2px] transition-[transform,box-shadow,border-color,background-color] duration-300 hover:-translate-y-1 hover:border-[color-mix(in_srgb,var(--accent)_55%,var(--border))] hover:bg-accent hover:shadow-[0_16px_40px_-18px_var(--accent)]";
  const style = { "--d": `${delay}ms` } as React.CSSProperties;
  return href.startsWith("#") ? <a href={href} className={cls} style={style}>{inner}</a> : <Link href={href} className={cls} style={style}>{inner}</Link>;
}

/** The headline numbers, kept small and quiet: one line under the features. */
function StatLine() {
  const items = [
    ["0 of 300", "forgeries accepted"], ["160 of 160", "edits caught"], ["0 of 1,120", "alerts lost across 40 hubs"], ["0 breaches", "in 40,156 attacks"],
  ];
  return (
    <p className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-border pt-4 text-[13px] text-muted-foreground">
      <span className="font-mono text-[11px] uppercase tracking-[0.14em]">Measured</span>
      {items.map(([v, l]) => (
        <span key={l}><span className="font-mono text-foreground/85">{v}</span> {l}</span>
      ))}
      <a href="#proof" className="underline-offset-4 hover:text-foreground hover:underline">All the numbers →</a>
    </p>
  );
}

/** Why this should win, in the four things judges grade. */
const WHY = [
  { head: "It answers the brief", body: "One signed channel answers 13 of the 15 questions live and designs the last 2. Question 7 (organise without the Directorate) and 13 (is the surface safe?) are central, not bolted on." },
  { head: "It is hard engineering", body: "Ed25519 signing at the source, an in-person roster, replay defence, per-hub hash chains repaired from the peer, sync that survives cuts, end-to-end cells, and a verifier that shares no code with the hub." },
  { head: "It is measured", body: "0 of 300 forgeries accepted, 160 of 160 edits caught at the row, 0 of 1,120 alerts lost across 40 hubs. Our own adaptive attackers made 40,156 attempts against our hubs with 0 breaches. Every number reruns from eval/." },
  { head: "It is honest about limits", body: "Boxes and city data are simulated and labelled. Hubs can see who sent a cell message and when. A physical cut stops movement until it is restored. The offline AI misjudges urgency about 1 time in 4, so code and signatures carry the safety." },
] as const;

/** The 15 questions as this page's index: each tile jumps to where it's proven. */
function QuestionIndex({ q }: { q: string }) {
  const count = (st: string) => QUESTIONS.filter((x) => x.status === st).length;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold">The 15 questions, and where each is proven</h2>
        <span className="text-[13px] text-muted-foreground">click one to jump to it</span>
        <span className="ml-auto flex flex-wrap gap-x-4 font-mono text-xs">
          <span><span style={{ color: STATUS_COLOR.live }}>■</span> {count("live")} live</span>
          {count("partial") > 0 && <span><span style={{ color: STATUS_COLOR.partial }}>■</span> {count("partial")} partly</span>}
          <span><span style={{ color: STATUS_COLOR.design }}>■</span> {count("design")} designed</span>
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {QUESTIONS.map((x) => {
          const at = PROVEN_AT[x.n];
          const href = at.href.startsWith("#") ? at.href : `${at.href}${q}`;
          const tile = (
            <>
              <span className="font-mono text-[11px]" style={{ color: STATUS_COLOR[x.status] }}>{x.n} → {at.label}</span>
              <span className="text-sm leading-snug text-foreground">{x.short}</span>
            </>
          );
          const cls = "flex min-h-[4.25rem] flex-col justify-between gap-1.5 rounded-lg border bg-card px-3 py-2.5 transition-colors hover:bg-accent";
          const style = { borderColor: `color-mix(in srgb, ${STATUS_COLOR[x.status]} 55%, var(--border))` };
          return at.href.startsWith("#")
            ? <a key={x.n} href={href} className={cls} style={style}>{tile}</a>
            : <Link key={x.n} href={href} className={cls} style={style}>{tile}</Link>;
        })}
      </div>
    </section>
  );
}

/** The deep dive's tabs: one part showing at a time. */
function SectionBar({ part, setPart }: { part: string; setPart: (p: string) => void }) {
  return (
    <nav aria-label="Deep dive" className="sticky top-0 z-[var(--z-header)] -mx-4 border-b border-border bg-background/90 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6">
      <div className="flex gap-1 overflow-x-auto">
        {SECTIONS.map((x) => (
          <button
            key={x.id}
            onClick={() => setPart(x.id)}
            aria-current={part === x.id ? "page" : undefined}
            className={`shrink-0 rounded-md px-3.5 py-2 text-sm font-medium transition-colors ${part === x.id ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
          >
            {x.label}
          </button>
        ))}
      </div>
    </nav>
  );
}

export default function Overview() {
  const net = useUndercurrent();
  const q = useCarriedQuery();
  const [layer, setLayer] = useState<string>("triage");
  // Everything below the first screen is folded under "Deep dive"; any #anchor opens it first.
  const [deep, setDeep] = useState(false);
  const [part, setPart] = useState<string>("beats");
  const [tour, setTour] = useState(false);
  useEffect(() => {
    // The old anchors (#forecast, #exchange, ...) name tabs: open the deep dive and the tab, then scroll to the block.
    const open = () => {
      const id = window.location.hash.slice(1);
      if (!id) return;
      setDeep(true);
      const go = (el: string) => setTimeout(() => document.getElementById(el)?.scrollIntoView({ behavior: "smooth" }), 60);
      if (LAYERS.some((l) => l.id === id)) {
        setLayer(id);
        setPart("layers");
        go("deep");
      } else if (id === "questions") {
        setTimeout(() => {
          const d = document.querySelector<HTMLDetailsElement>("#questions details");
          if (d) d.open = true;
        }, 60);
        setPart("questions");
        go("deep");
      } else {
        if (SECTIONS.some((x) => x.id === id)) setPart(id);
        go("deep");
      }
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);
  const proofs = useProofs(net);
  useLiveToasts(net);

  return (
    <div className="relative min-h-screen overflow-x-clip bg-background">
      <NetworkBackground />
      <AppBar net={net} />
      <Toaster theme="dark" position="bottom-right" richColors closeButton />
      <BriefTour open={tour} onClose={() => setTour(false)} q={q} />
      <main className="relative z-10 mx-auto flex max-w-7xl flex-col gap-14 px-4 pb-24 sm:px-6">
        {/* Hero: who we are, two actions, and the best things in the app. The numbers sit in one quiet line. */}
        <section className="relative flex flex-col gap-8 pt-12">
          <div className="hero-glow" aria-hidden />
          <div className="relative flex flex-col gap-5">
            <p className="caption reveal">The Hollow · 40 levels underground · Patriot Hackfest 2026</p>
            <h1 className="reveal max-w-[22ch] text-balance text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl" style={{ "--d": "80ms" } as React.CSSProperties}>
              The network the Directorate <span className="text-shimmer bg-[linear-gradient(90deg,var(--foreground)_0%,var(--foreground)_35%,#c4b8ff_50%,var(--foreground)_65%,var(--foreground)_100%)] bg-[length:200%_100%] bg-clip-text text-transparent">can&apos;t read, fake or shut off.</span>
            </h1>
            <p className="reveal max-w-[60ch] text-lg text-foreground/75" style={{ "--d": "160ms" } as React.CSSProperties}>
              Every alert is signed at the source and checked by every hub, with no internet. Forgeries are refused and cutting the link loses nothing.
            </p>
            <div className="reveal flex flex-wrap gap-2.5 pt-1" style={{ "--d": "240ms" } as React.CSSProperties}>
              <Button asChild size="lg" className="shine relative overflow-hidden shadow-[0_8px_30px_-10px_var(--accent)] transition-shadow hover:shadow-[0_10px_40px_-8px_var(--accent)]">
                <Link href={`/pitch${q}`}>
                  Watch the 3-minute pitch <ArrowRightIcon />
                </Link>
              </Button>
              <Button size="lg" variant="outline" onClick={() => setTour(true)}>
                How does this answer the brief?
              </Button>
            </div>
          </div>

          <div className="relative grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <Feature
              icon={<ShieldCheckIcon />} delay={320} title="Try to forge an alert" body="Send a fake all-clear signed by a key no hub knows. The hub refuses it, live, and says why."
              href={`/dashboard${q}`} action="Attack it live"
            />
            <Feature
              image delay={400} title="The 3D city" body="Every signed alert drawn where it happened: floods close streets, bad air and heat glow, the safe route appears."
              href={`/hollow${q}`} action="Open the map"
            />
            <Feature
              icon={<SparklesIcon />} delay={480} title="AI reads the panic" body="Type a messy SOS. An offline model on the hub pulls out the facts and code ranks it first on a slow link."
              href="#triage" action="Try it"
            />
            <Feature
              icon={<ZapIcon />} delay={560} title="Blackout forecast" body="A relay box's signed voltage readings predict when the power drops, with a range, before it happens."
              href="#forecast" action="See it"
            />
          </div>

          <div className="reveal relative" style={{ "--d": "680ms" } as React.CSSProperties}><StatLine /></div>
        </section>

        <DemoVideo />

        <button
          onClick={() => setDeep((d) => !d)}
          aria-expanded={deep}
          className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card px-5 py-4 text-left transition-colors hover:bg-accent"
        >
          <span className="flex flex-col gap-0.5">
            <span className="text-lg font-semibold">Deep dive</span>
            <span className="text-sm text-muted-foreground">The five demo beats, how it works, everything built on top, the numbers, and the 15 questions</span>
          </span>
          <ChevronDownIcon className={`size-5 shrink-0 transition-transform ${deep ? "rotate-180" : ""}`} />
        </button>

        {deep && (<div id="deep" className="-mt-10 flex scroll-mt-4 flex-col gap-6">
        <SectionBar part={part} setPart={setPart} />

        {/* The five beats */}
        {part === "beats" && <section id="beats" className="tab-in flex scroll-mt-16 flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Each one checked live against the hubs</h2>
          </div>
          <Tabs defaultValue="box">
            <TabsList className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {BEATS.map((b, i) => (
                <TabsTrigger
                  key={b.id}
                  value={b.id}
                  className="flex min-h-11 flex-col items-start justify-start gap-1 rounded-xl border border-border bg-card p-3.5 text-left data-[state=active]:border-primary data-[state=active]:bg-accent"
                >
                  <span className="flex items-center gap-2 font-mono text-xs text-muted-foreground"><Dot tone={proofs[b.id].tone} />Beat {i + 1}</span>
                  <span className="text-[15px] font-semibold text-foreground">{b.title}</span>
                  <span className="text-[13px] font-normal" style={{ color: TONE[proofs[b.id].tone] }}>{proofs[b.id].short}</span>
                </TabsTrigger>
              ))}
            </TabsList>
            {BEATS.map((b) => {
              const p = proofs[b.id];
              return (
                <TabsContent key={b.id} value={b.id}>
                  <Card className="flex-row flex-wrap gap-7 p-6 sm:p-7">
                    <div className="flex min-w-0 flex-[999_1_480px] flex-col gap-4">
                      <div className="flex flex-col gap-1.5">
                        <p className="caption">What happens</p>
                        <p className="max-w-[58ch] text-lg">{b.what}</p>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <p className="caption">Watch for</p>
                        <p className="max-w-[58ch] text-foreground/75">{b.watch}</p>
                      </div>
                      <div className="flex flex-col gap-1 rounded-lg border bg-background px-4 py-3.5" style={{ borderColor: TONE[p.tone] }} aria-live="polite">
                        <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em]" style={{ color: TONE[p.tone] }}>
                          <Dot tone={p.tone} />Live proof
                        </span>
                        <span className="text-xl font-semibold">{p.headline}</span>
                        <span className="text-[13px] text-muted-foreground">{p.detail}</span>
                      </div>
                    </div>
                    <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-3.5">
                      <p className="caption">Show it</p>
                      <Button asChild variant="outline" size="lg" className="justify-between">
                        <Link href={`${b.open.href}${q}`}>
                          {b.open.label} <ArrowRightIcon />
                        </Link>
                      </Button>
                      <div className="flex flex-col gap-0.5 pt-1">
                        <span className="text-[13px] text-muted-foreground">Measured</span>
                        <span className="font-mono text-[15px]">{b.measured}</span>
                      </div>
                    </div>
                  </Card>
                </TabsContent>
              );
            })}
          </Tabs>
        </section>}

        {/* How it works */}
        {part === "how" && <section id="how" className="tab-in flex scroll-mt-16 flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">One alert, from the water probe to every hub</h2>
          </div>
          <HowItWorks net={net} />
        </section>}

        {/* Everything built on the signed channel, one at a time */}
        {part === "layers" && <section id="layers" className="tab-in flex scroll-mt-16 flex-col gap-5">
          <Tabs value={layer} onValueChange={setLayer}>
            <TabsList className="flex flex-wrap gap-2">
              {LAYERS.map((l) => (
                <TabsTrigger key={l.id} value={l.id} className="min-h-11 flex-col items-start gap-0.5 rounded-xl border border-border bg-card px-3.5 py-2 data-[state=active]:border-primary">
                  <span className="text-[15px] font-semibold text-foreground">{l.label}</span>
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value="triage" className="mt-3"><TriageSection net={net} /></TabsContent>
            <TabsContent value="forecast" className="mt-3"><ForecastSection net={net} /></TabsContent>
            <TabsContent value="exchange" className="mt-3"><ExchangeSection net={net} /></TabsContent>
            <TabsContent value="wellbeing" className="mt-3"><WellbeingSection net={net} /></TabsContent>
            <TabsContent value="livability" className="mt-3"><LivabilitySection net={net} /></TabsContent>
            <TabsContent value="surface" className="mt-3"><SurfaceSection net={net} q={q} /></TabsContent>
            <TabsContent value="next" className="mt-3"><SurfaceReturnSection net={net} /></TabsContent>
          </Tabs>
        </section>}

        {/* Results */}
        {part === "proof" && <section id="proof" className="tab-in flex scroll-mt-16 flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">The numbers behind each beat</h2>
          </div>
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 lg:grid-cols-5">
            {RESULTS.map((r) => (
              <Card key={r.label} className="gap-1.5 p-4 sm:p-5">
                <span className="font-mono text-2xl font-medium tabular-nums sm:text-3xl">{r.value}</span>
                <span className="text-sm">{r.label}</span>
                <span className="text-xs text-muted-foreground">{r.source}</span>
              </Card>
            ))}
          </div>
          <p className="max-w-[90ch] text-sm text-muted-foreground">
            What it doesn&apos;t do: hubs can see who sent a cell message and when, just not what it says. The Directorate can still cut
            power to a hub; nothing is lost, but nothing moves until it&apos;s back. Full table in <code className="font-mono">eval/results/RESULTS.md</code>.
          </p>
        </section>}

        {/* Why it should win */}
        {part === "why" && <section id="why" className="tab-in flex scroll-mt-16 flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">What a judge can check in five minutes</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {WHY.map((w) => (
              <Card key={w.head} className="gap-2 p-5 sm:p-6">
                <span className="text-lg font-semibold">{w.head}</span>
                <span className="text-foreground/75">{w.body}</span>
              </Card>
            ))}
          </div>
        </section>}

        {/* The 15 questions */}
        {part === "questions" && <section id="questions" className="tab-in scroll-mt-16">
          <details open className="rounded-xl border border-border bg-card">
            <summary className="cursor-pointer select-none px-5 py-4 text-lg font-semibold">
              The brief&apos;s 15 questions: {QUESTIONS.filter((x) => x.status === "live").length} live{QUESTIONS.some((x) => x.status === "partial") ? `, ${QUESTIONS.filter((x) => x.status === "partial").length} partly` : ""}, {QUESTIONS.filter((x) => x.status === "design").length} designed
            </summary>
            <div className="px-5 pb-5"><QuestionIndex q={q} /></div>
          </details>
        </section>}

        {/* Try it (with How it works only) */}
        {part === "how" && <Card className="flex-row flex-wrap items-center gap-x-8 gap-y-4 p-6 sm:p-7">
          <div className="flex min-w-0 flex-[999_1_420px] flex-col gap-1.5">
            <span className="text-lg font-semibold">Try it on your phone</span>
            <span className="text-foreground/75">
              Join the hotspot, open the phone link that <code className="font-mono text-sm">demo_hubs.py up --host 0.0.0.0</code> prints, and show your
              join code to the operator. Your reports arrive signed and verified.
            </span>
          </div>
          <div className="flex flex-[1_1_280px] flex-wrap items-center gap-2">
            <Badge variant="secondary"><ArrowLeftRightIcon />Same Wi-Fi as the hubs</Badge>
            <Badge variant="secondary">No internet needed</Badge>
          </div>
        </Card>}
        </div>)}
      </main>
    </div>
  );
}
