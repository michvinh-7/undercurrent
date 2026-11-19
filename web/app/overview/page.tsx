"use client";

// The judges' front door: what Undercurrent is, how one alert travels, and each of the five
// demo beats with live proof from the hubs and the exact command that shows it. Nothing
// here is made up: counts come from useUndercurrent (the same data as the console), and
// "Waiting for the box" stays until the real canary-34 sends something.

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast, Toaster } from "sonner";
import {
  ArrowLeftRightIcon, ArrowRightIcon, BrainCircuitIcon, CloudSunIcon, MegaphoneIcon, CheckIcon, CopyIcon, DropletIcon, LoaderCircleIcon, ServerIcon, SmartphoneIcon,
} from "lucide-react";
import { AppBar, useCarriedQuery } from "@/components/app-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAgreement } from "@/lib/useAgreement";
import { isEncrypted, isSimulated, useUndercurrent, type Undercurrent } from "@/lib/useUndercurrent";
import { BEATS, RESULTS, TRIAGE_EXAMPLES, TRIAGE_RESULTS, type BeatId } from "./beats";
import { DIRECTORATE_SURFACE_CLAIM } from "../hollow/city/directorate";
import { timeAgo } from "@/lib/format";

type Tone = "ok" | "warn" | "danger" | "muted";
const TONE: Record<Tone, string> = { ok: "var(--ok)", warn: "var(--warn)", danger: "var(--danger)", muted: "var(--muted)" };
interface Proof { tone: Tone; short: string; headline: string; detail: string }

const REAL_BOX = "canary-34";

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="font-mono text-xs uppercase tracking-[0.14em] text-primary">{children}</p>;
}

function Dot({ tone }: { tone: Tone }) {
  return <span className="inline-block size-2 shrink-0 rounded-full" style={{ background: TONE[tone] }} aria-hidden="true" />;
}

/** Remembers the most alerts that waited during the current or last cut, so "3 queued, 3 delivered" survives the restore. */
function useLastCut(net: Undercurrent) {
  const link = net.sendingHub?.link ?? null;
  const [last, setLast] = useState<{ peak: number; open: boolean } | null>(null);
  useEffect(() => {
    if (!link) return;
    setLast((cur) => {
      if (link.cut) return { peak: Math.max(cur?.open ? cur.peak : 0, link.queued), open: true };
      if (cur?.open) return { peak: cur.peak, open: false };
      return cur;
    });
  }, [link]);
  return last;
}

function useProofs(net: Undercurrent): Record<BeatId, Proof> {
  const lastCut = useLastCut(net);
  return useMemo(() => {
    const live = net.mode === "live";
    const box = net.events.filter((e) => e.device_id === REAL_BOX).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    const simBoxes = new Set(net.events.filter((e) => e.device_id && e.device_id !== REAL_BOX && isSimulated(e)).map((e) => e.device_id));
    const link = net.sendingHub?.link ?? null;
    const sealed = net.events.filter(isEncrypted).length;
    const intact = net.chain ? net.chain.chain_intact : null;
    const reason = net.rejected[0]?.reason;
    return {
      box: box
        ? { tone: net.isVerified(box) ? "ok" : "warn", short: net.isVerified(box) ? "Box verified" : "Box not verified",
            headline: `${String(box.payload.kind ?? "alert")} from ${REAL_BOX}`, detail: `${box.hub_id} · ${new Date(box.created_at).toLocaleTimeString()}${net.isVerified(box) ? " · verified" : " · signature not on the roster"}` }
        : { tone: "warn", short: "Waiting for the box", headline: "Waiting for the box",
            detail: simBoxes.size ? `${simBoxes.size} simulated box${simBoxes.size === 1 ? " is" : "es are"} reporting, labelled simulated.` : "No sensor alerts yet. The sim can fill the hubs while the box is away." },
      cut: !link
        ? { tone: "muted", short: "No link info", headline: "Link status unavailable", detail: live ? "The sending hub hasn't reported its link yet." : "Connect to the hubs to see the link." }
        : link.cut
          ? { tone: "warn", short: `${link.queued} waiting`, headline: `Link cut · ${link.queued} waiting`, detail: "Nothing is lost: they sit in the sending hub's queue until the link is back." }
          : lastCut && !lastCut.open && lastCut.peak > 0
            ? { tone: link.queued ? "warn" : "ok", short: link.queued ? `${link.queued} still sending` : "Link up", headline: link.queued ? `Restored · ${link.queued} still sending` : `Last cut: ${lastCut.peak} queued, all delivered`, detail: "The waiting count dropped to zero after the restore." }
            : { tone: "ok", short: "Link up", headline: `Link up · ${link.queued} waiting`, detail: "Cut it to show the queue fill and drain." },
      forge: net.forgeriesBlocked > 0
        ? { tone: "ok", short: `${net.forgeriesBlocked} blocked`, headline: `${net.forgeriesBlocked} ${net.forgeriesBlocked === 1 ? "forgery" : "forgeries"} blocked`, detail: reason ? `Latest reason: ${reason}.` : "Each one is listed with its reason." }
        : { tone: "muted", short: "None tried yet", headline: "No forgeries tried yet", detail: "Send one: it's refused and counted." },
      edit: intact === false
        ? { tone: "danger", short: "Row flagged", headline: `Chain broken at ${net.chain?.first_bad_event?.slice(0, 8) ?? "a row"}`, detail: "The other hub still holds the original, so the truth survives the edit." }
        : intact === true
          ? { tone: "ok", short: "Chain intact", headline: "Chain intact", detail: "Every row's hash matches the row before it." }
          : { tone: "muted", short: "Not checked yet", headline: "Chain not checked yet", detail: "The console checks it every few seconds." },
      sniff: sealed > 0
        ? { tone: "ok", short: `${sealed} sealed`, headline: `${sealed} sealed cell message${sealed === 1 ? "" : "s"} · ${net.events.length - sealed} public`, detail: "Hubs relay the sealed ones without being able to open them." }
        : { tone: "muted", short: "None sent yet", headline: "No cell messages yet", detail: "Send one from a phone's Cell messages page." },
    };
  }, [net, lastCut]);
}

