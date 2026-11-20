"use client";

// The rebel console. Every demo beat must be readable here, without the 3D map:
//   1. a verified sensor alert lands       → queue + "Verified" badge
//   2. the link is cut, alerts queue        → Link card + "N waiting to send"
//   3. a forged "all clear" is rejected     → Forgeries blocked counter
//   4. an edited record                     → Chain card names the exact row
//   5. the Directorate sniffs the channel   → Directorate view toggle (and /truth)
// Data: web/lib/useUndercurrent.ts. No hub answering → labeled demo data.

import { AppBar } from "@/components/app-bar";
import { PageIntro, Zone } from "@/components/page-intro";
import { useEffect, useMemo, useState } from "react";
import { summary, timeAgo, TYPE_LABEL } from "@/lib/format";
import { isEncrypted, isSensor, isSimulated, isSOS, useUndercurrent, type HubState, type Undercurrent } from "@/lib/useUndercurrent";
import type { HollowEvent } from "@/lib/types";

const NEW_MS = 5000;

function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

// Unscored events (AI triage off, e.g. on the box) sort by rule: SOS, then sensor alarms. Only the order
// uses this; the priority column still shows "—" for them.
const rank = (e: HollowEvent) => e.priority ?? (isSOS(e) ? 0.95 : isSensor(e) ? 0.9 : 0.3);
const byPriority = (a: HollowEvent, b: HollowEvent) => rank(b) - rank(a) || b.created_at.localeCompare(a.created_at);

export default function Console() {
  const net = useUndercurrent();
  const now = useNow();
  const [directorate, setDirectorate] = useState(false);

  const queue = useMemo(() => net.events.filter((e) => e.type !== "roster").sort(byPriority), [net.events]);
  const primary = net.hubs.find((h) => h.role === "primary");

  return (
    <>
    <AppBar net={net} />
    <main
      className="mx-auto max-w-7xl px-4 py-6 sm:px-6"
      style={directorate ? { boxShadow: "inset 0 0 0 2px var(--directorate)" } : undefined}
    >
      <PageIntro
        kicker={directorate ? "Console · Directorate view" : "Console"}
        kickerColor={directorate ? "var(--directorate)" : undefined}
        questions={[7, 9, 10]}
        title={directorate ? "What the Directorate sees on the same feed." : "Every report, most urgent first, checked by both hubs."}
        sub={directorate
          ? "Public alerts are readable by anyone and signed, so they can't be faked. Cell messages are bytes without the key."
          : "What the operator sees: signed alerts ranked by the hub's AI, and every attack the Directorate tries, refused or caught."}
        actions={<HeaderControls net={net} directorate={directorate} setDirectorate={setDirectorate} />}
        right={<StatStrip net={net} />}
      />

      {net.mode === "demo" && (
        <p className="sim-hatch mt-4 rounded-lg border border-[var(--sim)] px-3 py-2 text-sm">
          <span className="caption mr-2 !text-[var(--sim)]">Demo data</span>
          No hub answered{primary ? ` at ${primary.url}` : ""}. Showing example events, not real reports. Buttons
          change the demo only.
        </p>
      )}

      <div className="mt-7 grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <Zone
          n={1}
          title={directorate ? `Intercepted traffic · ${queue.length}` : `Who needs help, most urgent first · ${queue.length}`}
          note={
            <>
              {directorate ? "every message on the link, as a tap sees it" : "the hub's AI reads free text; code does the scoring"}
              {net.mode === "demo" && (
                <button onClick={() => net.actions.demoSensorAlert(34)} className="ml-3 underline hover:text-foreground">
                  + demo sensor alert
                </button>
              )}
            </>
          }
        >
          <ol className="space-y-2">
            {queue.map((e) => {
              const t = net.arrived.get(e.id);
              const isNew = t !== undefined && net.isFresh(e.id) && now - t < NEW_MS;
              return (
                <QueueItem
                  key={e.id}
                  e={e}
                  isNew={isNew}
                  now={now}
                  verified={net.isVerified(e)}
                  tampered={net.chain?.first_bad_event === e.id}
                  directorate={directorate}
                />
              );
            })}
            {queue.length === 0 && <li className="text-[var(--muted)]">No reports yet.</li>}
          </ol>
        </Zone>

        <aside className="space-y-6">
          <Zone n={2} title="Under attack" note="forged and replayed messages, refused">
            <ForgeryPanel net={net} now={now} />
          </Zone>
          <Zone n={3} title="The link" note="cut it: alerts wait, then all arrive">
            <div className="space-y-3">
              {[...net.hubs].sort((a) => (a === net.sendingHub ? -1 : 1)).map((h) => (
                <LinkPanel key={h.role} hub={h} net={net} />
              ))}
            </div>
          </Zone>
          <Zone n={4} title="The record" note="an edit breaks the chain at that row">
            <ChainPanel net={net} events={net.events} />
          </Zone>
          <Zone n={5} title="People" note="missing persons, and who checked in">
            <MissingBoard events={net.events} now={now} />
          </Zone>
        </aside>
      </div>
    </main>
    </>
  );
}

