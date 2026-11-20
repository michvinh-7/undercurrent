// The "Briefs" tab: all 15 hackathon questions, each with what the network shows about it right
// now and a button that takes you to that view. Statuses are computed from live data, never
// written in by hand:
//   live     the data is here and the map shows it
//   ready    built and waiting for data (try a test alert)
//   planned  needs a piece someone else owns (named), not built yet
//   design   an honest idea, not built; it's in the Devpost's "what it doesn't do"

import { checkinStatus, isLungReport, peopleIn, type MapEvent } from "../adapter";
import { DIRECTORATE_LUNG_CASES, DIRECTORATE_SOURCE, DIRECTORATE_SURFACE_CLAIM } from "../directorate";
import { activeSensorAlerts, outageLedger, readingOf, surfaceReading } from "../sensors";
import type { FeedFilter } from "./Feed";
import type { TestPreset } from "./TestAlerts";

type Status = "live" | "ready" | "planned" | "design";
const STATUS: Record<Status, { label: string; color: string }> = {
  live: { label: "Live", color: "var(--ok)" },
  ready: { label: "Ready", color: "var(--warn)" },
  planned: { label: "Planned", color: "var(--muted)" },
  design: { label: "Design", color: "var(--faint)" },
};

export interface BriefActions {
  /** Go to a level (and an event's pin, if given). */
  goTo: (level: number, e?: MapEvent) => void;
  openFeed: (f: FeedFilter) => void;
  test: (p: TestPreset) => void;
  showWater: () => void;
}

export interface BriefInput {
  events: MapEvent[];
  levels: number[];
  /** The bad-water trace, if two or more reports point somewhere. */
  water: { source: string; reports: number; atRisk: number; level: number } | null;
  forgeriesBlocked: number;
}

interface Brief { n: number; q: string; status: Status; line: string; detail?: React.ReactNode; action?: { label: string; run: () => void } }

