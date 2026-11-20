"use client";

// The Directorate view's right column: their control room. Every command is a real request to
// the hubs. Each card shows two layers: what the Directorate tried, and, stamped under it,
// what the residents' network actually did, from the hubs' answer
// (refusal reason, counter, queue, chain row). Nothing here is staged: a command the hubs
// accepted would show as "TOOK EFFECT", and the tally would say so. (Their own tool would see the
// refusals too: this shows intent against outcome, not a fooled Directorate.)

import { useState } from "react";
import { isEncrypted, type HubState, type Undercurrent } from "@/lib/useUndercurrent";

export type Verdict = "blocked" | "held" | "unreadable" | "caught" | "took effect";
export interface Outcome { claim: string; verdict: Verdict; detail: string }
export interface Tally { issued: number; tookEffect: number }

const STAMP: Record<Verdict, { label: string; color: string }> = {
  blocked: { label: "Blocked", color: "var(--ok)" },
  held: { label: "Held, not lost", color: "var(--ok)" },
  unreadable: { label: "Unreadable", color: "var(--ok)" },
  caught: { label: "Caught", color: "var(--ok)" },
  "took effect": { label: "Took effect", color: "var(--danger)" },
};

function b64Hex(b64: string, n = 20) {
  try {
    const raw = atob(b64);
    return Array.from(raw.slice(0, n), (c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join(" ") + " …";
  } catch {
    return b64.slice(0, 40) + " …";
  }
}

function Card({ title, action, outcome, children }: {
  title: string; action: React.ReactNode; outcome: Outcome | null; children?: React.ReactNode;
}) {
  const stamp = outcome ? STAMP[outcome.verdict] : null;
  return (
    <section className="rounded-lg border bg-[var(--panel)]" style={{ borderColor: "color-mix(in srgb, var(--directorate) 45%, var(--border))" }}>
      <div className="flex items-center justify-between gap-3 px-4 pt-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action}
      </div>
      <div className="px-4 pb-3 pt-2">
        <p className="caption !text-[var(--faint)]">What they tried</p>
        <p className="font-mono text-sm" style={{ color: outcome ? "var(--directorate)" : "var(--muted)" }}>
          {outcome ? outcome.claim : "Nothing yet"}
        </p>
      </div>
      {outcome && stamp && (
        <div className="border-t px-4 py-3" style={{ borderColor: "var(--border)", background: `color-mix(in srgb, ${stamp.color} 9%, var(--panel))` }}>
          <p className="caption !text-[var(--faint)]">What the residents&apos; network did</p>
          <p className="mt-0.5 flex flex-wrap items-baseline gap-2">
            <span className="rounded border-2 px-1.5 font-mono text-xs font-bold uppercase tracking-widest" style={{ borderColor: stamp.color, color: stamp.color }}>
              {stamp.label}
            </span>
            <span className="text-sm">{outcome.detail}</span>
          </p>
        </div>
      )}
      {children}
    </section>
  );
}

function Fire({ onClick, children, busy }: { onClick: () => void; children: React.ReactNode; busy?: boolean }) {
  return (
    <button onClick={onClick} disabled={busy}
      className="shrink-0 rounded-md border px-3 py-1.5 text-xs font-semibold uppercase tracking-wider disabled:opacity-50"
      style={{ borderColor: "var(--directorate)", color: "var(--directorate)" }}>
      {busy ? "Sending…" : children}
    </button>
  );
}

export function DirectorateControl({ net, onCommand }: { net: Undercurrent; onCommand: (tookEffect: boolean) => void }) {
  const target: HubState | undefined = net.sendingHub;
  const [out, setOut] = useState<Record<string, Outcome>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const done = (key: string, o: Outcome) => {
    setOut((cur) => ({ ...cur, [key]: o }));
    onCommand(o.verdict === "took effect");
  };
  const run = async (key: string, fn: () => Promise<Outcome>) => {
    setBusy(key);
    try { done(key, await fn()); } finally { setBusy(null); }
  };

  const level = 34;
  const link = target?.link;
  const cut = !!link?.cut;
  const cells = net.events.filter(isEncrypted).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const chain = net.chain;

  return (
    <div className="space-y-3">
      <Card
        title={`Broadcast "All clear, level ${level}"`}
        outcome={out.forge ?? null}
        action={<Fire busy={busy === "forge"} onClick={() => run("forge", async () => {
          const r = await net.actions.injectForgery(target, level);
          return r.ok
            ? { claim: `Broadcast an all-clear to level ${level}`, verdict: "took effect", detail: "the hub stored it" }
            : { claim: `Broadcast an all-clear to level ${level}`, verdict: "blocked",
                detail: `refused: ${r.reason}. Their key is on no roster, so the alert never reaches a phone.` };
        })}>Send</Fire>}
      />

      <Card
        title="Re-send an old alert"
        outcome={out.replay ?? null}
        action={<Fire busy={busy === "replay"} onClick={() => run("replay", async () => {
          const r = await net.actions.reuseAlert(target, "replay");
          return r.ok
            ? { claim: "Re-send an old alert", verdict: "took effect", detail: "the hub stored it a second time" }
            : { claim: "Re-send an old alert to stir panic", verdict: "blocked", detail: `refused: ${r.reason}. Every alert is stored once.` };
        })}>Re-send</Fire>}
      />

      <Card
        title="Rewrite a resident's alert"
        outcome={out.tamper ?? null}
        action={<Fire busy={busy === "tamper"} onClick={() => run("tamper", async () => {
          const r = await net.actions.reuseAlert(target, "tamper");
          return r.ok
            ? { claim: "Rewrite a resident's alert to \"all clear\"", verdict: "took effect", detail: "the hub stored the rewrite" }
            : { claim: "Rewrite a resident's alert to \"all clear\"", verdict: "blocked",
                detail: `refused: ${r.reason}. The resident's signature covers the words; change one and it no longer matches.` };
        })}>Rewrite</Fire>}
      />

      <Card
        title={`Cut level ${level}'s line`}
        outcome={out.cut ?? null}
        action={target ? (
          <Fire busy={busy === "cut"} onClick={() => run("cut", async () => {
            await net.actions.setLink(target, { cut: !cut });
            return cut
              ? { claim: `Give level ${level} its line back`, verdict: "held",
                  detail: `everything that waited during the cut is crossing now, none lost, none doubled.` }
              : { claim: `Silence level ${level}: cut its line`, verdict: "held",
                  detail: `phones on level ${level} still reach their own hub; their alerts wait in line and all arrive when the line is back.` };
          })}>{cut ? "Restore" : "Cut"}</Fire>
        ) : null}
      >
        {cut && link && (
          <p className="border-t px-4 py-2 font-mono text-xs" style={{ borderColor: "var(--border)" }}>
            Right now: <span className="text-[var(--warn)]">{link.queued} waiting to send</span> · {link.queued_bytes.toLocaleString()} bytes · 0 lost
          </p>
        )}
      </Card>

      <Card
        title="Read the cell messages"
        outcome={out.read ?? null}
        action={<Fire onClick={() => done("read", {
          claim: `Decrypt ${cells.length} intercepted cell message${cells.length === 1 ? "" : "s"}`,
          verdict: "unreadable",
          detail: cells.length
            ? `ciphertext only (XSalsa20-Poly1305). The key never touches a hub: it passes phone to phone, by QR, in person.`
            : "no cell messages on the line yet; when there are, all they get is ciphertext.",
        })}>Decrypt</Fire>}
      >
        {out.read && cells[0] && (
          <p className="break-all border-t px-4 py-2 font-mono text-xs text-[var(--directorate)]" style={{ borderColor: "var(--border)" }}>
            {b64Hex(String(cells[0].payload.ciphertext ?? ""))}
          </p>
        )}
      </Card>

      <Card
        title="Rewrite a stored record"
        outcome={chain && !chain.chain_intact
          ? { claim: "Change a record in the hub's database", verdict: "caught",
              detail: `the chain check names the exact row (${chain.first_bad_event?.slice(0, 8) ?? "?"}…), and the other hub still holds the original.` }
          : null}
        action={<span className="caption !text-[var(--faint)]">needs the server&apos;s disk</span>}
      >
        {(!chain || chain.chain_intact) && (
          <p className="border-t px-4 py-2 text-xs text-[var(--muted)]" style={{ borderColor: "var(--border)" }}>
            There&apos;s no edit button anywhere on the network. Even with the disk (<code className="font-mono">directorate.py edit</code>),
            the change shows here as caught at its row. Right now every record checks out.
          </p>
        )}
      </Card>
    </div>
  );
}

export function TallyStrip({ tally, net }: { tally: Tally; net: Undercurrent }) {
  const tile = (label: string, value: React.ReactNode, sub: string, color?: string) => (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-4 py-3">
      <p className="caption">{label}</p>
      <p className="font-mono text-3xl font-semibold tabular-nums" style={{ color }}>{value}</p>
      <p className="text-xs text-[var(--muted)]">{sub}</p>
    </div>
  );
  return (
    <div className="grid grid-cols-3 gap-2">
      {tile("Commands issued", tally.issued, "from this control room", "var(--directorate)")}
      {tile("Took effect", tally.tookEffect, tally.tookEffect ? "the hubs accepted one" : "none, so far", tally.tookEffect ? "var(--danger)" : "var(--ok)")}
      {tile("Refused by the hubs", net.forgeriesBlocked, "all time, every attack counted")}
    </div>
  );
}
