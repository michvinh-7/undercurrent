"use client";

// The phone's outbox on screen (lib/outbox.ts): what's waiting, sent by itself when the hub is
// back. Retries every few seconds while anything waits, and at once when the phone comes back
// online. Shown on every phone page (PhoneShell) and the phone home.

import { useCallback, useEffect, useState } from "react";
import { CircleCheckIcon, CloudOffIcon, LoaderCircleIcon, XIcon } from "lucide-react";
import { discard, flushOutbox, loadOutbox, OUTBOX_CHANGED, type Queued } from "@/lib/outbox";

const RETRY_MS = 4000;

export function useOutbox() {
  const [items, setItems] = useState<Queued[]>([]);
  const [delivered, setDelivered] = useState(0); // sent since the banner last showed it
  const refresh = useCallback(() => setItems(loadOutbox()), []);

  const flush = useCallback(async () => {
    const n = await flushOutbox();
    if (n) setDelivered((d) => d + n);
    refresh();
  }, [refresh]);

  useEffect(() => {
    refresh();
    window.addEventListener(OUTBOX_CHANGED, refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener("online", flush);
    return () => {
      window.removeEventListener(OUTBOX_CHANGED, refresh);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("online", flush);
    };
  }, [refresh, flush]);

  const waiting = items.filter((q) => !q.refused).length;
  useEffect(() => {
    if (!waiting) return;
    flush();
    const t = setInterval(flush, RETRY_MS);
    return () => clearInterval(t);
  }, [waiting, flush]);

  useEffect(() => {
    if (!delivered) return;
    const t = setTimeout(() => setDelivered(0), 8000);
    return () => clearTimeout(t);
  }, [delivered]);

  return { items, waiting, delivered };
}

const TYPE: Record<string, string> = {
  checkin: "Check-in", hazard: "Hazard", case: "Symptoms", missing_person: "Missing person", exchange: "Have / Need",
};

function label(q: Queued): string {
  const p = (q.draft.payload ?? {}) as Record<string, unknown>;
  if (p.enc === true) return "Cell message (sealed)";
  if (q.draft.type === "checkin" && p.status === "need_help") return "SOS: needs help";
  return TYPE[q.draft.type] ?? q.draft.type;
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function OutboxBanner() {
  const { items, waiting, delivered } = useOutbox();
  if (!items.length && !delivered) return null;
  return (
    <div className="space-y-2" aria-live="polite">
      {delivered > 0 && (
        <div className="flex items-start gap-2 rounded-xl border p-3 text-sm" style={{ borderColor: "var(--ok)", background: "color-mix(in srgb, var(--ok) 10%, var(--panel))" }}>
          <CircleCheckIcon className="mt-0.5 size-4 shrink-0 text-[var(--ok)]" aria-hidden="true" />
          <span>The hub is back: {delivered} waiting report{delivered === 1 ? "" : "s"} sent and signed.</span>
        </div>
      )}
      {items.length > 0 && (
        <div className="rounded-xl border p-3" style={{ borderColor: "var(--warn)", background: "color-mix(in srgb, var(--warn) 8%, var(--panel))" }}>
          <p className="flex items-start gap-2 text-sm">
            <CloudOffIcon className="mt-0.5 size-4 shrink-0 text-[var(--warn)]" aria-hidden="true" />
            <span>
              {waiting > 0
                ? `${waiting} report${waiting === 1 ? "" : "s"} waiting on this phone. ${waiting === 1 ? "It sends" : "They send"} by itself the moment the hub is back; nothing to do.`
                : "The hub refused these. They won't be sent again."}
            </span>
          </p>
          <ul className="mt-2 space-y-1.5">
            {items.map((q) => (
              <li key={q.id} className="flex items-center gap-2 text-sm">
                {q.refused ? null : <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />}
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{label(q)}</span>
                  <span className="text-muted-foreground"> · written {clock(String((q.draft.payload as Record<string, unknown>)?.written_at ?? q.queuedAt))}</span>
                  {q.refused && <span className="block text-xs text-[var(--danger)]">Refused: {q.refused}</span>}
                </span>
                {q.refused && (
                  <button onClick={() => discard(q.id)} className="flex min-h-9 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground" aria-label="Discard this report">
                    <XIcon className="size-3.5" aria-hidden="true" /> Discard
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
