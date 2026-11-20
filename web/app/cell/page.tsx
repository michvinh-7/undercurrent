"use client";

// Cell messages (Alanna's workstream; written by Michael while she's out). Demo beat 5:
// members send messages only the cell can read. The hubs check the signature and relay
// them, but hold only ciphertext; /truth shows what a Directorate tap sees.
//
// The cell key arrives in person, as a link <origin>/cell#k=<key> (lib/cell.ts). Opening
// it saves the key on this phone and wipes it from the address bar.

import { useCallback, useEffect, useMemo, useState } from "react";
import { CircleAlertIcon, CircleCheckIcon, LoaderCircleIcon, LockKeyholeIcon, PlusIcon, QrCodeIcon, SendIcon } from "lucide-react";
import { Label, LevelSelect, Notice, PhoneShell, TextArea, useStored } from "@/components/phone";
import { Button } from "@/components/ui/button";
import { QR } from "@/components/qr";
import { hubUrl, listEvents } from "@/lib/hub";
import { sendOrQueue } from "@/lib/outbox";
import { CELL_EVENT_TYPE, decrypt, encrypt, inviteLink, isCellPayload, keyFromHash, keyTag, loadCellKey, newCellKey, saveCellKey } from "@/lib/cell";
import { timeAgo } from "@/lib/format";
import { NotJoinedError } from "@/lib/sign";
import type { HollowEvent } from "@/lib/types";

type Status = { state: "idle" } | { state: "sending" } | { state: "sent"; signed: boolean } | { state: "queued" } | { state: "error"; message: string };

const LOCAL = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * The address a phone can open: this page's own, unless it was opened on localhost (a laptop),
 * where a QR code would point the phone at itself. Then use the laptop's network address
 * (from /api/lan) for both the page and the hub. "none": no network to share.
 */
function usePhoneReachable(active: boolean): { origin: string; hub: string; swapped: string | null } | "none" | null {
  const [out, setOut] = useState<{ origin: string; hub: string; swapped: string | null } | "none" | null>(null);
  useEffect(() => {
    if (!active) return;
    const here = window.location;
    const hub = hubUrl();
    if (!LOCAL.has(here.hostname)) {
      setOut({ origin: here.origin, hub, swapped: null });
      return;
    }
    let live = true;
    fetch("/api/lan", { cache: "no-store" })
      .then((r) => r.json())
      .then(({ addresses }: { addresses: string[] }) => {
        if (!live) return;
        const ip = addresses?.[0];
        if (!ip) return setOut("none");
        const h = new URL(hub);
        if (LOCAL.has(h.hostname)) h.hostname = ip;
        setOut({ origin: `${here.protocol}//${ip}${here.port ? `:${here.port}` : ""}`, hub: h.origin, swapped: ip });
      })
      .catch(() => live && setOut("none"));
    return () => { live = false; };
  }, [active]);
  return out;
}

const newHandle = () => `anon-${Math.random().toString(16).slice(2, 6)}`;