function HeaderControls({
  net,
  directorate,
  setDirectorate,
}: {
  net: Undercurrent;
  directorate: boolean;
  setDirectorate: (v: boolean) => void;
}) {
  return (
    <>
        <ModeBadge mode={net.mode} />
        <button
          role="switch"
          aria-checked={directorate}
          onClick={() => setDirectorate(!directorate)}
          className="flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm"
          style={{
            borderColor: directorate ? "var(--directorate)" : "var(--border-strong)",
            color: directorate ? "var(--directorate)" : undefined,
          }}
        >
          <span
            className="relative h-4 w-7 rounded-full transition-colors"
            style={{ background: directorate ? "var(--directorate)" : "var(--border-strong)" }}
          >
            <span
              className="absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all"
              style={{ left: directorate ? 14 : 2 }}
            />
          </span>
          Directorate view
        </button>
    </>
  );
}

function ModeBadge({ mode }: { mode: Undercurrent["mode"] }) {
  const color = mode === "live" ? "var(--ok)" : mode === "demo" ? "var(--sim)" : "var(--warn)";
  const text = mode === "live" ? "Live" : mode === "demo" ? "Demo data" : "Reconnecting…";
  return (
    <span className="flex items-center gap-2 text-sm">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      {text}
    </span>
  );
}

function Stat({ label, value, sub, color, bumpKey }: { label: string; value: React.ReactNode; sub: React.ReactNode; color?: string; bumpKey?: number }) {
  return (
    <div className="panel px-4 py-3">
      <p className="caption">{label}</p>
      <p key={bumpKey} className={`mt-1 font-mono text-2xl font-semibold ${bumpKey ? "bump" : ""}`} style={{ color }}>
        {value}
      </p>
      <p className="mt-0.5 truncate text-xs text-[var(--muted)]">{sub}</p>
    </div>
  );
}

function StatStrip({ net }: { net: Undercurrent }) {
  const alerts = net.events.filter((e) => e.type !== "roster");
  const verified = alerts.filter(net.isVerified).length;
  const link = net.sendingHub?.link;
  const chain = net.chain;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="Verified reports" value={`${verified}/${alerts.length}`} sub="signed by a key on the roster" color="var(--ok)" />
      <Stat
        label={`Link · ${net.sendingHub?.hubId?.replace("hub-", "") ?? "hub"}`}
        value={!link ? "—" : link.cut ? "CUT" : "Up"}
        sub={!link ? "no hub answered" : `${link.queued} waiting to send`}
        color={!link ? undefined : link.cut ? "var(--danger)" : "var(--ok)"}
      />
      <Stat
        label="Forgeries blocked"
        value={net.forgeriesBlocked}
        sub={net.rejected[0] ? `last: ${net.rejected[0].reason}` : "none yet"}
        color={net.forgeriesBlocked ? "var(--danger)" : undefined}
        bumpKey={net.forgeriesBlocked}
      />
      <Stat
        label="Record chain"
        value={!chain ? "—" : chain.chain_intact ? "Intact" : "Tampered"}
        sub={!chain ? "no hub answered" : chain.chain_intact ? "every row checks out" : `first bad row ${chain.first_bad_event?.slice(0, 8)}…`}
        color={!chain ? undefined : chain.chain_intact ? "var(--ok)" : "var(--danger)"}
      />
    </div>
  );
}

function Badge({ children, color, solid }: { children: React.ReactNode; color: string; solid?: boolean }) {
  return (
    <span
      className="rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider"
      style={solid ? { background: color, color: "white" } : { color, boxShadow: `inset 0 0 0 1px ${color}` }}
    >
      {children}
    </span>
  );
}

/** What a sniffer sees of a ciphertext: bytes, nothing else. */
function hexPreview(b64: string, n = 24) {
  try {
    const bin = atob(b64);
    return Array.from(bin.slice(0, n), (c) => c.charCodeAt(0).toString(16).padStart(2, "0").toUpperCase()).join(" ") + " …";
  } catch {
    return b64.slice(0, 48) + "…";
  }
}

