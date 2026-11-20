"use client";

// The judges' front door: what Undercurrent is, how one alert travels, and each of the five
// demo beats with live proof from the hubs and the exact command that shows it, then the
// deep dives. The live sections live in ./sections.tsx and are shared with /pitch.

import Link from "next/link";
import { Toaster } from "sonner";
import { ArrowLeftRightIcon, ArrowRightIcon } from "lucide-react";
import { AppBar, useCarriedQuery } from "@/components/app-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isEncrypted, useUndercurrent } from "@/lib/useUndercurrent";
import { BEATS, RESULTS } from "./beats";
import {
  CopyCommand, Dot, Eyebrow, ExchangeSection, ForecastSection, HowItWorks, SurfaceReturnSection, SurfaceSection, TONE,
  TriageSection, useLiveToasts, useProofs, WellbeingSection,
} from "./sections";

export default function Overview() {
  const net = useUndercurrent();
  const q = useCarriedQuery();
  const proofs = useProofs(net);
  useLiveToasts(net);

  const verified = net.events.filter(net.isVerified).length;
  const sealed = net.events.filter(isEncrypted).length;
  const queued = net.sendingHub?.link?.queued ?? 0;

  return (
    <div className="min-h-screen bg-background">
      <AppBar net={net} />
      <Toaster theme="dark" position="bottom-right" richColors closeButton />
      <main className="mx-auto flex max-w-7xl flex-col gap-16 px-4 pb-24 sm:px-6">
        {/* Hero */}
        <section className="flex flex-wrap items-end gap-10 pt-14">
          <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-5">
            <p className="caption">The Hollow · 40 levels underground · Patriot Hackfest 2026</p>
            <h1 className="max-w-[15ch] text-balance text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl">
              The network the Directorate can&apos;t read, fake or shut off.
            </h1>
            <p className="max-w-[62ch] text-lg text-foreground/75">
              A Canary sensor box and residents&apos; phones sign every alert. Two hubs check each one and keep identical copies, so a
              forged alert is refused, an edited record is caught, and cutting the link loses nothing.
            </p>
            <div className="flex flex-wrap gap-2.5 pt-1">
              <Button asChild size="lg">
                <a href="#beats">
                  Start the walkthrough <ArrowRightIcon />
                </a>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href={`/hollow${q}`}>Open the 3D map</Link>
              </Button>
            </div>
          </div>
          <Card className="min-w-0 flex-[1_1_320px] gap-0 p-5">
            <p className="caption mb-3">{net.mode === "demo" ? "Sample data (no hub reachable)" : "Right now, on the hubs"}</p>
            <dl className="grid grid-cols-2 gap-x-5 gap-y-4">
              {[
                { v: net.events.length, l: "events stored", c: "var(--foreground)" },
                { v: verified, l: "signed and verified", c: "var(--ok)" },
                { v: sealed, l: "sealed cell messages", c: "var(--accent)" },
                { v: queued, l: "waiting to send", c: queued ? "var(--warn)" : "var(--foreground)" },
              ].map((m) => (
                <div key={m.l} className="flex flex-col gap-0.5">
                  <dd className="font-mono text-3xl font-medium tabular-nums" style={{ color: m.c }}>{m.v}</dd>
                  <dt className="order-last text-[13px] text-muted-foreground">{m.l}</dt>
                </div>
              ))}
            </dl>
          </Card>
        </section>

        {/* How it works */}
        <section className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <Eyebrow>How it works</Eyebrow>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">One alert, from the water probe to every hub</h2>
          </div>
          <HowItWorks net={net} />
        </section>

        {/* The five beats */}
        <section id="beats" className="flex scroll-mt-6 flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <Eyebrow>The demo, in five beats</Eyebrow>
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
                      <div className="flex flex-col gap-1.5">
                        <span className="text-[13px] text-muted-foreground">{b.commandLabel}</span>
                        <CopyCommand text={b.command} />
                      </div>
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
        </section>

        <TriageSection net={net} />

        <ForecastSection net={net} />

        <ExchangeSection net={net} />

        <WellbeingSection net={net} />

        <SurfaceSection net={net} q={q} />

        <SurfaceReturnSection net={net} />

        {/* Results */}
        <section className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <Eyebrow>What we measured</Eyebrow>
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
        </section>

        {/* Try it */}
        <Card className="flex-row flex-wrap items-center gap-x-8 gap-y-4 p-6 sm:p-7">
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
        </Card>
      </main>
    </div>
  );
}