export default function CellPage() {
  const [key, setKey] = useState<Uint8Array | null>(null);
  const [ready, setReady] = useState(false);
  const [events, setEvents] = useState<HollowEvent[] | null>(null);
  const [hubDown, setHubDown] = useState(false);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [showInvite, setShowInvite] = useState(false);
  const reach = usePhoneReachable(showInvite);
  const [level, setLevel] = useStored<number | null>("uc-level", null);
  const [author] = useStored("uc-author", newHandle);

  useEffect(() => {
    const fromLink = keyFromHash(window.location.hash);
    if (fromLink) {
      saveCellKey(fromLink);
      history.replaceState(null, "", window.location.pathname); // don't leave the key on screen
    }
    setKey(fromLink ?? loadCellKey());
    setReady(true);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setEvents(await listEvents({ type: CELL_EVENT_TYPE }));
      setHubDown(false);
    } catch {
      setHubDown(true);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  const { mine, others } = useMemo(() => {
    const sealed = (events ?? []).filter((e) => isCellPayload(e.payload));
    const opened = key
      ? sealed.flatMap((e) => {
          const body = decrypt(e.payload, key);
          return body === null ? [] : [{ e, body }];
        })
      : [];
    opened.sort((a, b) => b.e.created_at.localeCompare(a.e.created_at));
    return { mine: opened, others: sealed.length - opened.length };
  }, [events, key]);

  async function send(ev: React.FormEvent) {
    ev.preventDefault();
    if (!key || !text.trim() || level === null || !author) return;
    setStatus({ state: "sending" });
    try {
      const r = await sendOrQueue({ type: CELL_EVENT_TYPE, level, author, payload: { ...encrypt(text.trim(), key) } });
      setStatus(r.state === "sent" ? { state: "sent", signed: r.signed } : { state: "queued" });
      setText("");
      refresh();
    } catch (err) {
      const message =
        err instanceof NotJoinedError
          ? "Not sent: this hub only takes messages from members, and this phone isn't on the roster yet (see Join a cell)."
          : err instanceof Error && err.message.startsWith("Hub returned 403")
            ? `Not sent: the hub refused it (${err.message.replace(/^Hub returned 403: /, "")}).`
            : "Couldn't reach the hub. Not sent.";
      setStatus({ state: "error", message });
    }
  }

  function startCell() {
    const k = newCellKey();
    saveCellKey(k);
    setKey(k);
    setShowInvite(true);
  }

  function leave() {
    if (!confirm("Remove the cell key from this phone? You'd need a new invite to read the cell again.")) return;
    saveCellKey(null);
    setKey(null);
    setShowInvite(false);
  }

  const shell = { title: "Cell messages", eyebrow: "Your cell", icon: <LockKeyholeIcon /> };

  if (!ready) return <PhoneShell {...shell}>{null}</PhoneShell>;

  if (!key)
    return (
      <PhoneShell {...shell} hint="Messages only your cell can read. The hubs carry them but can't open them.">
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
            <QrCodeIcon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
            <p>This phone isn&apos;t in a cell. Ask a member to show you their invite, in person, and scan it with this phone&apos;s camera.</p>
          </div>
          <Button type="button" variant="outline" size="lg" onClick={startCell} className="h-12 w-full">
            <PlusIcon aria-hidden="true" /> Start a new cell
          </Button>
          {others > 0 && <p className="text-sm text-muted-foreground">{others} sealed message{others === 1 ? "" : "s"} on the hub. Without the key they&apos;re unreadable.</p>}
        </div>
      </PhoneShell>
    );

  return (
    <PhoneShell {...shell} hint="Only phones holding this cell's key can read these. The hubs and anyone tapping the link see ciphertext.">
      <div className="space-y-7">
        <form onSubmit={send} className="space-y-4">
          <LevelSelect level={level} setLevel={setLevel} />
          <label className="block">
            <Label>Message to the cell</Label>
            <TextArea value={text} onChange={(e) => setText(e.target.value)} placeholder="Meet at the east stairwell, 0300." maxLength={500} />
          </label>
          <Button type="submit" size="lg" disabled={!text.trim() || level === null || status.state === "sending"} className="h-14 w-full text-lg font-semibold">
            {status.state === "sending" ? (
              <>
                <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> Sending…
              </>
            ) : (
              <>
                <SendIcon aria-hidden="true" /> Send encrypted
              </>
            )}
          </Button>
          <div aria-live="polite">
            {status.state === "sent" && <Notice tone="ok" icon={<CircleCheckIcon />}>Sent encrypted{status.signed ? " and signed" : ""}.</Notice>}
            {status.state === "queued" && <Notice tone="warn" icon={<CircleAlertIcon />}>No connection to the hub. Sealed and saved on this phone: it sends by itself when the hub is back.</Notice>}
            {status.state === "error" && <Notice tone="danger" icon={<CircleAlertIcon />}>{status.message}</Notice>}
          </div>
        </form>

        <section>
          <div className="flex items-baseline justify-between gap-3">
            <p className="caption">Messages</p>
            <span className="rounded-full border border-border px-2 py-0.5 font-mono text-xs text-muted-foreground">cell key {keyTag(key)}</span>
          </div>
          {hubDown && <p className="mt-2 text-sm text-[var(--danger)]">Can&apos;t reach the hub. Showing what was loaded.</p>}
          {events === null && !hubDown && <p className="mt-3 text-muted-foreground">Loading…</p>}
          {events !== null && mine.length === 0 && <p className="mt-3 text-muted-foreground">No messages for this cell yet.</p>}
          <ul className="mt-3 space-y-2">
            {mine.map(({ e, body }) => (
              <li key={e.id} className="rounded-xl border border-border bg-card px-4 py-3">
                <p className="whitespace-pre-wrap break-words">{body}</p>
                <p className="mt-1.5 font-mono text-xs text-muted-foreground">
                  {e.author} · L{e.level} · {timeAgo(e.created_at, Date.now())}
                  <span style={{ color: e.sig ? "var(--ok)" : "var(--muted)" }}>{e.sig ? " · signed" : " · not signed"}</span>
                </p>
              </li>
            ))}
          </ul>
          {others > 0 && (
            <p className="mt-3 text-sm text-muted-foreground">
              {others} more sealed message{others === 1 ? "" : "s"} on the hub for other cells.
            </p>
          )}
        </section>

        <section className="space-y-3">
          <Button type="button" variant="outline" size="lg" onClick={() => setShowInvite((v) => !v)} className="h-12 w-full">
            <QrCodeIcon aria-hidden="true" /> {showInvite ? "Hide invite" : "Invite someone (in person)"}
          </Button>
          {showInvite && (
            <div className="rounded-xl border p-4" style={{ borderColor: "var(--warn)", background: "color-mix(in srgb, var(--warn) 8%, var(--panel))" }}>
              <p className="text-sm">
                Scan this with the new member&apos;s phone camera. Anyone who opens it can read the cell, so show it face to face,
                never send it over the hub.
              </p>
              {reach === null ? (
                <p className="mt-3 text-sm text-muted-foreground">Finding this laptop&apos;s network address…</p>
              ) : reach === "none" ? (
                <p className="mt-3 text-sm text-[var(--danger)]">
                  This page is open on localhost, and this laptop has no network address a phone could reach. Join Wi-Fi or a hotspot, then try again.
                </p>
              ) : (
                <>
                  <div className="mt-3 rounded-lg bg-white p-2">
                    <QR value={inviteLink(key, reach.origin, reach.hub)} label="QR code of the cell invite link" />
                  </div>
                  <p className="mt-3 select-all break-all font-mono text-xs text-foreground/80">{inviteLink(key, reach.origin, reach.hub)}</p>
                  {reach.swapped && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Uses this laptop&apos;s network address ({reach.swapped}) instead of localhost, so the phone can open it. The phone must be on the same Wi-Fi or hotspot.
                    </p>
                  )}
                </>
              )}
            </div>
          )}
          <button type="button" onClick={leave} className="min-h-11 w-full text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground">
            Remove the cell key from this phone
          </button>
        </section>
      </div>
    </PhoneShell>
  );
}
