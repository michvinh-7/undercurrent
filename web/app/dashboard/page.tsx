"use client";

// Command dashboard (Person 4): live priority queue, network controls, missing-persons board.
// Reads the hub's live stream (GET /events/stream). Falls back to labeled fake examples if no hub answers.

import { useEffect, useMemo, useRef, useState } from "react";
import { fakeEvents } from "@/lib/fake-events";
import { summary, timeAgo, TYPE_LABEL } from "@/lib/format";
import { getLink, hubUrl, setLink, type LinkStatus } from "@/lib/hub";
import type { HollowEvent } from "@/lib/types";

const SOS = 0.9; // matches the SOS band in hub/app/triage.py score()
const NEW_MS = 4000;

type Conn = "connecting" | "live" | "offline";

function useEventStream() {
  const [events, setEvents] = useState<Map<string, HollowEvent>>(new Map());
  const [arrived, setArrived] = useState<Map<string, number>>(new Map());
  const [conn, setConn] = useState<Conn>("connecting");
  const everConnected = useRef(false);

  useEffect(() => {
    const es = new EventSource(`${hubUrl()}/events/stream`);
    const giveUp = setTimeout(() => !everConnected.current && setConn("offline"), 3000);
    es.onopen = () => {
      everConnected.current = true;
      setConn("live");
    };
    es.onerror = () => setConn(everConnected.current ? "connecting" : "offline"); // EventSource retries by itself
    es.onmessage = (m) => {
      const e = JSON.parse(m.data) as HollowEvent;
      setEvents((cur) => new Map(cur).set(e.id, e));
      setArrived((cur) => new Map(cur).set(e.id, Date.now()));
    };
    return () => {
      clearTimeout(giveUp);
      es.close();
    };
  }, []);

  const showingFakes = conn === "offline" && events.size === 0;
  const list = showingFakes ? fakeEvents : [...events.values()];
  return { events: list, arrived, conn, showingFakes };
}

function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const byPriority = (a: HollowEvent, b: HollowEvent) =>
  (b.priority ?? -1) - (a.priority ?? -1) || b.created_at.localeCompare(a.created_at);

