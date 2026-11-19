"use client";

// Cell messages (Alanna's workstream; written by Michael while she's out). Demo beat 5:
// members send messages only the cell can read. The hubs check the signature and relay
// them, but hold only ciphertext; /truth shows what a Directorate tap sees.
//
// The cell key arrives in person, as a link <origin>/cell#k=<key> (lib/cell.ts). Opening
// it saves the key on this phone and wipes it from the address bar.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Label, PhoneShell, TextArea, useStored } from "@/components/phone";
import { QR } from "@/components/qr";
import { addEvent, hubUrl, listEvents } from "@/lib/hub";
import { CELL_EVENT_TYPE, decrypt, encrypt, inviteLink, isCellPayload, keyFromHash, keyTag, loadCellKey, newCellKey, saveCellKey } from "@/lib/cell";
import { timeAgo } from "@/lib/format";
import { NotJoinedError, prepare } from "@/lib/sign";
import type { HollowEvent } from "@/lib/types";

type Status = { state: "idle" } | { state: "sending" } | { state: "sent"; signed: boolean } | { state: "error"; message: string };

const newHandle = () => `anon-${Math.random().toString(16).slice(2, 6)}`;

export default function CellPage() {
  const [key, setKey] = useState<Uint8Array | null>(null);
  const [ready, setReady] = useState(false);
  const [events, setEvents] = useState<HollowEvent[] | null>(null);
  const [hubDown, setHubDown] = useState(false);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [showInvite, setShowInvite] = useState(false);
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
      const { event, signed } = await prepare({ type: CELL_EVENT_TYPE, level, author, payload: { ...encrypt(text.trim(), key) } }, hubUrl());
      await addEvent(event);
      setStatus({ state: "sent", signed });
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

  if (!ready) return <PhoneShell title="Cell messages">{null}</PhoneShell>;

  if (!key)
    return (
      <PhoneShell title="Cell messages" hint="Messages only your cell can read. The hubs carry them but can't open them.">
        <div className="space-y-4">
          <p className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
            This phone isn&apos;t in a cell. Ask a member to show you their invite, in person, and open it on this phone.
          </p>
          <button type="button" onClick={startCell} className="min-h-12 w-full rounded-lg border border-[var(--border-strong)] px-3 text-base">
            Start a new cell
          </button>
          {others > 0 && <p className="text-sm text-[var(--muted)]">{others} sealed message{others === 1 ? "" : "s"} on the hub. Without the key they&apos;re unreadable.</p>}
        </div>
      </PhoneShell>
    );

  return (
    <PhoneShell title="Cell messages" hint="Only phones holding this cell's key can read these. The hubs and anyone tapping the link see ciphertext.">
      <div className="space-y-6">
        <form onSubmit={send} className="space-y-4">
          <label className="block">
            <Label>Your level</Label>
            <select
              value={level ?? ""}
              onChange={(e) => setLevel(e.target.value ? Number(e.target.value) : null)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-3 text-base"
              required
            >
              <option value="">Choose your level</option>
              {Array.from({ length: 40 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  Level {n}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <Label>Message to the cell</Label>
            <TextArea value={text} onChange={(e) => setText(e.target.value)} placeholder="Meet at the east stairwell, 0300." maxLength={500} />
          </label>
          <button
            type="submit"
            disabled={!text.trim() || level === null || status.state === "sending"}
            className="min-h-14 w-full rounded-lg bg-[var(--accent)] px-4 text-lg font-semibold text-white disabled:opacity-40"
          >
            {status.state === "sending" ? "Sending…" : "Send encrypted"}
          </button>
          <div aria-live="polite">
            {status.state === "sent" && (
              <p className="rounded-lg border border-[var(--ok)] px-3 py-3">Sent encrypted{status.signed ? " and signed" : ""}.</p>
            )}
            {status.state === "error" && <p className="rounded-lg border border-[var(--danger)] px-3 py-3">{status.message}</p>}
          </div>
        </form>

        <section>
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">Messages</h2>
            <span className="font-mono text-xs text-[var(--muted)]">cell key {keyTag(key)}</span>
          </div>
          {hubDown && <p className="mt-2 text-sm text-[var(--danger)]">Can&apos;t reach the hub. Showing what was loaded.</p>}
          {events === null && !hubDown && <p className="mt-2 text-[var(--muted)]">Loading…</p>}
          {events !== null && mine.length === 0 && <p className="mt-2 text-[var(--muted)]">No messages for this cell yet.</p>}
          <ul className="mt-3 space-y-2">
            {mine.map(({ e, body }) => (
              <li key={e.id} className="rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 py-3">
                <p className="whitespace-pre-wrap break-words">{body}</p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {e.author} · L{e.level} · {timeAgo(e.created_at, Date.now())}
                  {e.sig ? " · signed" : " · not signed"}
                </p>
              </li>
            ))}
          </ul>
          {others > 0 && (
            <p className="mt-3 text-sm text-[var(--muted)]">
              {others} more sealed message{others === 1 ? "" : "s"} on the hub for other cells.
            </p>
          )}
        </section>

        <section className="space-y-3">
          <button type="button" onClick={() => setShowInvite((v) => !v)} className="min-h-12 w-full rounded-lg border border-[var(--border-strong)] px-3 text-base">
            {showInvite ? "Hide invite" : "Invite someone (in person)"}
          </button>
          {showInvite && (
            <div className="rounded-xl border border-[var(--warn)] p-4">
              <p className="text-sm">
                Scan this with the new member&apos;s phone camera. Anyone who opens it can read the cell, so show it face to face,
                never send it over the hub.
              </p>
              <div className="mt-3">
                <QR value={inviteLink(key, window.location.origin)} label="QR code of the cell invite link" />
              </div>
              <p className="mt-3 select-all break-all font-mono text-xs">{inviteLink(key, window.location.origin)}</p>
            </div>
          )}
          <button type="button" onClick={leave} className="w-full py-2 text-sm text-[var(--muted)] underline">
            Remove the cell key from this phone
          </button>
        </section>
      </div>
    </PhoneShell>
  );
}