/** Toasts for things that happen after the page has loaded, never for the stored backlog. */
function useLiveToasts(net: Undercurrent) {
  const seen = useRef<{ forgeries: number; cut: boolean; intact: boolean | null; box: string | null } | null>(null);
  useEffect(() => {
    if (net.mode !== "live") return;
    const box = net.events.filter((e) => e.device_id === REAL_BOX).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    const now = { forgeries: net.forgeriesBlocked, cut: !!net.sendingHub?.link?.cut, intact: net.chain ? net.chain.chain_intact : null, box: box?.id ?? null };
    const before = seen.current;
    seen.current = now;
    if (!before) return; // first live snapshot: remember, don't announce
    if (now.forgeries > before.forgeries) toast.error(`Forgery refused${net.rejected[0]?.reason ? `: ${net.rejected[0].reason}` : ""}`, { description: `${now.forgeries} blocked so far` });
    if (now.cut && !before.cut) toast.warning("Link cut", { description: "Alerts now queue on the sending hub." });
    if (!now.cut && before.cut) toast.success("Link restored", { description: "Queued alerts are on their way." });
    if (now.intact === false && before.intact !== false) toast.error("Chain broken", { description: `Edited record at ${net.chain?.first_bad_event?.slice(0, 8) ?? "a row"}` });
    if (now.intact === true && before.intact === false) toast.success("Chain intact again");
    if (now.box && now.box !== before.box && box && net.isFresh(box.id)) toast.success(`Box alert: ${String(box.payload.kind ?? "alert")}`, { description: `${REAL_BOX} → ${box.hub_id}${net.isVerified(box) ? ", verified" : ""}` });
  }, [net]);
}

function CopyCommand({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const isCommand = !text.startsWith("Phone:");
  return (
    <div className="flex items-start gap-2 rounded-lg border border-border bg-background p-2.5 pl-3">
      <code className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-[12.5px] leading-relaxed text-foreground/85">{text}</code>
      {isCommand && (
        <Button
          variant="outline"
          size="sm"
          aria-label="Copy command"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? "Copied" : "Copy"}
        </Button>
      )}
    </div>
  );
}

function FlowNode({ icon, title, body, tone }: { icon: React.ReactNode; title: string; body: string; tone: Tone }) {
  return (
    <div className="flex min-w-0 flex-[1_1_170px] flex-col gap-1.5 rounded-lg border bg-background p-3.5" style={{ borderColor: TONE[tone] }}>
      {icon}
      <span className="font-semibold">{title}</span>
      <span className="text-[13px] text-muted-foreground">{body}</span>
    </div>
  );
}