function QueueItem({
  e,
  isNew,
  now,
  verified,
  tampered,
  directorate,
}: {
  e: HollowEvent;
  isNew: boolean;
  now: number;
  verified: boolean;
  tampered: boolean;
  directorate: boolean;
}) {
  const sos = isSOS(e);
  const enc = isEncrypted(e);
  const border = tampered ? "var(--danger)" : sos ? "var(--danger)" : isNew ? "var(--accent)" : "var(--border)";
  return (
    <li
      className={`flex items-start justify-between gap-3 rounded-lg border bg-[var(--panel)] px-4 py-3 transition-colors duration-700 ${sos && isNew ? "pulse-danger" : ""}`}
      style={{ borderColor: border, background: isNew ? "color-mix(in srgb, var(--accent) 12%, var(--panel))" : undefined }}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {sos && !enc && <Badge color="var(--danger)" solid>SOS</Badge>}
          {tampered && <Badge color="var(--danger)" solid>Tampered row</Badge>}
          {tampered ? null : verified ? <Badge color="var(--ok)">✓ Verified</Badge> : <Badge color="var(--warn)">{e.sig ? "Unknown key" : "Unsigned"}</Badge>}
          {isSensor(e) && <Badge color="var(--water)">Sensor · {e.device_id ?? "canary"}</Badge>}
          {isSimulated(e) && <Badge color="var(--sim)">Simulated</Badge>}
          {enc ? <Badge color="var(--accent)">Cell message</Badge> : <span className="font-mono uppercase text-[var(--accent)]">{TYPE_LABEL[e.type]}</span>}
          <span>Level {e.level}</span>
          <span className="text-[var(--muted)]">· {timeAgo(e.created_at, now)} · {e.hub_id}</span>
          {isNew && <span className="font-semibold text-[var(--accent)]">NEW</span>}
        </div>
        {enc ? (
          directorate ? (
            <p className="mt-1 break-all font-mono text-xs text-[var(--directorate)]">{hexPreview(String(e.payload.ciphertext ?? ""))}</p>
          ) : (
            <p className="mt-1 text-[var(--muted)]">Encrypted for the cell. Open it on a member phone.</p>
          )
        ) : (
          <p className="mt-1 break-words">{summary(e)}</p>
        )}
        {directorate && !enc && <p className="caption mt-1 !text-[var(--faint)]">Public · readable by anyone, provably from a member</p>}
      </div>
      <span className="shrink-0 font-mono text-sm" title="Priority, 0 to 1">
        {e.priority === null ? <span className="text-[var(--muted)]">—</span> : e.priority.toFixed(2)}
      </span>
    </li>
  );
}

// Slider runs on a log scale: 10 B/s (a crawl) to 100 kB/s.
const MIN_BPS = 10;
const MAX_BPS = 100_000;
const toBps = (x: number) => Math.round(MIN_BPS * (MAX_BPS / MIN_BPS) ** x);
const toSlider = (bps: number) => Math.log(bps / MIN_BPS) / Math.log(MAX_BPS / MIN_BPS);

function LinkPanel({ hub, net }: { hub: HubState; net: Undercurrent }) {
  const [draft, setDraft] = useState<number | null>(null);
  const link = hub.link;
  const name = hub.hubId?.replace("hub-", "Hub ") ?? (hub.role === "primary" ? "This hub" : "Peer hub");
  const apply = (s: Parameters<Undercurrent["actions"]["setLink"]>[1]) => net.actions.setLink(hub, s);
  const unlimited = link?.bandwidth_bps === null;
  const shownBps = draft ?? link?.bandwidth_bps ?? MAX_BPS;

  return (
    <section className="panel p-4" style={link?.cut ? { borderColor: "var(--danger)" } : undefined}>
      <div className="flex items-baseline justify-between">
        <h2 className="caption">Outbound link · {name}</h2>
        <span className="font-mono text-xs" style={{ color: !link ? "var(--muted)" : link.cut ? "var(--danger)" : "var(--ok)" }}>
          {!link ? "no answer" : link.cut ? "CUT" : "CONNECTED"}
        </span>
      </div>
      {!link ? (
        <p className="mt-2 text-sm text-[var(--muted)]">No hub answered at {hub.url}.</p>
      ) : (
        <div className="mt-3 space-y-4">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-3xl font-semibold" style={{ color: link.queued ? "var(--warn)" : undefined }}>
              {link.queued}
            </span>
            <span className="text-sm text-[var(--muted)]">
              waiting to send · {link.queued_bytes.toLocaleString()} bytes
            </span>
          </div>
          <button
            onClick={() => apply({ cut: !link.cut })}
            className="w-full rounded-lg px-4 py-2.5 font-semibold text-white"
            style={{ background: link.cut ? "var(--ok)" : "var(--danger)" }}
          >
            {link.cut ? "Restore the link" : "Cut the link"}
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
        </div>
      )}
    </section>
  );
}

