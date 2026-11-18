// The "Feed" tab: everything the hubs received, newest first, repeats folded together.

import type { MapEvent } from "../adapter";
import { pinTitle, SEVERITY_COLOR } from "../scene/CityScene";
import { Card } from "./ui";

/** Back-to-back reports with the same title from the same level fold into one row with a count. */
function groupRuns(events: MapEvent[]): { e: MapEvent; n: number; allVerified: boolean }[] {
  const out: { e: MapEvent; n: number; allVerified: boolean }[] = [];
  for (const e of events) {
    const last = out[out.length - 1];
    if (last && last.e.level === e.level && pinTitle(last.e) === pinTitle(e)) { last.n++; last.allVerified &&= e.verified; }
    else out.push({ e, n: 1, allVerified: e.verified });
  }
  return out;
}

export default function Feed({ events, fresh, demo, onPick, onDemoAlert }: { events: MapEvent[]; fresh: ReadonlySet<string>; demo: boolean; onPick: (e: MapEvent) => void; onDemoAlert: () => void }) {
  const rows = groupRuns(events.slice(0, 60)).map((r) => ({ ...r, fresh: fresh.has(r.e.id) }));
  return (
    <Card title="Latest from the hubs" right={demo ? <button onClick={onDemoAlert} className="text-xs text-[var(--muted)] underline">+ demo sensor alert</button> : <span className="text-xs text-[var(--faint)]">{events.length}</span>}>
      {events.length === 0 && <p className="text-sm text-[var(--muted)]">Nothing yet. New reports appear here as the hubs receive them.</p>}
      <ul className="-mx-1 space-y-0.5">
        {rows.map(({ e, n, fresh: isNew, allVerified }) => (
          <li key={e.id}>
            <button onClick={() => onPick(e)} className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-sm hover:bg-[var(--panel-2)] ${isNew ? "bg-[color-mix(in_oklab,var(--accent)_8%,transparent)]" : ""}`}>
              <span className="size-2 shrink-0 rounded-full" style={{ background: SEVERITY_COLOR[e.severity], opacity: e.verified ? 1 : 0.45 }} />
              <span className="w-8 shrink-0 text-xs tabular-nums text-[var(--muted)]">{e.level !== null ? `L${e.level}` : "L?"}</span>
              <span className="truncate">{pinTitle(e)}</span>
              {n > 1 && <span className="shrink-0 rounded-full bg-[var(--panel-2)] px-1.5 text-[11px] tabular-nums text-[var(--muted)]">×{n}</span>}
              <span className="ml-auto shrink-0 text-[11px] text-[var(--faint)]">{allVerified ? "✓" : n > 1 ? "some unverified" : "unverified"}</span>
            </button>
          </li>
        ))}
      </ul>
      {events.length > 60 && <p className="mt-1 px-0.5 text-xs text-[var(--faint)]">Showing the newest 60. The console has all of them.</p>}
    </Card>
  );
}
