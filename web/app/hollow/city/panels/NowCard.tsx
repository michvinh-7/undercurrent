// Left column: "what's happening on this level". The headline story, anything else going on,
// then the level's numbers.

import { checkinStatus, isLungReport, peopleIn, pinOf, summarize, type MapEvent } from "../adapter";
import { levelOf, type CityWorld, type solveWater } from "../model";
import type { Story } from "../narrate";
import { DIRECTORATE_LUNG_CASES } from "../directorate";
import { SEVERITY_COLOR, type HubView } from "../scene/CityScene";
import { Fact, SimTag } from "./ui";

const TONE: Record<Story["tone"], { bar: string; label: string }> = {
  calm: { bar: "var(--ok)", label: "All clear" },
  caution: { bar: "var(--warn)", label: "Heads up" },
  alert: { bar: "var(--danger)", label: "Alert" },
  sim: { bar: "var(--sim)", label: "Simulation" },
};

/** The left column: the headline for this level, anything else going on, then the level's numbers. */
export function NowCard({ story, level, name, flood, spread, setSpread, children }: {
  story: Story; level: number; name: string; flood: boolean; spread: boolean; setSpread: (b: boolean) => void; children: React.ReactNode;
}) {
  const t = TONE[story.tone];
  return (
    <section className="relative overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-sm">
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: t.bar }} />
      <div className="px-4 pb-3 pt-3">
        <div className="flex items-center gap-2">
          <p className="min-w-0 truncate text-xs text-[var(--muted)]">Now on <b className="font-semibold text-[var(--foreground)]">L{level}</b> · {name}</p>
          <span className="ml-auto shrink-0 rounded-full px-2 py-px text-[10px] font-semibold uppercase tracking-wide" style={{ color: t.bar, background: `color-mix(in oklab, ${t.bar} 12%, transparent)` }}>{t.label}</span>
        </div>
        <div key={story.title} role="status" aria-live="polite" className="bubble-in">
          <h2 className="mt-2 text-base font-semibold leading-snug">{story.title}</h2>
          {story.lines.map((l) => <p key={l} className="mt-1 text-[13px] leading-snug text-[var(--muted)]">{l}</p>)}
          {flood && (
            <button onClick={() => setSpread(!spread)} className="mt-2.5 rounded-full border border-[var(--border-strong)] px-2.5 py-0.5 text-xs hover:bg-[var(--panel-2)]">
              {spread ? "Back to the reading" : "What if it keeps rising?"}
            </button>
          )}
        </div>
      </div>
      {story.also && (
        <div className="border-t border-[var(--border)] px-4 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Also happening</p>
          <ul className="mt-1 space-y-0.5">{story.also.map((a) => <li key={a} className="text-[13px] leading-snug">· {a}</li>)}</ul>
        </div>
      )}
      <div className="border-t border-[var(--border)] px-4 py-2.5">
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Level status</p>
        {children}
      </div>
      <p className="border-t border-[var(--border)] px-4 py-2 text-[11px] leading-snug text-[var(--faint)]">{story.source}</p>
    </section>
  );
}

function levelFacts(world: CityWorld, n: number, events: MapEvent[], water: ReturnType<typeof solveWater>) {
  const l = levelOf(world, n)!;
  const here = events.filter((e) => e.level === n);
  const dry = l.buildings.filter((b) => water.dry.has(b.id));
  return { l, here, dry, served: l.buildings.filter((b) => b.use !== "pumphouse").length };
}

export function LevelStatus({ world, level, events, water, hubs, sim }: {
  world: CityWorld; level: number; events: MapEvent[]; water: ReturnType<typeof solveWater>; hubs: HubView[]; sim: { label: string } | null;
}) {
  const { here, dry, served } = levelFacts(world, level, events, water);
  const pinned = here.filter((e) => pinOf(e));
  const hub = hubs.find((h) => h.level === level);
  const other = hubs.find((h) => h.level !== level);
  const checks = here.map(checkinStatus).filter(Boolean);
  const help = checks.filter((x) => x === "need_help").length;
  const lungs = here.filter(isLungReport);
  return (
    <>
      <ul className="space-y-1.5 text-sm">
        <Fact color={dry.length ? "var(--warn)" : "var(--ok)"}>
          {dry.length ? <>{dry.length} of {served} buildings without water <SimTag /></> : <>Water reaching all {served} buildings</>}
        </Fact>
        {hub && other && (
          <Fact color={!hub.online ? "var(--faint)" : hub.cut ? "var(--danger)" : "var(--ok)"}>
            {!hub.online ? `Hub ${level} offline` : hub.cut ? `Link to L${other.level} cut${hub.queued ? ` · ${hub.queued} waiting to send` : ""}` : `Hub linked to L${other.level}`}
          </Fact>
        )}
        <Fact color={here.length ? SEVERITY_COLOR[summarize(events, level).worst ?? "info"] : "var(--ok)"}>
          {here.length ? <>{here.length} report{here.length === 1 ? "" : "s"}{pinned.length ? `, ${pinned.length} at a sensor` : ""}</> : "No reports from this level"}
        </Fact>
        {checks.length > 0 && <Fact color={help ? "var(--danger)" : "var(--ok)"}>Check-ins: {checks.length - help} safe{help ? `, ${help} asking for help` : ""}</Fact>}
        {lungs.length > 0 && (
          <Fact color="var(--warn)">
            {lungs.reduce((t, e) => t + peopleIn(e), 0)} people coughing or short of breath
            <span className="block text-xs text-[var(--directorate)]">Directorate says {DIRECTORATE_LUNG_CASES[level] ?? 0} (simulated bulletin)</span>
          </Fact>
        )}
      </ul>
      {sim && dry.length > 0 && <p className="mt-2 text-xs text-[var(--muted)]">Because: {sim.label} (simulated).</p>}
    </>
  );
}
