"use client";

// The live sections of the judges' front door (/overview), shared with the 3-minute presenter
// mode (/pitch). Each section takes `compact`: true shows only its live card, without the
// heading or the "measured" card, so a slide can hold it. Nothing here is made up: counts
// come from useUndercurrent (the same data as the console) and the hubs' own endpoints.

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast, Toaster } from "sonner";
import {
  ArrowLeftRightIcon, ArrowRightIcon, ArrowRightLeftIcon as SwapIcon, BrainCircuitIcon, CloudSunIcon, MegaphoneIcon, MoonIcon, MountainIcon, ZapIcon, CheckIcon, CopyIcon, DropletIcon, LoaderCircleIcon, ServerIcon, SmartphoneIcon,
} from "lucide-react";
import { AppBar, useCarriedQuery } from "@/components/app-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAgreement } from "@/lib/useAgreement";
import { isEncrypted, isSimulated, useUndercurrent, type Undercurrent } from "@/lib/useUndercurrent";
import { RECORDED_FORECAST, RECORDED_ON, RECORDED_POINTS, RECORDED_TRIAGE } from "./recorded";
import RECORDED_POLLS from "./recorded-polls.json";
import { BEATS, FORECAST_RESULTS, RESULTS, TRIAGE_EXAMPLES, TRIAGE_MODEL, TRIAGE_RESULTS, type BeatId } from "./beats";
import { DIRECTORATE_SURFACE_CLAIM } from "../hollow/city/directorate";
import { timeAgo } from "@/lib/format";
import { LivabilityReplay } from "./livability-replay";

export type Tone = "ok" | "warn" | "danger" | "muted";
export const TONE: Record<Tone, string> = { ok: "var(--ok)", warn: "var(--warn)", danger: "var(--danger)", muted: "var(--muted)" };
export interface Proof { tone: Tone; short: string; headline: string; detail: string }

export const REAL_BOX = "canary-34";

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="font-mono text-xs uppercase tracking-[0.14em] text-primary">{children}</p>;
}

