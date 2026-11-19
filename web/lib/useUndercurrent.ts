"use client";

// One live view of the network, shared by the console (/dashboard), the Directorate view
// (/truth) and the Hollow map (/hollow). Nothing here decides whether an event is real:
// the hub's checks do that. This only reads what the hubs report.
//
// Hubs: the primary is hubUrl() (NEXT_PUBLIC_HUB_URL, or <this host>:8000). The peer is
// NEXT_PUBLIC_PEER_HUB_URL. Both can be overridden for a demo with ?hub=...&peer=...
// With no hub answering, it switches to labeled demo data (or force it with ?demo=1).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import nacl from "tweetnacl";
import { canonicalBytes } from "./canonical";
import { demoEvents, demoLink, demoRejected, demoRoster } from "./demo-data";
import { hubUrl, type LinkStatus, type RejectedEvent, type RosterStatus } from "./hub";
import type { HollowEvent } from "./types";

export type Mode = "connecting" | "live" | "demo";

export interface VerifyReport {
  chain_intact: boolean;
  first_bad_event: string | null;
  gaps: Record<string, number>;
}

export interface HubState {
  role: "primary" | "peer";
  url: string;
  hubId: string | null;
  online: boolean;
  misses: number; // consecutive failed polls; offline only after 2, so one slow answer doesn't flap
  link: LinkStatus | null;
  rejectedTotal: number;
  rejected: RejectedEvent[];
  verify: VerifyReport | null;
}

const POLL_MS = 1500;
const OFFLINE_AFTER_MS = 3000;

function param(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

function hubUrls(): { primary: string; peer: string | null } {
  return {
    primary: param("hub") ?? hubUrl(),
    peer: param("peer") ?? process.env.NEXT_PUBLIC_PEER_HUB_URL ?? null,
  };
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(1200) });
  if (!res.ok) throw new Error(`${res.status}`);
  return (await res.json()) as T;
}

async function pollHub(prev: HubState): Promise<HubState> {
  const u = prev.url;
  // One request at a time: the hub's chain check shares a database connection with sync,
  // so a burst of parallel reads can trip it. A failed read keeps the last good value.
  const get = <T,>(path: string) => getJson<T>(`${u}${path}`).catch(() => null);
  const h = await get<{ hub_id: string }>("/health");
  if (!h) {
    const misses = prev.misses + 1;
    return misses >= 2 ? { ...prev, misses, online: false, link: null } : { ...prev, misses };
  }
  const link = await get<LinkStatus>("/link");
  const rj = await get<{ total: number; rejected: RejectedEvent[] }>("/rejected?limit=20");
  const verify = await get<VerifyReport>("/events/verify");
  return {
    ...prev,
    online: true,
    misses: 0,
    hubId: h.hub_id,
    link: link ?? prev.link,
    rejectedTotal: rj?.total ?? prev.rejectedTotal,
    rejected: rj?.rejected ?? prev.rejected,
    verify: verify ?? prev.verify,
  };
}

const emptyHub = (role: HubState["role"], url: string): HubState => ({
  role, url, hubId: null, online: false, misses: 0, link: null, rejectedTotal: 0, rejected: [], verify: null,
});

/** A cell message: its payload is ciphertext only members can open. */
export const isEncrypted = (e: Pick<HollowEvent, "payload">) => e.payload?.enc === true;
export const isSensor = (e: Pick<HollowEvent, "source">) => e.source === "sensor";
export const SOS_PRIORITY = 0.9; // matches the SOS band in hub/app/triage.py score()
export const isSOS = (e: HollowEvent) =>
  (e.priority ?? 0) >= SOS_PRIORITY || (e.type === "checkin" && e.payload.status === "need_help");