export default function Dashboard() {
  const { events, arrived, conn, showingFakes } = useEventStream();
  const now = useNow();
  const queue = useMemo(() => [...events].sort(byPriority), [events]);
  // The initial backlog arrives all at once on connect; only flag events that came in after that.
  const firstArrival = useMemo(() => Math.min(...arrived.values()), [arrived]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-[var(--muted)]">Command</p>
          <h1 className="text-2xl font-semibold">Undercurrent dashboard</h1>
        </div>
        <ConnBadge conn={conn} />
      </header>

      {showingFakes && (
        <p className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm">
          No hub answered at {hubUrl()}. Showing <strong>fake example events</strong>, not real reports.
        </p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section>
          <h2 className="font-mono text-xs uppercase tracking-widest text-[var(--muted)]">
            Priority queue · {queue.length} reports
          </h2>
          <ol className="mt-3 space-y-2">
            {queue.map((e) => {
              const t = arrived.get(e.id);
              const isNew = t !== undefined && t > firstArrival + 500 && now - t < NEW_MS;
              return <QueueItem key={e.id} e={e} isNew={isNew} now={now} />;
            })}
            {queue.length === 0 && <li className="text-[var(--muted)]">No reports yet.</li>}
          </ol>
        </section>

        <aside className="space-y-6">
          <NetworkControls />
          <MissingBoard events={events} now={now} />
        </aside>
      </div>
    </main>
  );
}

function ConnBadge({ conn }: { conn: Conn }) {
  const color = conn === "live" ? "var(--ok)" : conn === "offline" ? "var(--danger)" : "var(--muted)";
  const text = conn === "live" ? "Live" : conn === "offline" ? "Hub offline" : "Connecting…";
  return (
    <span className="flex items-center gap-2 text-sm">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      {text}
    </span>
  );
}

function QueueItem({ e, isNew, now }: { e: HollowEvent; isNew: boolean; now: number }) {
  const sos = (e.priority ?? 0) >= SOS;
  return (
    <li
      className="flex items-start justify-between gap-3 rounded-lg border bg-[var(--panel)] px-4 py-3 transition-colors duration-700"
      style={{
        borderColor: sos ? "var(--danger)" : isNew ? "var(--accent)" : "var(--border)",
        background: isNew ? "color-mix(in srgb, var(--accent) 14%, var(--panel))" : undefined,
      }}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {sos && <span className="rounded bg-[var(--danger)] px-1.5 py-0.5 font-semibold text-white">SOS</span>}
          <span className="font-mono uppercase text-[var(--accent)]">{TYPE_LABEL[e.type]}</span>
          <span>Level {e.level}</span>
          <span className="text-[var(--muted)]">· {timeAgo(e.created_at, now)} · {e.hub_id}</span>
          {isNew && <span className="font-semibold text-[var(--accent)]">NEW</span>}
        </div>
        <p className="mt-1 break-words">{summary(e)}</p>
      </div>
      <span className="shrink-0 font-mono text-sm" title="Priority, 0 to 1">
        {e.priority === null ? <span className="text-[var(--muted)]">unscored</span> : e.priority.toFixed(2)}
      </span>
    </li>
  );
}

// Slider runs on a log scale: 10 B/s (a crawl) to 100 kB/s.
const MIN_BPS = 10;
const MAX_BPS = 100_000;
const toBps = (x: number) => Math.round(MIN_BPS * (MAX_BPS / MIN_BPS) ** x);
const toSlider = (bps: number) => Math.log(bps / MIN_BPS) / Math.log(MAX_BPS / MIN_BPS);

function NetworkControls() {
  const [link, setLinkState] = useState<LinkStatus | null>(null);
  const [error, setError] = useState(false);
  const [draft, setDraft] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      getLink()
        .then((l) => alive && (setLinkState(l), setError(false)))
        .catch(() => alive && setError(true));
    load();
    const t = setInterval(load, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const apply = (settings: Parameters<typeof setLink>[0]) =>
    setLink(settings).then(setLinkState).catch(() => setError(true));

  const unlimited = link?.bandwidth_bps === null;
  const shownBps = draft ?? link?.bandwidth_bps ?? MAX_BPS;

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
      <h2 className="font-mono text-xs uppercase tracking-widest text-[var(--muted)]">Network (simulated link)</h2>
      {error || !link ? (
        <p className="mt-2 text-sm text-[var(--muted)]">{error ? "Link controls unavailable: no hub answered." : "Loading…"}</p>
      ) : (
        <div className="mt-3 space-y-4">
          <button
            onClick={() => apply({ cut: !link.cut })}
            className="w-full rounded-lg px-4 py-3 font-semibold text-white"
            style={{ background: link.cut ? "var(--ok)" : "var(--danger)" }}
          >
            {link.cut ? "Restore the network" : "Cut the network"}
          </button>

          <label className="block">
            <span className="flex justify-between text-sm">
              <span>Bandwidth</span>
              <span className="font-mono">{unlimited && draft === null ? "unlimited" : `${shownBps.toLocaleString()} B/s`}</span>
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.001}
              value={toSlider(shownBps)}
              onChange={(e) => setDraft(toBps(Number(e.target.value)))}
              onPointerUp={() => draft !== null && apply({ bandwidth_bps: draft }).then(() => setDraft(null))}
              onKeyUp={() => draft !== null && apply({ bandwidth_bps: draft }).then(() => setDraft(null))}
              className="mt-2 w-full accent-[var(--accent)]"
            />
          </label>
          <button onClick={() => apply({ unlimited: true })} className="text-sm text-[var(--muted)] underline">
            Set unlimited
          </button>

          <p className="text-sm text-[var(--muted)]">
            {link.cut ? "Cut. " : ""}
            {link.queued} waiting to send ({link.queued_bytes.toLocaleString()} bytes)
          </p>
        </div>
      )}
    </section>
  );
}

function MissingBoard({ events, now }: { events: HollowEvent[]; now: number }) {
  const [query, setQuery] = useState("");
  const missing = events.filter((e) => e.type === "missing_person").sort((a, b) => b.created_at.localeCompare(a.created_at));

  const q = query.trim().toLowerCase();
  const sightings = q
    ? events
        .filter((e) => e.type === "checkin" || e.type === "missing_person")
        .filter((e) => JSON.stringify(e.payload).toLowerCase().includes(q))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
    : [];

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
      <h2 className="font-mono text-xs uppercase tracking-widest text-[var(--muted)]">Missing persons · {missing.length}</h2>

      <label className="mt-3 block">
        <span className="sr-only">Search check-ins and missing reports by name</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a name…"
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-base outline-none focus:border-[var(--accent)]"
        />
      </label>

      {q ? (
        <ul className="mt-3 space-y-2 text-sm">
          {sightings.map((e) => (
            <li key={e.id}>
              <strong>{String(e.payload.name ?? "Someone")}</strong>{" "}
              {e.type === "checkin"
                ? `checked in on level ${e.level}, ${timeAgo(e.created_at, now)}${e.payload.status === "need_help" ? " · needs help" : ""}`
                : `reported missing, last seen on level ${e.payload.last_seen_level}`}
            </li>
          ))}
          {sightings.length === 0 && <li className="text-[var(--muted)]">No check-ins or reports match.</li>}
        </ul>
      ) : (
        <ul className="mt-3 space-y-3 text-sm">
          {missing.map((e) => (
            <li key={e.id}>
              <strong>{String(e.payload.name ?? "Unknown")}</strong>
              <span className="block text-[var(--muted)]">
                Last seen on level {String(e.payload.last_seen_level ?? "?")} · reported {timeAgo(e.created_at, now)}
              </span>
              {typeof e.payload.description === "string" && <span className="block">{e.payload.description}</span>}
            </li>
          ))}
          {missing.length === 0 && <li className="text-[var(--muted)]">Nobody reported missing.</li>}
        </ul>
      )}
    </section>
  );
}