function FlowArrow({ label, tone, dashed, back }: { label: string; tone: Tone; dashed?: boolean; back?: boolean }) {
  return (
    <div className="hidden flex-none flex-col items-center justify-center gap-0.5 self-center font-mono text-[11px] sm:flex" style={{ color: tone === "muted" ? "var(--muted)" : TONE[tone] }}>
      {label}
      <svg aria-hidden="true" width="36" height="14" viewBox="0 0 36 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray={dashed ? "4 4" : undefined}>
        {back === undefined ? <path d="M0 4h34M29 0l5 4M36 10H2M7 14l-5-4" /> : back ? <path d="M36 7H2M7 2 2 7l5 5" /> : <path d="M0 7h34M29 2l5 5-5 5" />}
      </svg>
    </div>
  );
}

/** What POST /triage returns (hub/app/triage.py TriageRecord). */
interface Triage {
  type: string;
  urgency: "sos" | "urgent" | "routine" | "fake_suspect";
  level: number | null;
  injuries: number | null;
  people_count: number | null;
  hazard: string | null;
  priority: number;
  source: "model" | "cloud" | "keywords";
}

const URGENCY: Record<Triage["urgency"], { label: string; color: string }> = {
  sos: { label: "SOS", color: "var(--danger)" },
  urgent: { label: "Urgent", color: "var(--warn)" },
  routine: { label: "Routine", color: "var(--ok)" },
  fake_suspect: { label: "Looks fake", color: "var(--directorate)" },
};

const SOURCE: Record<Triage["source"], string> = {
  model: "Local AI model, running on the hub with no internet",
  cloud: "Cloud AI model (online mirror only)",
  keywords: "Keyword rules: no AI model was reachable, so the hub fell back",
};

