// The "Feed" tab: everything the hubs received, newest first.
//   All          repeats of the same thing on the same level fold into one row; click to expand
//   Needs care   people asking for help and sickness reports (question 10)
//   People       check-ins and missing-person reports, searchable by name (question 8)

import { useState } from "react";
import { timeAgo } from "@/lib/format";
import { checkinStatus, type MapEvent } from "../adapter";
import { pinTitle, SEVERITY_COLOR } from "../scene/CityScene";
import { Card } from "./ui";

export type FeedFilter = "all" | "care" | "people";

const payloadOf = (e: MapEvent): Record<string, unknown> => (e.event.payload && typeof e.event.payload === "object" ? e.event.payload : {});
const text = (v: unknown) => (typeof v === "string" ? v : "");

const isCareCase = (e: MapEvent) => e.severity === "sos" || e.event.type === "case";
const isPerson = (e: MapEvent) => e.event.type === "checkin" || e.event.type === "missing_person";

/** Reports with the same title from the same level fold into one group, kept where the newest one sits. */
function group(events: MapEvent[]): { key: string; items: MapEvent[] }[] {
  const out: { key: string; items: MapEvent[] }[] = [];
  const at = new Map<string, { key: string; items: MapEvent[] }>();
  for (const e of events) {
    const key = `${e.level}:${pinTitle(e)}`;
    const g = at.get(key);
    if (g) g.items.push(e);
    else { const n = { key, items: [e] }; at.set(key, n); out.push(n); }
  }
  return out;
}