export function briefs({ events, levels, water, forgeriesBlocked }: BriefInput, go: BriefActions): Brief[] {
  const sensorAll = levels.flatMap((n) => activeSensorAlerts(events, n));
  const find = (k: string, soon?: boolean) => sensorAll.find((a) => a.kind === k && (soon === undefined || (a.expectedIn !== null) === soon));
  const test = (p: TestPreset, label = "Try a test alert") => ({ label, run: () => go.test(p) });
  const show = (a: { event: MapEvent } | undefined) => a && a.event.level !== null ? { label: "Show me", run: () => go.goTo(a.event.level!, a.event) } : undefined;

  // 1 · blackout or air cut, before it happens
  const warn = find("blackout", true) ?? find("bad_air");
  const b1: Brief = warn
    ? { n: 1, q: "Warn before power or air cuts out", status: "live", line: warn.kind === "blackout" ? `Blackout expected on L${warn.event.level} in about ${warn.expectedIn} min` : `Bad air on L${warn.event.level}${warn.reading ? ` (${warn.reading})` : ""}`, action: show(warn) }
    : { n: 1, q: "Warn before power or air cuts out", status: "ready", line: "Boxes warn before it hits: the map dims the level and counts down. Waiting on the sensors.", action: test("blackout_soon") };

  // 2 · fair shares: the signed record of who goes without
  const ledger = outageLedger(events, levels).filter((r) => r.blackouts + r.badAir + r.flooding + r.heat > 0).sort((a, b) => b.blackouts + b.badAir - (a.blackouts + a.badAir));
  const b2: Brief = {
    n: 2, q: "Share power, water and food fairly", status: ledger.length ? "live" : "ready",
    line: ledger.length ? "Who's going without, from signed sensor alerts the Directorate can't edit" : "Every outage a box reports is signed and counted per level, so unfair cuts can be proven.",
    detail: ledger.length ? (
      <table className="mt-1.5 w-full text-xs">
        <thead><tr className="text-left text-[var(--muted)]"><th className="font-normal">Level</th><th className="font-normal">Blackouts</th><th className="font-normal">Bad air</th><th className="font-normal">Floods</th></tr></thead>
        <tbody>{ledger.map((r) => <tr key={r.level}><td>L{r.level}</td><td className="tabular-nums">{r.blackouts}</td><td className="tabular-nums">{r.badAir}</td><td className="tabular-nums">{r.flooding}</td></tr>)}</tbody>
      </table>
    ) : undefined,
    action: ledger.length ? undefined : test("blackout_now", "Try a blackout"),
  };

  // 3 · heat
  const hot = find("heat");
  const b3: Brief = hot
    ? { n: 3, q: "Keep the deep levels livable as they heat up", status: "live", line: `L${hot.event.level} running hot${hot.reading ? ` (${hot.reading})` : ""}`, action: show(hot) }
    : { n: 3, q: "Keep the deep levels livable as they heat up", status: "ready", line: "Box temperature and fan readings tint the hot blocks. Waiting on the sensors.", action: test("heat") };

  // 4 · bad water
  const b4: Brief = water
    ? { n: 4, q: "Catch bad water before people drink it", status: "live", line: `${water.reports} reports traced to the ${water.source} · ${water.atRisk} buildings get water through it: boil before drinking`, action: { label: "Show me", run: go.showWater } }
    : { n: 4, q: "Catch bad water before people drink it", status: "ready", line: "Two or more bad-water reports trace up the pipes to a likely source, and warn everyone downstream." };

  // 5 · flooding
  const flood = find("flooding");
  const b5: Brief = flood
    ? { n: 5, q: "Keep flooded tunnels safe to move through", status: "live", line: `Flooding on L${flood.event.level}: streets closed and a safe route drawn`, action: show(flood) }
    : { n: 5, q: "Keep flooded tunnels safe to move through", status: "ready", line: "Water on a box's probe closes the nearby streets and draws the safest route.", action: test("flooding") };

  // 7 · organizing without the Directorate's network
  const verified = events.filter((e) => e.verified).length;
  const cells = events.filter((e) => e.severity === "message").length;
  const b7: Brief = {
    n: 7, q: "Organize and call for help without their network", status: "live",
    line: `${verified} of ${events.length} reports verified · ${forgeriesBlocked} forgeries blocked · ${cells} encrypted cell message${cells === 1 ? "" : "s"}`,
    detail: <p className="mt-1 text-xs text-[var(--muted)]">Proof lives on the <a className="underline" href="/dashboard">console</a> (checks, counters, chain) and the <a className="underline" href="/truth">Directorate view</a> (what they see on the wire).</p>,
  };

  // 8 · families
  const people = events.filter((e) => e.event.type === "checkin" || e.event.type === "missing_person");
  const missing = people.filter((e) => e.event.type === "missing_person").length;
  const b8: Brief = {
    n: 8, q: "Reconnect families split across levels", status: people.length ? "live" : "ready",
    line: people.length ? `${people.length - missing} check-ins and ${missing} missing report${missing === 1 ? "" : "s"}, searchable by name across levels` : "Check-ins and missing reports from every level, searchable by name.",
    action: { label: "Find someone", run: () => go.openFeed("people") },
  };

  // 9 · lung sickness vs the Directorate's numbers
  const lungRows = levels.map((n) => ({ n, ours: events.filter((e) => e.level === n && isLungReport(e)).reduce((t, e) => t + peopleIn(e), 0), theirs: DIRECTORATE_LUNG_CASES[n] ?? 0 })).filter((r) => r.ours || r.theirs);
  const worst = [...lungRows].sort((a, b) => b.ours - b.theirs - (a.ours - a.theirs))[0];
  const b9: Brief = {
    n: 9, q: "Track the real lung outbreak", status: lungRows.length ? "live" : "ready",
    line: worst ? `L${worst.n}: residents report ${worst.ours} · the Directorate says ${worst.theirs}` : "Residents' own counts per level, next to the Directorate's.",
    detail: lungRows.length ? (
      <>
        <table className="mt-1.5 w-full text-xs">
          <thead><tr className="text-left text-[var(--muted)]"><th className="font-normal">Level</th><th className="font-normal">Residents report</th><th className="font-normal">Directorate says</th></tr></thead>
          <tbody>{lungRows.map((r) => <tr key={r.n}><td>L{r.n}</td><td className="font-medium tabular-nums">{r.ours}</td><td className="tabular-nums text-[var(--directorate)]">{r.theirs}</td></tr>)}</tbody>
        </table>
        <p className="mt-1 text-[11px] text-[var(--faint)]">{DIRECTORATE_SOURCE}</p>
      </>
    ) : undefined,
    action: worst ? { label: "Show me", run: () => go.goTo(worst.n) } : undefined,
  };

  // 10 · care
  const help = events.filter((e) => checkinStatus(e) === "need_help" || e.severity === "sos").length;
  const sick = events.filter((e) => e.event.type === "case").length;
  const b10: Brief = {
    n: 10, q: "Get care to people who can't reach it", status: help + sick ? "live" : "ready",
    line: help + sick ? `${help} asking for help · ${sick} sickness report${sick === 1 ? "" : "s"} · click any building for the way to the nearest care` : "Click any building for the way to the nearest care, even levels away.",
    action: { label: "Who needs care", run: () => go.openFeed("care") },
  };

  // 13 · the surface
  const surface = surfaceReading(events);
  const b13: Brief = surface
    ? {
      n: 13, q: "Prove whether the surface is safe", status: "live",
      line: `Surface intake: ${readingOf(surface) ?? "reading in"}${typeof (surface.event.payload as { oxygen_pct?: unknown }).oxygen_pct === "number" ? ` · O₂ ${(surface.event.payload as { oxygen_pct: number }).oxygen_pct}%` : ""} · ${surface.test ? "test alert" : surface.verified ? (surface.simulated ? "signed by a simulated box ✓" : "signed by the box ✓") : "not verified"}`,
      detail: <p className="mt-1 text-xs"><span className="text-[var(--directorate)]">Directorate: “{DIRECTORATE_SURFACE_CLAIM}.”</span> A signed reading can't be faked by either side.</p>,
    }
    : { n: 13, q: "Prove whether the surface is safe", status: "ready", line: "A box at the top of the shaft signs its air readings, so the Directorate can't fake them.", action: test("surface", "Try a reading") };


  // 11 · sleep and mood from the daily check-in (each person's latest answer; a level only with 2+ people)
  const sleepByLevel = (() => {
    const latest = new Map<string, MapEvent>();
    for (const e of events) {
      const p = e.event.payload as { sleep_h?: unknown };
      if (e.event.type !== "checkin" || typeof p.sleep_h !== "number") continue;
      const who = e.event.author_pub ?? e.event.author;
      const prev = latest.get(who);
      if (!prev || e.event.created_at > prev.event.created_at) latest.set(who, e);
    }
    const per = new Map<number, number[]>();
    for (const e of latest.values()) if (e.level !== null) per.set(e.level, [...(per.get(e.level) ?? []), (e.event.payload as { sleep_h: number }).sleep_h]);
    return [...per].filter(([, xs]) => xs.length >= 2).map(([n, xs]) => ({ n, avg: xs.reduce((a, b) => a + b, 0) / xs.length })).sort((a, b) => a.avg - b.avg);
  })();
  const b11: Brief = sleepByLevel.length
    ? { n: 11, q: "Track what no sunlight does to people", status: "live", line: `Daily check-ins: ${sleepByLevel.map((x) => `L${x.n} sleeps ${x.avg.toFixed(1)} h`).join(" · ")} (levels with 2+ answers)`, action: { label: "Who checked in", run: () => go.openFeed("people") } }
    : { n: 11, q: "Track what no sunlight does to people", status: "ready", line: "The daily check-in asks hours slept and mood; each level's average shows once 2 or more people answer." };

  // 14 and 15 · going back up: design notes, built on the pieces above, with the live inputs they'd use
  const residents = new Set(events.filter((e) => e.origin === "report" && e.event.type !== "roster").map((e) => e.event.author_pub ?? e.event.author));
  const residentLevels = new Set(events.filter((e) => e.origin === "report" && e.level !== null).map((e) => e.level));
  const b14: Brief = {
    n: 14, q: "Choose suits, domes or outposts for going up", status: "design",
    line: "Design: a Canary box in each trial suit, dome and outpost signs its oxygen, CO₂ and heat; compare how long each stays safe, and the blackout-style forecast flags one heading toward unsafe. First volunteers come from the roster, picked by the cell, not the Directorate. Not built.",
  };
  const b15: Brief = {
    n: 15, q: "Plan the move back up", status: "design",
    line: `Design: the signed census says who and where (${residents.size} residents heard from on ${residentLevels.size} level${residentLevels.size === 1 ? "" : "s"} so far); signed surface readings decide go or no-go in public; outpost beds go on the Have / Need board as space, so the same fair matching decides who goes first, and the roll call checks nobody is left. Not built.`,
  };

  // 6 and 12 · the Have / Need board (type "exchange", hub/app/exchange.py): posts of one kind
  const board = (n: number, q: string, kinds: string[], what: string): Brief => {
    const posts = events.filter((e) => e.event.type === "exchange" && kinds.includes(String((e.event.payload as { category?: unknown }).category)));
    const side = (sd: string) => posts.filter((e) => (e.event.payload as { side?: unknown }).side === sd).length;
    return posts.length
      ? { n, q, status: "live", line: `Have / Need board: ${side("need")} ${what} needed, ${side("have")} offered · the hub pairs each need with the nearest offer`, action: { label: "See the posts", run: () => go.openFeed("all") } }
      : { n, q, status: "ready", line: `Have / Need board: residents post ${what} they need or can spare from their phone; the hub pairs them across levels.` };
  };
  return [
    b1, b2, b3, b4, b5,
    board(6, "Find or share living space", ["space"], "beds or rooms"),
    b7, b8, b9, b10,
    b11,
    board(12, "Grow and share food locally", ["food"], "food or seeds"),
    b13,
    b14,
    b15,
  ];
}

