"use client";

// The Directorate view (demo beat 5): what someone sniffing the channel sees, next to what a
// member reads. Public alerts are readable by design and provably from a member. Cell
// messages are ciphertext on the wire; only a phone holding the cell key can open them.
//
// In demo mode (no hub reachable), one labeled demo cell message is encrypted here in the
// browser with tweetnacl secretbox and a demo key, so its ciphertext is real, not drawn. Live,
// only real cell messages (web/lib/cell.ts) show.

import { AppBar } from "@/components/app-bar";
import { PageIntro } from "@/components/page-intro";
import { useEffect, useMemo, useState } from "react";
import nacl from "tweetnacl";
import { summary, timeAgo, TYPE_LABEL } from "@/lib/format";
import { isEncrypted, isSensor, isSimulated, useUndercurrent } from "@/lib/useUndercurrent";
import type { HollowEvent } from "@/lib/types";

const DEMO_PLAINTEXT = "Cell 7: meet at the L27 east stairwell, 0300. Bring the spare filters.";

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function useDemoCellMessage() {
  const [msg, setMsg] = useState<{ event: HollowEvent; key: Uint8Array } | null>(null);
  useEffect(() => {
    const key = nacl.randomBytes(nacl.secretbox.keyLength);
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
    const box = nacl.secretbox(new TextEncoder().encode(DEMO_PLAINTEXT), nonce, key);
    setMsg({
      key,
      event: {
        id: "demo-cell-message",
        type: "case",
        hub_id: "hub-L34",
        level: 27,
        created_at: new Date(Date.now() - 4 * 60_000).toISOString(),
        author: "anon-2c91",
        priority: null,
        payload: { enc: true, nonce: b64(nonce), ciphertext: b64(box) },
        prev_hash: "",
        hash: "",
        source: "resident",
      },
    });
  }, []);
  return msg;
}

function hex(b64s: string, max = 64) {
  try {
    const bytes = fromB64(b64s);
    const shown = Array.from(bytes.slice(0, max), (b) => b.toString(16).padStart(2, "0").toUpperCase());
    return shown.join(" ") + (bytes.length > max ? " …" : "");
  } catch {
    return b64s;
  }
}

/** What actually crosses the wire for this event, minus the hashes. */
function wireJson(e: HollowEvent) {
  const { id, type, hub_id, level, created_at, author, payload, sig } = e;
  return JSON.stringify(
    { id: id.slice(0, 8) + "…", type, hub_id, level, created_at, author, payload, sig: sig ? sig.slice(0, 16) + "…" : null },
  );
}

export default function Truth() {
  const net = useUndercurrent();
  const demoCell = useDemoCellMessage();
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const traffic = useMemo(() => {
    const real = net.events.filter((e) => e.type !== "roster").sort((a, b) => b.created_at.localeCompare(a.created_at));
    // The labelled demo cell message only fills in when no hub answers; live, only real traffic shows.
    return demoCell && net.mode === "demo" ? [demoCell.event, ...real] : real;
  }, [net.events, net.mode, demoCell]);

  const encrypted = traffic.filter(isEncrypted).length;
  const pub = traffic.length - encrypted;

  return (
    <>
    <AppBar net={net} />
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <PageIntro
        kicker="Directorate view"
        kickerColor="var(--directorate)"
        questions={[7, 9, 13]}
        title="What they can see, and what they can't."
        sub="Left: the bytes a Directorate tap on the hub link captures. Right: what a cell member reads. Public alerts are open on purpose and signed, so they can't be faked. Cell messages are ciphertext to everyone without the key, the hubs included."
        right={
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Fact label="Captured" value={traffic.length} sub="messages on the link" />
            <Fact label="Readable" value={pub} sub="public alerts, signed" color="var(--foreground)" />
            <Fact label="Unreadable" value={encrypted} sub="cell messages, encrypted" color="var(--accent)" />
            <Fact label="Forged & refused" value={net.forgeriesBlocked} sub="by the hubs' checks" color="var(--danger)" />
          </div>
        }
      />

      {net.mode === "demo" && (
        <p className="sim-hatch mt-4 rounded-lg border border-[var(--sim)] px-3 py-2 text-sm">
          <span className="caption mr-2 !text-[var(--sim)]">Demo data</span>No hub answered. Showing example traffic.
        </p>
      )}

      <div className="mt-7 hidden grid-cols-2 gap-4 lg:grid">
        <p className="flex items-baseline gap-2">
          <span className="size-2 self-center rounded-full bg-[var(--directorate)]" aria-hidden="true" />
          <span className="font-semibold">On the wire</span>
          <span className="text-[13px] text-[var(--muted)]">what a Directorate tap captures</span>
        </p>
        <p className="flex items-baseline gap-2 pl-4">
          <span className="size-2 self-center rounded-full bg-[var(--ok)]" aria-hidden="true" />
          <span className="font-semibold">On a member&apos;s phone</span>
          <span className="text-[13px] text-[var(--muted)]">what the cell reads</span>
        </p>
      </div>

      <ol className="mt-2 space-y-3">
        {traffic.map((e) => (
          <Row key={e.id} e={e} now={now} verified={net.isVerified(e) && net.chain?.first_bad_event !== e.id} tampered={net.chain?.first_bad_event === e.id} demoKey={e.id === demoCell?.event.id ? demoCell.key : null} />
        ))}
      </ol>

      <section className="panel mt-8 p-4 text-sm">
        <h2 className="caption">What the Directorate still learns (stated limits)</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--muted)]">
          <li>Metadata stays visible: which hub, which level, when, and the sender&apos;s anonymous handle.</li>
          <li>A stolen phone can sign until an operator&apos;s roster event removes its key.</li>
          <li>Cutting the link works, for a while: messages queue at the hub and arrive when it comes back.</li>
        </ul>
      </section>
    </main>
    </>
  );
}