export function useUndercurrent() {
  const forceDemo = useRef(false);
  const [mode, setMode] = useState<Mode>("connecting");
  const [events, setEvents] = useState<Map<string, HollowEvent>>(new Map());
  const [arrived, setArrived] = useState<Map<string, number>>(new Map());
  const [hubs, setHubs] = useState<HubState[]>([]);
  const [roster, setRoster] = useState<RosterStatus | null>(null);
  const everLive = useRef(false);
  // When the stream first opened. Everything it sends in the first moments is the stored
  // backlog; events that arrive later are new (including alerts that waited out a cut).
  const [openedAt, setOpenedAt] = useState(0);

  // Live event stream from the primary hub (it holds both hubs' events once synced).
  useEffect(() => {
    forceDemo.current = param("demo") === "1";
    const { primary, peer } = hubUrls();
    setHubs(peer ? [emptyHub("primary", primary), emptyHub("peer", peer)] : [emptyHub("primary", primary)]);
    if (forceDemo.current) {
      setMode("demo");
      setOpenedAt(Date.now());
      return;
    }
    const es = new EventSource(`${primary}/events/stream`);
    const giveUp = setTimeout(() => {
      if (everLive.current) return;
      setMode("demo");
      setOpenedAt(Date.now());
    }, OFFLINE_AFTER_MS);
    es.onopen = () => {
      if (!everLive.current) setOpenedAt(Date.now());
      everLive.current = true;
      setMode("live");
    };
    es.onerror = () => {
      if (everLive.current) return setMode("connecting"); // EventSource retries by itself
      setMode("demo");
      setOpenedAt((t) => t || Date.now());
    };
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

  // Hub status: link, rejections, chain check, roster. Polled, since none of it streams.
  // Only once a hub has answered at least once: with no hub at all there's nothing to ask, and
  // every refused request still shows up as a console error (some browser extensions report
  // fetches that the code already caught). After a hub has been live, keep polling while it
  // reconnects, so "offline" still shows.
  useEffect(() => {
    if (mode === "demo" || hubs.length === 0 || (mode === "connecting" && !everLive.current)) return;
    let alive = true;
    const tick = async () => {
      const next = await Promise.all(hubs.map(pollHub));
      if (!alive) return;
      setHubs((cur) => (cur.length === next.length ? next : cur));
      getJson<RosterStatus>(`${hubs[0].url}/roster`).then((r) => alive && setRoster(r), () => {});
    };
    tick();
    const t = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, hubs.length]);

  // Demo data: built once when demo mode starts, then changed only by demo actions.
  const [demo, setDemo] = useState<{
    events: HollowEvent[];
    rejected: { total: number; rejected: RejectedEvent[] };
    link: LinkStatus;
    verify: VerifyReport;
  } | null>(null);
  useEffect(() => {
    if (mode !== "demo" || demo) return;
    const now = Date.now();
    setDemo({
      events: demoEvents(now),
      rejected: demoRejected(now),
      link: demoLink,
      verify: { chain_intact: true, first_bad_event: null, gaps: {} },
    });
  }, [mode, demo]);

  const live = mode !== "demo";
  const eventList = useMemo(() => (live ? [...events.values()] : demo?.events ?? []), [live, events, demo]);
  const rosterNow = live ? roster : demoRoster;
  const members = useMemo(() => new Set(rosterNow?.members.map((m) => m.pub) ?? []), [rosterNow]);

  const hubStates: HubState[] = useMemo(() => {
    if (live) return hubs;
    if (!demo) return [];
    return [
      { role: "primary", url: hubUrls().primary, hubId: "hub-L12", online: true, misses: 0, link: demoLink, rejectedTotal: demo.rejected.total,
        rejected: demo.rejected.rejected, verify: demo.verify },
      { role: "peer", url: hubUrls().peer ?? "demo", hubId: "hub-L34", online: true, misses: 0, link: demo.link, rejectedTotal: 0, rejected: [],
        verify: demo.verify },
    ];
  }, [live, hubs, demo]);

  /** Verified = signed, and the signer's key is on the roster. The hub already checked the signature. */
  const isVerified = useCallback((e: HollowEvent) => !!e.sig && !!e.author_pub && members.has(e.author_pub), [members]);

  const rejectedAll = useMemo(
    () =>
      hubStates
        .flatMap((h) => h.rejected.map((r) => ({ ...r, hubId: h.hubId })))
        .sort((a, b) => b.received_at.localeCompare(a.received_at)),
    [hubStates],
  );
  const forgeriesBlocked = hubStates.reduce((n, h) => n + h.rejectedTotal, 0);

  /** The hub whose outbound link carries the box's alerts (L34), else the primary. */
  const sendingHub = hubStates.find((h) => h.hubId === "hub-L34") ?? hubStates.find((h) => h.role === "peer") ?? hubStates[0];
  const chain = hubStates.find((h) => h.verify && !h.verify.chain_intact)?.verify ?? hubStates[0]?.verify ?? null;

  // --- Actions -----------------------------------------------------------------------

  /** Cut/restore or throttle a hub's outbound link. In demo mode it only changes demo state. */
  const setLink = useCallback(
    async (hub: HubState, settings: { cut?: boolean; bandwidth_bps?: number; unlimited?: boolean }) => {
      if (!live) {
        setDemo((d) => d && {
          ...d,
          link: {
            ...d.link,
            cut: settings.cut ?? d.link.cut,
            bandwidth_bps: settings.unlimited ? null : settings.bandwidth_bps ?? d.link.bandwidth_bps,
            queued: settings.cut === false ? 0 : d.link.queued,
            queued_bytes: settings.cut === false ? 0 : d.link.queued_bytes,
          },
        });
        return;
      }
      await fetch(`${hub.url}/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
    },
    [live],
  );

  /**
   * The Directorate's move: post "all clear, level 34", signed with a fresh key that is on
   * no roster. A real request; the hub refuses it ("unknown key") and counts it.
   */
  const injectForgery = useCallback(
    async (hub: HubState | undefined, level = 34) => {
      if (!live || !hub) {
        setDemo((d) => d && {
          ...d,
          rejected: {
            total: d.rejected.total + 1,
            rejected: [
              { seq: d.rejected.total + 1, received_at: new Date().toISOString(), reason: "unknown key", via: "post",
                event: { type: "hazard", level, author: "directorate", payload: { kind: "other", severity: "low", note: `All clear, level ${level}` } } },
              ...d.rejected.rejected,
            ],
          },
        });
        return { ok: false, reason: "unknown key (demo)" };
      }
      const keys = nacl.sign.keyPair();
      const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
      const event: Record<string, unknown> = {
        id: crypto.randomUUID(),
        type: "hazard",
        hub_id: hub.hubId ?? "hub-L34",
        level,
        created_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
        author: "anon-0000",
        payload: { kind: "other", severity: "low", note: `All clear, level ${level}. Return to your homes.` },
        author_pub: b64(keys.publicKey),
        source: "resident",
      };
      event.sig = b64(nacl.sign.detached(canonicalBytes(event), keys.secretKey));
      const res = await fetch(`${hub.url}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
      });
      const body = await res.json().catch(() => ({}));
      return { ok: res.ok, reason: res.ok ? "accepted (!)" : String(body.detail ?? res.status) };
    },
    [live],
  );

  /** Demo mode only: a new sensor alert, so the offline showcase can show beat 1. */
  const demoSensorAlert = useCallback((level = 34) => {
    if (live) return;
    const now = Date.now();
    const e = { ...demoEvents(now)[0], id: `demo-${now}`, level, created_at: new Date(now).toISOString() };
    setDemo((d) => d && { ...d, events: [...d.events, e] });
    setArrived((cur) => new Map(cur).set(e.id, now));
  }, [live]);

  /** True for events that arrived after the initial backlog: new alerts, and ones released by a restored link. */
  const isFresh = useCallback((id: string) => openedAt > 0 && (arrived.get(id) ?? 0) - openedAt > 1500, [arrived, openedAt]);

  return {
    mode,
    live,
    isFresh,
    events: eventList,
    arrived,
    hubs: hubStates,
    sendingHub,
    roster: rosterNow,
    isVerified,
    forgeriesBlocked,
    rejected: rejectedAll,
    chain,
    actions: { setLink, injectForgery, demoSensorAlert },
  };
}

export type Undercurrent = ReturnType<typeof useUndercurrent>;