export default function Briefs({ input, actions }: { input: BriefInput; actions: BriefActions }) {
  const list = briefs(input, actions);
  const live = list.filter((b) => b.status === "live").length;
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3.5 shadow-sm">
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="text-sm font-semibold">The 15 questions</h2>
        <span className="ml-auto text-xs text-[var(--muted)]">{live} showing live data</span>
      </div>
      <ol className="space-y-1">
        {list.map((b) => (
          <li key={b.n} className="rounded-lg px-2 py-1.5 hover:bg-[var(--panel-2)]">
            <div className="flex items-start gap-2">
              <span className="mt-px w-5 shrink-0 text-right text-xs font-semibold tabular-nums text-[var(--muted)]">{b.n}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-2">
                  <p className="text-sm font-medium leading-snug">{b.q}</p>
                  <span className="ml-auto mt-0.5 shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide" style={{ color: STATUS[b.status].color, background: `color-mix(in oklab, ${STATUS[b.status].color} 12%, transparent)` }}>
                    {STATUS[b.status].label}
                  </span>
                </div>
                <p className="mt-0.5 text-xs leading-snug text-[var(--muted)]">{b.line}</p>
                {b.detail}
                {b.action && (
                  <button onClick={b.action.run} className="mt-1 rounded-full border border-[var(--border-strong)] px-2 py-px text-[11px] hover:bg-[var(--panel)]">
                    {b.action.label} →
                  </button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