/** The live triage box: type a messy message, the hub's AI reads it and scores it. */
function TriageSection({ net }: { net: Undercurrent }) {
  const primary = net.hubs.find((h) => h.role === "primary");
  const [text, setText] = useState(TRIAGE_EXAMPLES[0].text);
  const [result, setResult] = useState<Triage | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const live = net.mode === "live" && !!primary;

  async function rank(message = text) {
    if (!primary || !message.trim()) return;
    setState("busy");
    try {
      const res = await fetch(`${primary.url}/triage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: message.trim() }),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(String(res.status));
      setResult((await res.json()) as Triage);
      setState("idle");
    } catch {
      setState("error");
    }
  }

  const queue = net.events.filter((e) => e.type !== "roster" && e.priority !== null);
  const ahead = result ? queue.filter((e) => (e.priority ?? 0) > result.priority).length : 0;
  const u = result ? URGENCY[result.urgency] : null;
  const facts = result
    ? [
        ["Kind", result.hazard ? result.hazard.replace("_", " ") : result.type.replace("_", " ")],
        ["Level", result.level ?? "not stated"],
        ["People", result.people_count ?? "not stated"],
        ["Injured", result.injuries ?? "not stated"],
      ]
    : [];

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Eyebrow>How the hub decides what&apos;s urgent</Eyebrow>
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">AI reads the panic, code does the math</h2>
        <p className="max-w-[70ch] text-foreground/75">
          On a slow link, the most urgent message has to go first. An AI model running on the hub reads each free-text report and pulls out
          the facts. Plain code then turns those facts into a priority and checks every number against the message, so the model never
          invents one.
        </p>
      </div>
      <div className="flex flex-wrap items-start gap-4">
        <Card className="min-w-0 flex-[999_1_480px] gap-4 p-6">
          <div className="flex items-center gap-2">
            <BrainCircuitIcon className="size-5 text-primary" aria-hidden="true" />
            <span className="font-semibold">Try it</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {TRIAGE_EXAMPLES.map((ex) => (
              <Button key={ex.label} variant="outline" size="sm" onClick={() => { setText(ex.text); setResult(null); }}>
                {ex.label}
              </Button>
            ))}
          </div>
          <label htmlFor="triage-text" className="sr-only">Message to rank</label>
          <textarea
            id="triage-text"
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={600}
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-base outline-none focus:border-primary"
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => rank()} disabled={!live || state === "busy" || !text.trim()}>
              {state === "busy" ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : <BrainCircuitIcon aria-hidden="true" />}
              {state === "busy" ? "Reading it…" : "Rank it"}
            </Button>
            {!live && <span className="text-sm text-muted-foreground">Connect to a hub to try it live.</span>}
            {state === "error" && <span className="text-sm text-[var(--danger)]">The hub didn&apos;t answer. Try again.</span>}
          </div>
          {result && u && (
            <div className="flex flex-col gap-3 rounded-lg border bg-background p-4" style={{ borderColor: u.color }} aria-live="polite">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="rounded-full px-2.5 py-0.5 font-mono text-xs font-medium" style={{ color: u.color, border: `1px solid ${u.color}` }}>
                  {u.label}
                </span>
                <span className="font-mono text-sm text-muted-foreground">priority {result.priority.toFixed(2)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-accent" aria-hidden="true">
                <div className="h-full rounded-full" style={{ width: `${Math.round(result.priority * 100)}%`, background: u.color }} />
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                {facts.map(([k, v]) => (
                  <div key={String(k)} className="flex flex-col">
                    <dt className="text-xs text-muted-foreground">{k}</dt>
                    <dd className="font-medium capitalize">{String(v)}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-sm text-foreground/80">
                {queue.length
                  ? ahead === 0
                    ? `It would go to the top of the queue, ahead of all ${queue.length} stored reports.`
                    : `It would be number ${ahead + 1} of ${queue.length + 1} in the queue.`
                  : "With nothing else waiting, it would go out first."}
              </p>
              <p className="text-xs text-muted-foreground">Read by: {SOURCE[result.source]}</p>
            </div>
          )}
        </Card>
        <Card className="min-w-0 flex-[1_1_340px] gap-3 p-6">
          <span className="font-semibold">Measured on 149 held-out messages</span>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-normal"></th>
                  <th className="pb-2 font-normal">AI</th>
                  <th className="pb-2 font-normal">Keywords</th>
                </tr>
              </thead>
              <tbody>
                {TRIAGE_RESULTS.map((r) => (
                  <tr key={r.label} className="border-t border-border">
                    <td className="py-2 pr-3">{r.label}</td>
                    <td className="py-2 pr-3 font-mono tabular-nums">
                      {r.ai}
                      <span className="block whitespace-nowrap text-[11px] text-muted-foreground">{r.aiCi}</span>
                    </td>
                    <td className="py-2 font-mono tabular-nums text-muted-foreground">{r.rules}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            AI column: Gemini 3.1 Flash Lite, 95% intervals below each number. The small model the hub runs offline (Llama 3.2 3B) scores
            75.8% on urgency and 87.9% on SOS recall, and cuts SOS delay by 72.4%. Full table in <code className="font-mono">eval/results/RESULTS.md</code>.
          </p>
        </Card>
      </div>
    </section>
  );
}

const SURFACE_BOX = "canary-surface";

/** Question 13: is the surface safe? The Directorate's claim next to the newest signed reading from the box at the top of the shaft. */
function SurfaceSection({ net, q }: { net: Undercurrent; q: string }) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  const readings = net.events.filter((e) => e.device_id === SURFACE_BOX).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const latest = readings[0];
  const p = (latest?.payload ?? {}) as { reading?: { value?: unknown; unit?: unknown }; oxygen_pct?: unknown; note?: unknown };
  const co2 = typeof p.reading?.value === "number" ? `${p.reading.value} ${String(p.reading.unit ?? "")}`.trim() : null;
  const o2 = typeof p.oxygen_pct === "number" ? `${p.oxygen_pct}%` : null;
  const verified = latest ? net.isVerified(latest) : false;
  const simulated = latest ? isSimulated(latest) : false;

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Eyebrow>Is the surface safe?</Eyebrow>
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Their word against a signed reading</h2>
        <p className="max-w-[70ch] text-foreground/75">
          A box at the top of the shaft measures the surface air and signs every reading with its own key. Hubs refuse anything else, so
          neither the Directorate nor anyone in the Hollow can fake what it says.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Card className="gap-3 p-6" style={{ borderColor: "color-mix(in srgb, var(--directorate) 55%, var(--border))" }}>
          <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--directorate)]">
            <MegaphoneIcon className="size-4" aria-hidden="true" /> The Directorate says
          </span>
          <p className="text-2xl font-semibold leading-snug">&ldquo;{DIRECTORATE_SURFACE_CLAIM}.&rdquo;</p>
          <p className="text-sm text-muted-foreground">Unsigned. No reading, no sensor, no way to check it.</p>
        </Card>
        <Card className="gap-3 p-6" style={{ borderColor: latest ? (verified ? "var(--ok)" : "var(--warn)") : "var(--border)" }} aria-live="polite">
          <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em]" style={{ color: latest ? "var(--ok)" : "var(--muted)" }}>
            <CloudSunIcon className="size-4" aria-hidden="true" /> The surface box measured
          </span>
          {latest ? (
            <>
              <dl className="grid grid-cols-2 gap-4">
                <div>
                  <dt className="text-xs text-muted-foreground">Oxygen</dt>
                  <dd className="font-mono text-3xl font-medium tabular-nums">{o2 ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">CO₂</dt>
                  <dd className="font-mono text-3xl font-medium tabular-nums">{co2 ?? "—"}</dd>
                </div>
              </dl>
              <div className="flex flex-wrap items-center gap-1.5">
                {verified ? <Badge variant="outline" className="border-[var(--ok)] text-[var(--ok)]">✓ Signed by the box</Badge> : <Badge variant="outline" className="border-[var(--warn)] text-[var(--warn)]">Not verified</Badge>}
                {simulated && <Badge variant="outline" className="border-[var(--sim)] text-[var(--sim)]">Simulated</Badge>}
                <span className="text-xs text-muted-foreground">
                  {latest.hub_id}{now ? ` · ${timeAgo(latest.created_at, now)}` : ""} · {readings.length} reading{readings.length === 1 ? "" : "s"}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {simulated
                  ? "From the simulation, signed exactly like a real box would. Normal air is about 21% oxygen and 420 ppm CO₂."
                  : "Normal air is about 21% oxygen and 420 ppm CO₂."}
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">
              No surface reading yet. The simulation sends one about 30 seconds into its run (<code className="font-mono text-sm">sim/simulate.py run</code>).
            </p>
          )}
          <Button asChild variant="outline" size="sm" className="self-start">
            <Link href={`/hollow${q}`}>See it in the map&apos;s Briefs (question 13) <ArrowRightIcon /></Link>
          </Button>
        </Card>
      </div>
    </section>
  );
}

export default function Overview() {
  const net = useUndercurrent();
  const q = useCarriedQuery();
  const proofs = useProofs(net);
  useLiveToasts(net);
  const primary = net.hubs.find((h) => h.role === "primary");
  const agreement = useAgreement(primary?.url ?? null, net.mode === "live" && net.hubs.length > 1);

  const verified = net.events.filter(net.isVerified).length;
  const sealed = net.events.filter(isEncrypted).length;
  const queued = net.sendingHub?.link?.queued ?? 0;
  const cut = !!net.sendingHub?.link?.cut;
  const hubsUp = net.hubs.length > 0 && net.hubs.every((h) => h.online);
  const boxSeen = net.events.some((e) => e.device_id === REAL_BOX);
  const syncTone: Tone = cut ? "warn" : agreement.agrees === true ? "ok" : agreement.agrees === false ? "warn" : "muted";

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
          <Card className="gap-6 p-6 sm:p-7">
            <div className="flex flex-wrap items-stretch gap-2.5">
              <FlowNode tone={boxSeen ? "ok" : "warn"} icon={<DropletIcon className="size-5 text-[var(--water)]" aria-hidden="true" />} title="Canary box, L34"
                body={boxSeen ? "Water probe trips. The box signs the alert with its own key." : "Water probe trips; the box signs the alert. Waiting for the real box."} />
              <FlowArrow label="signed" tone="muted" back={false} />
              <FlowNode tone={net.hubs.find((h) => h.hubId === "hub-L34")?.online ? "ok" : "muted"} icon={<ServerIcon className="size-5 text-primary" aria-hidden="true" />} title="Hub L34"
                body="Checks the signature, the roster and the time, then adds the alert to its own hash chain." />
              <FlowArrow label={cut ? "link cut" : "sync"} tone={syncTone} dashed={cut} />
              <FlowNode tone={net.hubs.find((h) => h.hubId === "hub-L12")?.online ? "ok" : "muted"} icon={<ServerIcon className="size-5 text-primary" aria-hidden="true" />} title="Hub L12"
                body={agreement.agrees ? `Same checks. Both hubs hold the same events: fingerprint ${agreement.fingerprint?.slice(0, 6)}.` : "Runs the same checks. Both hubs end up with the same events, proven by one fingerprint."} />
              <FlowArrow label="signed" tone="muted" back />
              <FlowNode tone={hubsUp ? "ok" : "muted"} icon={<SmartphoneIcon className="size-5 text-foreground" aria-hidden="true" />} title="Residents' phones"
                body="Joined in person by QR. Reports are signed; cell messages are sealed." />
            </div>
            <div className="flex flex-wrap items-center gap-x-7 gap-y-2.5 border-t border-dashed border-border-strong pt-4 text-foreground/75">
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--directorate)]">The Directorate tries</span>
              <span>Sniff the link → <strong className="font-medium text-foreground">sees ciphertext</strong></span>
              <span>Forge an all-clear → <strong className="font-medium text-foreground">refused</strong></span>
              <span>Edit a record → <strong className="font-medium text-foreground">caught at that row</strong></span>
              <span>Cut the link → <strong className="font-medium text-foreground">queued, then delivered</strong></span>
            </div>
          </Card>
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

        <SurfaceSection net={net} q={q} />

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