function ForgeryPanel({ net, now }: { net: Undercurrent; now: number }) {
  const [result, setResult] = useState<string | null>(null);
  const target = net.sendingHub;
  return (
    <section className="panel p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="caption">Forgeries blocked</h2>
        <span key={net.forgeriesBlocked} className="bump font-mono text-2xl font-semibold" style={{ color: net.forgeriesBlocked ? "var(--danger)" : undefined }}>
          {net.forgeriesBlocked}
        </span>
      </div>
      <ul className="mt-3 space-y-2 text-sm">
        {net.rejected.slice(0, 5).map((r) => (
          <li key={`${r.hubId}-${r.seq}`} className="flex items-start justify-between gap-2">
            <span className="min-w-0">
              <span className="block truncate">
                {typeof r.event.payload?.note === "string" ? `“${r.event.payload.note}”` : `${r.event.type ?? "event"} · level ${r.event.level ?? "?"}`}
              </span>
              <span className="caption !text-[var(--danger)]">{r.reason}</span>
              <span className="caption"> · {r.via} · {r.hubId?.replace("hub-", "") ?? ""}</span>
            </span>
            <span className="shrink-0 text-xs text-[var(--muted)]">{timeAgo(r.received_at, now)}</span>
          </li>
        ))}
        {net.rejected.length === 0 && <li className="text-[var(--muted)]">Nothing rejected yet.</li>}
      </ul>
      <button
        onClick={async () => {
          setResult("sending…");
          const r = await net.actions.injectForgery(target, 34);
          setResult(r.ok ? "⚠ the hub ACCEPTED it" : `refused: ${r.reason}`);
        }}
        className="mt-4 w-full rounded-lg border px-3 py-2 text-sm"
        style={{ borderColor: "var(--directorate)", color: "var(--directorate)" }}
      >
        Directorate: inject “all clear, level 34”
      </button>
      {result && <p className="mt-2 font-mono text-xs text-[var(--muted)]">{result}</p>}
      <p className="mt-2 text-xs text-[var(--faint)]">
        Signs a real request with a fresh key that is on no roster.
      </p>
    </section>
  );
}

function ChainPanel({ net, events }: { net: Undercurrent; events: HollowEvent[] }) {
  const chain = net.chain;
  const bad = chain?.first_bad_event ? events.find((e) => e.id === chain.first_bad_event) : undefined;
  const gaps = Object.entries(chain?.gaps ?? {}).filter(([, n]) => n > 0);
  return (
    <section className="panel p-4" style={chain && !chain.chain_intact ? { borderColor: "var(--danger)" } : undefined}>
      <h2 className="caption">Record chain check</h2>
      {!chain ? (
        <p className="mt-2 text-sm text-[var(--muted)]">No hub answered.</p>
      ) : chain.chain_intact ? (
        <p className="mt-2 text-sm">
          <span className="font-semibold text-[var(--ok)]">Intact.</span> Every row&apos;s hash and signature check out
          against the one before it.
        </p>
      ) : (
        <div className="mt-2 text-sm">
          <p className="font-semibold text-[var(--danger)]">Edited record found.</p>
          <p className="mt-1 break-all font-mono text-xs">row {chain.first_bad_event}</p>
          {bad && (
            <p className="mt-1 text-[var(--muted)]">
              {TYPE_LABEL[bad.type]} · level {bad.level} · {bad.hub_id}: “{summary(bad)}”
            </p>
          )}
        </div>
      )}
      {gaps.length > 0 && (
        <p className="caption mt-2">Syncing: {gaps.map(([h, n]) => `${n} pending from ${h}`).join(", ")}</p>
      )}
    </section>
  );
}

function MissingBoard({ events, now }: { events: HollowEvent[]; now: number }) {
  const [query, setQuery] = useState("");
  const missing = events.filter((e) => e.type === "missing_person" && !isEncrypted(e)).sort((a, b) => b.created_at.localeCompare(a.created_at));

  const q = query.trim().toLowerCase();
  const sightings = q
    ? events
        .filter((e) => (e.type === "checkin" || e.type === "missing_person") && !isEncrypted(e))
        .filter((e) => JSON.stringify(e.payload).toLowerCase().includes(q))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
    : [];

  return (
    <section className="panel p-4">
      <h2 className="caption">Missing persons · {missing.length}</h2>
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