export function Dot({ tone }: { tone: Tone }) {
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

export function useProofs(net: Undercurrent): Record<BeatId, Proof> {
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
export function useLiveToasts(net: Undercurrent) {
  const seen = useRef<{ forgeries: number; cut: boolean; intact: boolean | null; box: string | null } | null>(null);
  useEffect(() => {
    if (net.mode !== "live") return;
    // Wait until every hub has answered a poll at least once (or been given up on). Before
    // that, the counts are still filling in (0, then the real total), and announcing that
    // jump would pop "Forgery refused" for old refusals every time the page opens.
    const settled = net.hubs.length > 0 && net.hubs.every((h) => h.hubId !== null || h.misses >= 2);
    if (!settled) return;
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

export function CopyCommand({ text }: { text: string }) {
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

export function FlowNode({ icon, title, body, tone }: { icon: React.ReactNode; title: string; body: string; tone: Tone }) {
  return (
    <div className="flex min-w-0 flex-[1_1_170px] flex-col gap-1.5 rounded-lg border bg-background p-3.5" style={{ borderColor: TONE[tone] }}>
      {icon}
      <span className="font-semibold">{title}</span>
      <span className="text-[13px] text-muted-foreground">{body}</span>
    </div>
  );
}

export function FlowArrow({ label, tone, dashed, back }: { label: string; tone: Tone; dashed?: boolean; back?: boolean }) {
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
export interface Triage {
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
export function TriageSection({ net, compact = false }: { net: Undercurrent; compact?: boolean }) {
  const primary = net.hubs.find((h) => h.role === "primary");
  const [text, setText] = useState(TRIAGE_EXAMPLES[0].text);
  const [result, setResult] = useState<Triage | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const live = net.mode === "live" && !!primary;
  // No hub: the three examples still work, from answers recorded from the hub's model.
  const recorded = !live ? RECORDED_TRIAGE[text.trim()] : undefined;
  const [fromRecording, setFromRecording] = useState(false);

  async function rank(message = text) {
    if (!live && recorded) {
      setResult(recorded);
      setFromRecording(true);
      setState("idle");
      return;
    }
    setFromRecording(false);
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
      {!compact && (
      <div className="flex flex-col gap-1.5">
        <Eyebrow>How the hub decides what&apos;s urgent</Eyebrow>
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">AI reads the panic, code does the math</h2>
        <p className="max-w-[70ch] text-foreground/75">
          On a slow link, the most urgent message has to go first. An AI model running on the hub reads each free-text report and pulls out
          the facts. Plain code then turns those facts into a priority and checks every number against the message, so the model never
          invents one.
        </p>
      </div>
      )}
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
            <Button onClick={() => rank()} disabled={(!live && !recorded) || state === "busy" || !text.trim()}>
              {state === "busy" ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : <BrainCircuitIcon aria-hidden="true" />}
              {state === "busy" ? "Reading it…" : "Rank it"}
            </Button>
            {!live && (
              <span className="text-sm text-muted-foreground">
                {recorded ? `No hub here: the examples show the hub's model's real answers, recorded ${RECORDED_ON}.` : "No hub here: pick an example above, or connect to a hub to try your own text."}
              </span>
            )}
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
              <p className="text-xs text-muted-foreground">Read by: {SOURCE[result.source]}{fromRecording ? ` · recorded ${RECORDED_ON}, no hub here` : ""}</p>
            </div>
          )}
        </Card>
        {!compact && (
        <Card className="min-w-0 flex-[1_1_340px] gap-3 p-6">
          <span className="font-semibold">Measured on 149 held-out messages</span>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-normal"></th>
                  <th className="pb-2 font-normal">AI, offline</th>
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
            AI column: {TRIAGE_MODEL}, the model the hub runs with no internet, 95% intervals below each number. A cloud model
            (Gemini 3.1 Flash Lite, online mirror only) scores 87.9% on urgency. Full table in <code className="font-mono">eval/results/RESULTS.md</code>.
          </p>
        </Card>
        )}
      </div>
    </section>
  );
}

export const SURFACE_BOX = "canary-surface";

/** Question 13: is the surface safe? The Directorate's claim next to the newest signed reading from the box at the top of the shaft. */
export function SurfaceSection({ net, q, compact = false }: { net: Undercurrent; q: string; compact?: boolean }) {
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
      {!compact && (
      <div className="flex flex-col gap-1.5">
        <Eyebrow>Is the surface safe?</Eyebrow>
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Their word against a signed reading</h2>
        <p className="max-w-[70ch] text-foreground/75">
          A box at the top of the shaft measures the surface air and signs every reading with its own key. Hubs refuse anything else, so
          neither the Directorate nor anyone in the Hollow can fake what it says.
        </p>
      </div>
      )}
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

/** One box's forecast, as GET /forecast returns it (hub/app/forecast.py). */
export interface BoxForecast {
  device_id: string;
  level: number;
  hub_id: string;
  readings: number;
  latest_v: number;
  latest_at: string;
  slope_v_per_min: number;
  status: "falling" | "steady" | "below cutoff" | "too few readings";
  eta_s: number | null;
  eta_low_s: number | null;
  eta_high_s: number | null;
  cutoff_v: number;
  simulated: boolean;
}

const mins = (s: number) => (s < 90 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`);

/** Readings as dots, the fitted trend projected forward to the cutoff, the cutoff as a line. */
export function ForecastChart({ points, f }: { points: { t: number; v: number }[]; f: BoxForecast }) {
  const W = 560, H = 180, padL = 44, padR = 16, padT = 14, padB = 26;
  const last = Date.parse(f.latest_at);
  const end = f.status === "falling" && f.eta_s !== null ? last + (f.eta_high_s ?? f.eta_s) * 1000 : last;
  const t0 = Math.min(...points.map((p) => p.t), last), t1 = Math.max(end, last + 1);
  const vs = points.map((p) => p.v);
  const vMax = Math.max(...vs, f.latest_v) + 4, vMin = Math.min(f.cutoff_v - 6, ...vs);
  const X = (t: number) => padL + ((t - t0) / (t1 - t0)) * (W - padL - padR);
  const Y = (v: number) => padT + ((vMax - v) / (vMax - vMin)) * (H - padT - padB);
  const slope = f.slope_v_per_min / 60000; // volts per ms
  const fitAt = (t: number) => f.latest_v + slope * (t - last);
  const cross = f.status === "falling" && f.eta_s !== null ? last + f.eta_s * 1000 : null;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Voltage readings from ${f.device_id} and the forecast trend to ${f.cutoff_v} volts`}>
      {[vMax - 4, f.cutoff_v + (vMax - 4 - f.cutoff_v) / 2, f.cutoff_v].map((v) => (
        <g key={v}>
          <line x1={padL} x2={W - padR} y1={Y(v)} y2={Y(v)} stroke="var(--border)" />
          <text x={padL - 6} y={Y(v) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{Math.round(v)} V</text>
        </g>
      ))}
      <line x1={padL} x2={W - padR} y1={Y(f.cutoff_v)} y2={Y(f.cutoff_v)} stroke="var(--danger)" strokeDasharray="4 4" />
      <text x={W - padR} y={Y(f.cutoff_v) - 6} textAnchor="end" fontSize="11" fill="var(--danger)">equipment drops out</text>
      {f.status === "falling" && cross !== null && (
        <>
          <line x1={X(t0)} y1={Y(fitAt(t0))} x2={X(cross)} y2={Y(f.cutoff_v)} stroke="var(--warn)" strokeWidth="1.5" strokeDasharray="6 4" />
          {f.eta_low_s !== null && f.eta_high_s !== null && (
            <rect x={X(last + f.eta_low_s * 1000)} y={Y(f.cutoff_v) - 5} width={Math.max(2, X(last + f.eta_high_s * 1000) - X(last + f.eta_low_s * 1000))} height="10" rx="5" fill="var(--warn)" fillOpacity="0.25" />
          )}
          <circle cx={X(cross)} cy={Y(f.cutoff_v)} r="5" fill="var(--warn)" />
        </>
      )}
      {points.map((p) => <circle key={p.t} cx={X(p.t)} cy={Y(p.v)} r="3.5" fill="var(--water)" />)}
      <text x={padL} y={H - 6} fontSize="11" fill="var(--muted)">readings</text>
      {cross !== null && <text x={X(cross)} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--warn)">forecast drop-out</text>}
    </svg>
  );
}

/**
 * Poll one of the primary hub's endpoints. `problem` says why there's no data instead of
 * leaving "Loading…" up forever: "old" when the hub answers 404 (it runs code from before
 * that endpoint existed, so restart it), "down" when it doesn't answer at all.
 */
export function useHubPoll<T>(net: Undercurrent, path: string, everyMs: number) {
  const primary = net.hubs.find((h) => h.role === "primary");
  const [data, setData] = useState<T | null>(null);
  const [problem, setProblem] = useState<"old" | "down" | null>(null);
  // No live hub (a hosted copy of the site, or the hubs down): show the hubs' real answers recorded
  // on Nov 20 from the signed simulation, labelled as recorded, instead of an empty box.
  const recorded = net.mode !== "live" ? ((RECORDED_POLLS as Record<string, unknown>)[path] as T | undefined) ?? null : null;
  useEffect(() => {
    if (net.mode !== "live" || !primary) return;
    let stop = false;
    async function poll() {
      try {
        const res = await fetch(`${primary!.url}${path}`, { cache: "no-store", signal: AbortSignal.timeout(3000) });
        if (stop) return;
        if (res.ok) {
          setData((await res.json()) as T);
          setProblem(null);
        } else setProblem(res.status === 404 ? "old" : "down");
      } catch {
        if (!stop) setProblem("down");
      }
    }
    poll();
    const t = setInterval(poll, everyMs);
    return () => { stop = true; clearInterval(t); };
  }, [net.mode, primary?.url, path, everyMs]); // eslint-disable-line react-hooks/exhaustive-deps
  return recorded ? { data: recorded, problem: null, recorded: true } : { data, problem, recorded: false };
}

/** The label on a section showing recorded answers instead of a live hub. */
export function RecordedNote() {
  return (
    <p className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
      No hub here, so this shows the hubs&apos; real answers recorded {RECORDED_ON} from the signed simulation. Connect to a hub to see it live.
    </p>
  );
}

export function HubProblem({ problem, path }: { problem: "old" | "down"; path: string }) {
  return problem === "old" ? (
    <span className="text-[var(--warn)]">
      This hub is running older code without <code className="font-mono text-sm">{path}</code>. Restart it on the latest code:{" "}
      <code className="font-mono text-sm">demo_hubs.py down</code> then <code className="font-mono text-sm">up</code> (keeps the data).
    </span>
  ) : (
    <span className="text-[var(--warn)]">The hub isn&apos;t answering <code className="font-mono text-sm">{path}</code> right now. Retrying…</span>
  );
}

/** Question 1: warn before the power cuts out. The hub's forecast from a relay box's voltage readings. */
export function ForecastSection({ net, compact = false }: { net: Undercurrent; compact?: boolean }) {
  const primary = net.hubs.find((h) => h.role === "primary");
  const fc = useHubPoll<{ boxes: BoxForecast[] }>(net, "/forecast", 4000);
  // No hub: show a forecast recorded from the hubs, labelled, instead of an empty box.
  const recorded = net.mode !== "live";
  const boxes = recorded ? [RECORDED_FORECAST] : fc.data?.boxes ?? null;

  const f = boxes?.find((b) => b.status === "falling") ?? boxes?.[0] ?? null;
  const points = recorded
    ? RECORDED_POINTS.map((p) => ({ t: Date.parse(p.t), v: p.v }))
    : f
    ? net.events
        .filter((e) => e.device_id === f.device_id && (e.payload as { reading?: { unit?: string } }).reading?.unit === "V")
        .map((e) => ({ t: Date.parse(e.created_at), v: Number((e.payload as { reading: { value: number } }).reading.value) }))
        .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v))
        .sort((a, b) => a.t - b.t)
    : [];
  const tone = !f ? "var(--muted)" : f.status === "falling" ? "var(--warn)" : f.status === "below cutoff" ? "var(--danger)" : "var(--ok)";
  const headline = !f
    ? null
    : f.status === "falling" && f.eta_s !== null
      ? `L${f.level} power drops out in about ${mins(f.eta_s)}`
      : f.status === "below cutoff"
        ? `L${f.level} supply is below ${f.cutoff_v} V now`
        : f.status === "steady"
          ? `L${f.level} supply steady at ${Math.round(f.latest_v)} V`
          : `L${f.level}: waiting for more readings`;

  return (
    <section className="flex flex-col gap-5">
      {!compact && (
      <div className="flex flex-col gap-1.5">
        <Eyebrow>Warn before the power cuts out</Eyebrow>
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">The hub predicts the blackout, not just reports it</h2>
        <p className="max-w-[70ch] text-foreground/75">
          A box at a power relay reports its voltage. When the supply is failing it sags before it drops out, so the hub fits a straight
          line through the last 8 signed readings and works out when it reaches the 180 V point where equipment stops. It only warns when
          the fall is clear of the noise, and gives a range, not one confident number.
        </p>
      </div>
      )}
      <div className="flex flex-wrap items-start gap-4">
        <Card className="min-w-0 flex-[999_1_480px] gap-3 p-6" style={{ borderColor: f ? tone : "var(--border)" }}>
          <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em]" style={{ color: tone }}>
            <ZapIcon className="size-4" aria-hidden="true" /> {recorded ? `Recorded forecast · ${RECORDED_ON}` : "Live forecast"}
          </span>
          {recorded && f && (
            <p className="text-sm text-muted-foreground">
              No hub here, so this is a real forecast recorded from the hubs during a simulation run. The simulation plays a night in a
              minute, so its times are short.
            </p>
          )}
          {f ? (
            <>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1" aria-live="polite">
                <span className="text-2xl font-semibold">{headline}</span>
                {f.status === "falling" && f.eta_low_s !== null && f.eta_high_s !== null && (
                  <span className="font-mono text-sm text-muted-foreground">range {mins(f.eta_low_s)} to {mins(f.eta_high_s)}</span>
                )}
              </div>
              {points.length >= 2 && <ForecastChart points={points} f={f} />}
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline">{f.device_id}</Badge>
                {f.simulated && <Badge variant="outline" className="border-[var(--sim)] text-[var(--sim)]">Simulated</Badge>}
                <span className="font-mono text-xs text-muted-foreground">
                  {Math.round(f.latest_v)} V now · {f.slope_v_per_min.toFixed(1)} V/min · {f.readings} readings · {f.hub_id}
                </span>
              </div>
            </>
          ) : (
            <p className="text-muted-foreground">
              {net.mode === "live"
                ? fc.problem ? <HubProblem problem={fc.problem} path="/forecast" /> : !boxes ? "Loading the forecast…" : <>No box is reporting voltage yet. The simulation&apos;s L12 relay starts within seconds of <code className="font-mono text-sm">sim/simulate.py run</code>.</>
                : "Connect to a hub to see the live forecast."}
            </p>
          )}
        </Card>
        {!compact && (
        <Card className="min-w-0 flex-[1_1_340px] gap-3 p-6">
          <span className="font-semibold">Backtested on 1,000 voltage sags</span>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-normal"></th>
                  <th className="pb-2 font-normal">Forecast</th>
                  <th className="pb-2 font-normal">Last 2 readings</th>
                </tr>
              </thead>
              <tbody>
                {FORECAST_RESULTS.map((r) => (
                  <tr key={r.label} className="border-t border-border">
                    <td className="py-2 pr-3">{r.label}</td>
                    <td className="py-2 pr-3 font-mono tabular-nums">{r.forecast}</td>
                    <td className="py-2 font-mono tabular-nums text-muted-foreground">{r.baseline}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Synthetic supplies with a known drop-out time, a reading every 5 minutes, plus 1,000 steady ones for false alarms. Medians;
            95% intervals in <code className="font-mono">eval/results/RESULTS.md</code>.
          </p>
        </Card>
        )}
      </div>
    </section>
  );
}

interface BoardPost { id: string; side: "have" | "need"; category: string; item: string; quantity: number | null; level: number; waiting_s: number; simulated: boolean; signed: boolean; matched: boolean }
interface BoardMatch { need_id: string; have_id: string; category: string; need_level: number; have_level: number; levels_apart: number; need_item: string; have_item: string }
interface BoardView { needs: BoardPost[]; haves: BoardPost[]; matches: BoardMatch[]; unmet: string[]; closed: number }

const CATEGORY_TONE: Record<string, string> = { medicine: "var(--danger)", water: "var(--water)", food: "var(--ok)", power: "var(--warn)", space: "var(--accent)", other: "var(--muted)" };

/** Questions 2, 6, 10 and 12: the Have / Need board, live from the primary hub (GET /exchange). */
export function ExchangeSection({ net, compact = false }: { net: Undercurrent; compact?: boolean }) {
  const primary = net.hubs.find((h) => h.role === "primary");
  const board = useHubPoll<BoardView>(net, "/exchange", 4000);
  const b = board.data;

  const unmet = b ? b.needs.filter((n) => !n.matched) : [];
  const simulated = b ? [...b.needs, ...b.haves].some((p) => p.simulated) : false;
  return (
    <section className="flex flex-col gap-5">
      {board.recorded && <RecordedNote />}
      {!compact && (
      <div className="flex flex-col gap-1.5">
        <Eyebrow>Share what&apos;s left</Eyebrow>
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">A Have / Need board the Directorate can&apos;t ration</h2>
        <p className="max-w-[70ch] text-foreground/75">
          Residents post what they can spare and what they need: a bed, food or seeds, water, medicine, hours of power. Every post is
          signed and synced like an alert. The hub pairs each need with the nearest offer of the same kind, medicine and water first, then
          whoever has waited longest, so the deep levels aren&apos;t always last. Only the person who posted can mark it done.
        </p>
      </div>
      )}
      <Card className="gap-4 p-6">
        {!b ? (
          <p className="text-muted-foreground">
            {net.mode !== "live" ? "Connect to a hub to see the live board." : board.problem ? <HubProblem problem={board.problem} path="/exchange" /> : "Loading the board…"}
          </p>
        ) : b.needs.length + b.haves.length === 0 ? (
          <p className="text-muted-foreground">
            Nothing posted yet. Post from a phone (<code className="font-mono text-sm">/exchange</code>), or run the simulation, which posts
            7 simulated needs and offers.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-sm">
              <span><span className="text-[var(--warn)]">{b.needs.length}</span> needs</span>
              <span><span className="text-[var(--ok)]">{b.haves.length}</span> offers</span>
              <span><span className="text-primary">{b.matches.length}</span> matched</span>
              <span>{unmet.length} still waiting</span>
              {b.closed > 0 && <span className="text-muted-foreground">{b.closed} done</span>}
              {simulated && <Badge variant="outline" className="border-[var(--sim)] text-[var(--sim)]">Includes simulated posts</Badge>}
            </div>
            <ul className="flex flex-col gap-2">
              {b.matches.map((m) => (
                <li key={m.need_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-background px-4 py-3">
                  <span className="rounded-full px-2 py-0.5 font-mono text-xs" style={{ color: CATEGORY_TONE[m.category] ?? "var(--muted)", border: `1px solid ${CATEGORY_TONE[m.category] ?? "var(--border)"}` }}>{m.category}</span>
                  <span className="min-w-0"><span className="text-[var(--warn)]">L{m.need_level} needs</span> {m.need_item}</span>
                  <SwapIcon className="size-4 shrink-0 text-muted-foreground" aria-label="matched with" />
                  <span className="min-w-0"><span className="text-[var(--ok)]">L{m.have_level} has</span> {m.have_item}</span>
                  <span className="ml-auto font-mono text-xs text-muted-foreground">{m.levels_apart} level{m.levels_apart === 1 ? "" : "s"} apart</span>
                </li>
              ))}
              {unmet.map((n) => (
                <li key={n.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-dashed border-border-strong px-4 py-3">
                  <span className="rounded-full px-2 py-0.5 font-mono text-xs" style={{ color: CATEGORY_TONE[n.category] ?? "var(--muted)", border: `1px solid ${CATEGORY_TONE[n.category] ?? "var(--border)"}` }}>{n.category}</span>
                  <span className="min-w-0"><span className="text-[var(--warn)]">L{n.level} needs</span> {n.item}</span>
                  <span className="ml-auto text-xs text-muted-foreground">no offer yet · waiting {Math.max(1, Math.round(n.waiting_s / 60))} min</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </section>
  );
}

interface WellbeingLevel { level: number; people: number; hidden?: string; sleep_avg_h?: number; short_sleep_share?: number; mood_avg?: number; low_mood_share?: number }
interface WellbeingView { window_h: number; min_people: number; levels: WellbeingLevel[]; heard_from: number; known: number; unaccounted: { author: string; level: number; last_heard_h: number }[] }

export function Bar({ value, max, color, label }: { value: number; max: number; color: string; label: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-accent" role="img" aria-label={label}>
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, (value / max) * 100)}%`, background: color }} />
      </div>
      <span className="w-14 shrink-0 text-right font-mono text-sm tabular-nums">{label}</span>
    </div>
  );
}

/** Question 11 (sleep and mood underground) and question 8 (the roll call), live from GET /wellbeing. */
export function WellbeingSection({ net, compact = false }: { net: Undercurrent; compact?: boolean }) {
  const primary = net.hubs.find((h) => h.role === "primary");
  const wb = useHubPoll<WellbeingView>(net, "/wellbeing", 5000);
  const w = wb.data;

  const shown = w?.levels.filter((l) => !l.hidden) ?? [];
  const deep = shown.filter((l) => l.level >= 31 && l.sleep_avg_h !== undefined);
  const upper = shown.filter((l) => l.level < 31 && l.sleep_avg_h !== undefined);
  const avg = (ls: WellbeingLevel[]) => ls.reduce((t, l) => t + (l.sleep_avg_h ?? 0), 0) / ls.length;
  const gap = deep.length && upper.length ? avg(upper) - avg(deep) : null;

  return (
    <section className="flex flex-col gap-5">
      {wb.recorded && <RecordedNote />}
      {!compact && (
      <div className="flex flex-col gap-1.5">
        <Eyebrow>What living underground does to people</Eyebrow>
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {gap !== null && gap > 0.5 ? `The deep levels sleep ${gap.toFixed(1)} hours less` : "Sleep and mood, level by level"}
        </h2>
        <p className="max-w-[70ch] text-foreground/75">
          The daily check-in asks two optional questions: hours slept and mood from 1 to 5. Each person&apos;s latest answer counts once, and
          a level&apos;s average only shows once at least {w?.min_people ?? 2} people have answered, so nobody can be singled out. The same
          check-ins give a roll call: who has been heard from today, and who hasn&apos;t.
        </p>
      </div>
      )}
      <Card className="gap-4 p-6">
        {!w ? (
          <p className="text-muted-foreground">{net.mode !== "live" ? "Connect to a hub to see sleep and mood." : wb.problem ? <HubProblem problem={wb.problem} path="/wellbeing" /> : "Loading…"}</p>
        ) : w.levels.length === 0 ? (
          <p className="text-muted-foreground">No sleep or mood answers today yet. Check in from a phone, or run the simulation.</p>
        ) : (
          <>
            <div className="hidden grid-cols-[4rem_1fr_1fr_6rem] gap-4 text-xs text-muted-foreground sm:grid">
              <span>Level</span><span>Hours slept (avg)</span><span>Mood, 1 to 5 (avg)</span><span className="text-right">Low mood</span>
            </div>
            <ul className="flex flex-col gap-3">
              {w.levels.map((l) => (
                <li key={l.level} className="grid grid-cols-[4rem_1fr] items-center gap-x-4 gap-y-2 sm:grid-cols-[4rem_1fr_1fr_6rem]">
                  <span className="font-mono text-sm">
                    L{l.level}
                    <span className="block text-xs text-muted-foreground">{l.people} {l.people === 1 ? "person" : "people"}</span>
                  </span>
                  {l.hidden ? (
                    <span className="text-sm text-muted-foreground sm:col-span-3">Hidden: {l.hidden}</span>
                  ) : (
                    <>
                      {l.sleep_avg_h !== undefined ? <Bar value={l.sleep_avg_h} max={9} color={l.sleep_avg_h < 6 ? "var(--warn)" : "var(--ok)"} label={`${l.sleep_avg_h} h`} /> : <span className="text-sm text-muted-foreground">–</span>}
                      {l.mood_avg !== undefined ? <Bar value={l.mood_avg} max={5} color={l.mood_avg <= 2 ? "var(--danger)" : l.mood_avg < 3.5 ? "var(--warn)" : "var(--ok)"} label={`${l.mood_avg} / 5`} /> : <span className="text-sm text-muted-foreground">–</span>}
                      <span className="col-start-2 font-mono text-sm tabular-nums text-muted-foreground sm:col-start-auto sm:text-right">
                        {l.low_mood_share !== undefined ? `${Math.round(l.low_mood_share * 100)}%` : "–"}
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
        {w && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-4 text-sm">
            <MoonIcon className="size-4 text-primary" aria-hidden="true" />
            <span>
              Roll call: <strong className="font-semibold">{w.heard_from}</strong> of {w.known} residents heard from in the last {w.window_h} h.
            </span>
            {w.unaccounted.length > 0 ? (
              <span className="text-[var(--warn)]">
                Not heard from: {w.unaccounted.slice(0, 4).map((u) => `${u.author} (L${u.level}, ${Math.round(u.last_heard_h)} h)`).join(", ")}
                {w.unaccounted.length > 4 ? ` and ${w.unaccounted.length - 4} more` : ""}
              </span>
            ) : (
              <span className="text-muted-foreground">Everyone heard from this week has checked in today.</span>
            )}
          </div>
        )}
      </Card>
    </section>
  );
}

interface LivDim { score: number; why: string; events: string[]; from: string[] }
interface LivLevel { level: number; score: number; band: "livable" | "strained" | "unsafe"; capped: boolean; limited_by: string; limited_why: string; coverage: number; of: number; dimensions: Record<string, LivDim> }
interface LivView { window_h: number; weights: Record<string, number>; levels: LivLevel[]; ignored_unsigned: number }

const LIV_DIMS: { key: string; label: string }[] = [
  { key: "flooding", label: "Flooding" }, { key: "water", label: "Water" }, { key: "air", label: "Air" }, { key: "heat", label: "Heat" },
  { key: "power", label: "Power" }, { key: "health", label: "Health" }, { key: "food", label: "Food" }, { key: "needs", label: "Needs" },
  { key: "people", label: "People" },
];
const BAND_COLOR = { livable: "var(--ok)", strained: "var(--warn)", unsafe: "var(--danger)" } as const;
const scoreColor = (n: number) => (n >= 80 ? BAND_COLOR.livable : n >= 50 ? BAND_COLOR.strained : BAND_COLOR.unsafe);
const levelName = (n: number) => (n === 1 ? "Surface" : `L${n}`);

/** Question 3: keep every level livable. One score per level from GET /livability, each number traced to signed events. */
export function LivabilitySection({ net, compact = false }: { net: Undercurrent; compact?: boolean }) {
  const poll = useHubPoll<LivView>(net, "/livability", 5000);
  const v = poll.data;
  const worst = v?.levels[0];

  return (
    <section className="flex flex-col gap-5">
      {poll.recorded && <RecordedNote />}
      {!compact && (
      <div className="flex flex-col gap-1.5">
        <Eyebrow>Keep every level livable</Eyebrow>
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {worst && worst.band !== "livable" ? `${levelName(worst.level)} is ${worst.band}: ${worst.limited_why}` : "The Livability Index, level by level"}
        </h2>
        <p className="max-w-[70ch] text-foreground/75">
          One score from 0 to 100 per level, built only from signed events: the boxes&apos; probes, air, heat and voltage readings, the
          blackout forecast, illness reports, days of food at home, unmet Have / Need requests, and sleep and mood. Plain rules, no model. A dimension with no data
          says so instead of counting as fine, and one unsafe dimension makes the whole level unsafe. Every number links back to the events behind it.
        </p>
      </div>
      )}
      <Card className="gap-4 p-6">
        {!v ? (
          <p className="text-muted-foreground">{net.mode !== "live" ? "Connect to a hub to see the Livability Index." : poll.problem ? <HubProblem problem={poll.problem} path="/livability" /> : "Loading…"}</p>
        ) : v.levels.length === 0 ? (
          <p className="text-muted-foreground">No signed readings or reports in the last {v.window_h} h yet. Run the simulation, or report from a phone.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {v.levels.map((l) => (
              <li key={l.level} className="py-3 first:pt-0 last:pb-0">
                <details className="group">
                  <summary className="grid cursor-pointer list-none grid-cols-[4.5rem_3.5rem_1fr] items-center gap-x-4 gap-y-2 sm:grid-cols-[4.5rem_3.5rem_1fr_auto]">
                    <span className="font-mono text-sm">
                      {levelName(l.level)}
                      <span className="block text-xs text-muted-foreground">{l.coverage} of {l.of} measured</span>
                    </span>
                    <span className="font-mono text-2xl font-semibold tabular-nums" style={{ color: BAND_COLOR[l.band] }}>{l.score}</span>
                    <span className="min-w-0 text-sm">
                      <span className="font-medium" style={{ color: BAND_COLOR[l.band] }}>{l.band}</span>
                      <span className="text-muted-foreground"> · held down by {l.limited_by}: {l.limited_why}{l.capped ? " (one unsafe dimension caps the level)" : ""}</span>
                    </span>
                    <span className="col-span-3 flex flex-wrap gap-1 sm:col-span-1 sm:justify-end">
                      {LIV_DIMS.map((d) => {
                        const x = l.dimensions[d.key];
                        return (
                          <span key={d.key} title={x ? `${d.label}: ${x.score} · ${x.why}` : `${d.label}: no data`}
                            className="inline-flex h-7 min-w-11 flex-col items-center justify-center rounded border border-border px-1 text-[10px] leading-none">
                            <span className="text-muted-foreground">{d.label}</span>
                            <span className="font-mono font-semibold tabular-nums" style={{ color: x ? scoreColor(x.score) : "var(--muted)" }}>{x ? x.score : "–"}</span>
                          </span>
                        );
                      })}
                    </span>
                  </summary>
                  <ul className="mt-3 flex flex-col gap-1 pl-[5.5rem] text-sm text-muted-foreground">
                    {LIV_DIMS.filter((d) => l.dimensions[d.key]).map((d) => {
                      const x = l.dimensions[d.key];
                      return (
                        <li key={d.key}>
                          <span className="font-mono tabular-nums" style={{ color: scoreColor(x.score) }}>{x.score}</span> {d.label}: {x.why}
                          <span className="text-xs"> · from {x.from.join(", ")}{x.events.length ? ` · ${x.events.length} signed event${x.events.length === 1 ? "" : "s"} (${x.events.map((i) => i.slice(0, 8)).join(", ")})` : ""}</span>
                        </li>
                      );
                    })}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        )}
        {v && (
          <p className="border-t border-border pt-4 text-xs text-muted-foreground">
            Last {v.window_h} h of signed events. Click a level for each number&apos;s source. 80+ livable, 50 to 79 strained, under 50 unsafe.
            {v.ignored_unsigned > 0 ? ` ${v.ignored_unsigned} unsigned events left out.` : ""} Rules in <code className="font-mono">hub/app/livability.py</code>.
          </p>
        )}
      </Card>
      {!compact && <LivabilityReplay />}
    </section>
  );
}

/** The index as one row of level tiles, for a slide: score, band and what holds each level down. */
export function LivabilityStrip({ net }: { net: Undercurrent }) {
  const poll = useHubPoll<LivView>(net, "/livability", 5000);
  const v = poll.data;
  if (!v || v.levels.length === 0) {
    return (
      <Card className="p-4 text-sm text-muted-foreground">
        Livability Index: {net.mode !== "live" ? "connect to a hub." : poll.problem ? <HubProblem problem={poll.problem} path="/livability" /> : v ? "no signed readings yet." : "Loading…"}
      </Card>
    );
  }
  return (
    <Card className="gap-2 p-4">
      <span className="caption">Livability Index · one score per level, from signed readings only</span>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {v.levels.slice(0, 4).map((l) => (
          <div key={l.level} className="flex min-w-0 items-center gap-3 rounded-md border border-border px-3 py-2" style={{ borderLeft: `4px solid ${BAND_COLOR[l.band]}` }}>
            <span className="font-mono text-2xl font-semibold tabular-nums" style={{ color: BAND_COLOR[l.band] }}>{l.score}</span>
            <span className="min-w-0 text-sm leading-tight">
              <span className="font-mono">{levelName(l.level)}</span> <span style={{ color: BAND_COLOR[l.band] }}>{l.band}</span>
              <span className="block truncate text-muted-foreground" title={l.limited_why}>{l.band === "livable" ? `${l.coverage} of ${l.of} measured` : l.limited_why}</span>
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Questions 14 and 15: going back up. Design notes, labelled as not built, showing which live pieces they'd stand on. */
export function SurfaceReturnSection({ net }: { net: Undercurrent }) {
  const people = net.events.filter((e) => e.source !== "sensor" && e.type !== "roster");
  const residents = new Set(people.map((e) => e.author_pub ?? e.author)).size;
  const levels = new Set(people.map((e) => e.level)).size;
  const surface = net.events.filter((e) => e.device_id === SURFACE_BOX).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const o2 = surface && typeof (surface.payload as { oxygen_pct?: unknown }).oxygen_pct === "number" ? `${(surface.payload as { oxygen_pct: number }).oxygen_pct}% oxygen` : null;
  const spaceOffers = net.events.filter((e) => e.type === "exchange" && (e.payload as { side?: unknown; category?: unknown }).side === "have" && (e.payload as { category?: unknown }).category === "space").length;

  const cards = [
    {
      q: "14", title: "Which works: suits, domes or outposts?",
      steps: [
        "Put a Canary box inside every trial suit, dome and outpost. It signs oxygen, CO₂ and heat, so no side can fake how a trial went.",
        "Compare them on the record: hours each stayed in the safe range, and how often it alarmed.",
        "Run the blackout forecast on their air: a dome whose oxygen is sliding gets flagged before it's unsafe.",
        "The first volunteers come from the roster, picked by their cell. Their daily check-ins show who is fit to go.",
      ],
      uses: ["signed boxes", "the forecast", "the roster", "check-ins"],
    },
    {
      q: "15", title: "Plan the move for hundreds of millions",
      steps: [
        "The signed census says who and where: everyone heard from, per level, that nobody can inflate or erase.",
        "Go or no-go comes from signed surface readings, published to every hub at once.",
        "Each outpost posts its beds on the Have / Need board as space, and the same fair matching decides who goes first.",
        "The roll call checks nobody is left behind on a level that's emptying.",
      ],
      uses: ["census", "surface box", "Have / Need board", "roll call"],
    },
  ];

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Eyebrow>Going back up</Eyebrow>
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">The same network carries the move to the surface</h2>
        <p className="max-w-[70ch] text-foreground/75">
          We haven&apos;t built these two. They are designs, and each step uses a piece that already runs today. The live inputs they would
          start from are below.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {cards.map((c) => (
          <Card key={c.q} className="gap-3 p-6">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">Question {c.q}</span>
              <Badge variant="outline" className="border-border-strong text-muted-foreground">Design · not built</Badge>
            </div>
            <span className="text-lg font-semibold">{c.title}</span>
            <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-foreground/85">
              {c.steps.map((st) => <li key={st}>{st}</li>)}
            </ol>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {c.uses.map((u) => <Badge key={u} variant="secondary">{u}</Badge>)}
            </div>
          </Card>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-dashed border-border-strong px-4 py-3 text-sm">
        <MountainIcon className="size-4 text-primary" aria-hidden="true" />
        <span>Starting from, live: <strong className="font-semibold">{residents}</strong> residents heard from on {levels} level{levels === 1 ? "" : "s"}</span>
        <span>surface: {o2 ? <strong className="font-semibold">{o2}, signed</strong> : "no reading yet"}</span>
        <span>{spaceOffers} space offer{spaceOffers === 1 ? "" : "s"} on the board</span>
      </div>
    </section>
  );
}


/** How one alert travels: box, hub L34, sync, hub L12, phones, each node lit from live state. */
export function HowItWorks({ net }: { net: Undercurrent }) {
  const primary = net.hubs.find((h) => h.role === "primary");
  const agreement = useAgreement(primary?.url ?? null, net.mode === "live" && net.hubs.length > 1);
  const cut = !!net.sendingHub?.link?.cut;
  const hubsUp = net.hubs.length > 0 && net.hubs.every((h) => h.online);
  const boxSeen = net.events.some((e) => e.device_id === REAL_BOX);
  const syncTone: Tone = cut ? "warn" : agreement.agrees === true ? "ok" : agreement.agrees === false ? "warn" : "muted";
  return (
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
  );
}