export default function Feed({ events, fresh, demo, onPick, onDemoAlert, filter, setFilter, query, setQuery }: {
  events: MapEvent[]; fresh: ReadonlySet<string>; demo: boolean; onPick: (e: MapEvent) => void; onDemoAlert: () => void;
  filter: FeedFilter; setFilter: (f: FeedFilter) => void; query: string; setQuery: (q: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const care = events.filter(isCareCase);
  const people = events.filter(isPerson);
  const q = query.trim().toLowerCase();
  const found = q ? people.filter((e) => [payloadOf(e).name, payloadOf(e).description, payloadOf(e).note].some((v) => text(v).toLowerCase().includes(q))) : people;

  const chips: { id: FeedFilter; label: string; n: number }[] = [
    { id: "all", label: "All", n: events.length },
    { id: "care", label: "Needs care", n: care.length },
    { id: "people", label: "People", n: people.length },
  ];

  return (
    <Card title="Latest from the hubs" right={demo ? <button onClick={onDemoAlert} className="text-xs text-[var(--muted)] underline">+ demo sensor alert</button> : null}>
      <div className="mb-2 flex gap-1">
        {chips.map((c) => (
          <button
            key={c.id} onClick={() => setFilter(c.id)} aria-pressed={filter === c.id}
            className={`rounded-full border px-2.5 py-0.5 text-xs ${filter === c.id ? "border-[var(--foreground)] bg-[var(--foreground)] text-[var(--panel)]" : "border-[var(--border-strong)] text-[var(--muted)] hover:text-[var(--foreground)]"}`}
          >
            {c.label} <span className="tabular-nums opacity-70">{c.n}</span>
          </button>
        ))}
      </div>

      {filter === "people" && (
        <>
          <label className="mb-2 block">
            <span className="sr-only">Find someone by name</span>
            <input
              value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find someone by name…"
              className="w-full rounded-md border border-[var(--border-strong)] bg-[var(--panel)] px-2.5 py-1.5 text-sm placeholder:text-[var(--faint)]"
            />
          </label>
          {found.length === 0 && <p className="text-sm text-[var(--muted)]">{q ? `No check-in or missing report names "${query.trim()}" yet. Reports from other levels arrive as the hubs sync.` : "No check-ins or missing reports yet."}</p>}
          <ul className="-mx-1 space-y-0.5">
            {found.slice(0, 40).map((e) => {
              const p = payloadOf(e);
              const status = e.event.type === "missing_person" ? "Reported missing" : checkinStatus(e) === "need_help" ? "Needs help" : "Checked in: OK";
              const tone = e.event.type === "missing_person" ? "var(--warn)" : checkinStatus(e) === "need_help" ? "var(--danger)" : "var(--ok)";
              return (
                <li key={e.id}>
                  <button onClick={() => onPick(e)} className="w-full rounded px-1.5 py-1 text-left hover:bg-[var(--panel-2)]">
                    <span className="flex items-center gap-2 text-sm">
                      <span className="truncate font-medium">{text(p.name) || "No name given"}</span>
                      <span className="ml-auto shrink-0 text-xs" style={{ color: tone }}>{status}</span>
                    </span>
                    <span className="block text-xs text-[var(--muted)]">
                      {e.event.type === "missing_person" && typeof p.last_seen_level === "number" ? `Last seen on L${p.last_seen_level}` : `L${e.level ?? "?"}`} · {timeAgo(e.event.created_at)}{e.verified ? " · ✓ verified" : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {filter !== "people" && (
        <>
          {(filter === "care" ? care : events).length === 0 && (
            <p className="text-sm text-[var(--muted)]">{filter === "care" ? "Nobody is asking for help right now." : "Nothing yet. New reports appear here as the hubs receive them."}</p>
          )}
          <ul className="-mx-1 space-y-0.5">
            {group((filter === "care" ? care : events).slice(0, 80)).map(({ key, items }) => {
              const e = items[0], n = items.length, allVerified = items.every((x) => x.verified), expanded = open === key && n > 1;
              return (
                <li key={key}>
                  <button
                    onClick={() => (n > 1 ? setOpen(expanded ? null : key) : onPick(e))} aria-expanded={n > 1 ? expanded : undefined}
                    className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-sm hover:bg-[var(--panel-2)] ${items.some((x) => fresh.has(x.id)) ? "bg-[color-mix(in_oklab,var(--accent)_8%,transparent)]" : ""}`}
                  >
                    <span className="size-2 shrink-0 rounded-full" style={{ background: SEVERITY_COLOR[e.severity], opacity: e.verified ? 1 : 0.45 }} />
                    <span className="w-8 shrink-0 text-xs tabular-nums text-[var(--muted)]">{e.level !== null ? `L${e.level}` : "L?"}</span>
                    <span className="truncate">{pinTitle(e)}</span>
                    {n > 1 && <span className="shrink-0 rounded-full bg-[var(--panel-2)] px-1.5 text-[11px] tabular-nums text-[var(--muted)]">×{n} {expanded ? "▾" : "▸"}</span>}
                    {e.test && <span className="shrink-0 rounded bg-[var(--panel-2)] px-1 text-[10px] uppercase text-[var(--muted)]">test</span>}
                    {e.simulated && <span className="shrink-0 rounded px-1 text-[10px] uppercase text-[var(--sim)]" style={{ border: "1px solid color-mix(in srgb, var(--sim) 50%, transparent)" }}>sim</span>}
                    <span className="ml-auto shrink-0 text-[11px] text-[var(--faint)]">{allVerified ? "✓" : n > 1 ? "some unverified" : "unverified"}</span>
                  </button>
                  {expanded && (
                    <ul className="mb-1 ml-6 border-l border-[var(--border)] pl-2">
                      {items.map((x) => (
                        <li key={x.id}>
                          <button onClick={() => onPick(x)} className="flex w-full items-center gap-2 rounded px-1.5 py-0.5 text-left text-xs hover:bg-[var(--panel-2)]">
                            <span className="text-[var(--muted)]">{timeAgo(x.event.created_at)}</span>
                            <span className="truncate">{text(payloadOf(x).location) || text(payloadOf(x).note) || x.event.device_id || ""}</span>
                            <span className="ml-auto shrink-0 text-[var(--faint)]">{x.verified ? "✓" : "unverified"}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
          {events.length > 80 && filter === "all" && <p className="mt-1 px-0.5 text-xs text-[var(--faint)]">Showing the newest 80. The console has all of them.</p>}
        </>
      )}
    </Card>
  );
}