function Fact({ label, value, sub, color }: { label: string; value: number; sub: string; color?: string }) {
  return (
    <div className="panel px-4 py-3">
      <p className="caption">{label}</p>
      <p className="mt-1 font-mono text-2xl font-semibold" style={{ color }}>{value}</p>
      <p className="mt-0.5 text-xs text-[var(--muted)]">{sub}</p>
    </div>
  );
}

function Row({ e, now, verified, tampered, demoKey }: { e: HollowEvent; now: number; verified: boolean; tampered?: boolean; demoKey: Uint8Array | null }) {
  const enc = isEncrypted(e);
  const meta = `${TYPE_LABEL[e.type]} · L${e.level} · ${e.hub_id} · ${now ? timeAgo(e.created_at, now) : ""}`;

  let memberText: React.ReactNode;
  if (!enc) {
    memberText = summary(e);
  } else if (demoKey) {
    const opened = nacl.secretbox.open(fromB64(String(e.payload.ciphertext)), fromB64(String(e.payload.nonce)), demoKey);
    memberText = opened ? new TextDecoder().decode(opened) : "Could not decrypt";
  } else {
    memberText = <span className="text-[var(--muted)]">Opens on a phone holding the cell key.</span>;
  }

  return (
    <li className="grid gap-px overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--border)] lg:grid-cols-2">
      {/* Directorate side */}
      <div className="bg-[#0b0608] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="caption" style={{ color: enc ? "var(--accent)" : "var(--foreground)" }}>
            {enc ? "Private · cell message" : "Public · alert"}
          </span>
          <span className="caption">{meta}</span>
        </div>
        {enc ? (
          <>
            <p className="mt-2 break-all font-mono text-xs leading-relaxed text-[var(--directorate)]">
              {hex(String(e.payload.ciphertext))}
            </p>
            <p className="caption mt-2 !text-[var(--directorate)]">Content unavailable · no key on the relay</p>
          </>
        ) : (
          <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-[var(--muted)]">
            {wireJson(e)}
          </pre>
        )}
      </div>

      {/* Member side */}
      <div className="bg-[var(--panel)] p-4">
        <div className="flex flex-wrap items-center gap-2">
          {enc ? (
            <span className="caption !text-[var(--accent)]">Decrypted on a member phone</span>
          ) : tampered ? (
            <span className="caption !text-[var(--danger)]">Edited after it was stored · chain check failed here</span>
          ) : verified ? (
            <span className="caption !text-[var(--ok)]">✓ Signature verified · key on roster</span>
          ) : (
            <span className="caption !text-[var(--warn)]">{e.sig ? "Signed by an unknown key" : "Unsigned"}</span>
          )}
          {isSensor(e) && <span className="caption !text-[var(--water)]">Sensor · {e.device_id}</span>}
          {isSimulated(e) && <span className="caption !text-[var(--sim)]">Simulated</span>}
          {demoKey && <span className="caption !text-[var(--sim)]">Demo message · demo key</span>}
        </div>
        <p className="mt-2 break-words">{memberText}</p>
      </div>
    </li>
  );
}
