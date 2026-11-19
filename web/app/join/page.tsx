"use client";

// Join a cell (Alanna's workstream; written by Michael while she's out). Joining happens in
// person: the resident shows this page, an operator adds the public key to the roster with
// hub/scripts/roster_tool.py add, and from then on this phone's reports are signed and
// verified. The key is made on first visit and never leaves the phone; only the public half
// is shown.

import { useCallback, useEffect, useState } from "react";
import { PhoneShell } from "@/components/phone";
import { hubUrl } from "@/lib/hub";
import { hubSigningInfo, loadIdentity, type HubSigningInfo } from "@/lib/sign";

type Hub = { state: "loading" } | { state: "down" } | ({ state: "up" } & HubSigningInfo);

export default function JoinPage() {
  const [pub, setPub] = useState<string | null>(null);
  const [hub, setHub] = useState<Hub>({ state: "loading" });
  const [copied, setCopied] = useState(false);

  const check = useCallback(async () => {
    try {
      setHub({ state: "up", ...(await hubSigningInfo(hubUrl())) });
    } catch {
      setHub({ state: "down" });
    }
  }, []);

  useEffect(() => {
    setPub(loadIdentity().pub); // browser only: makes the key on first visit
    check();
    const t = setInterval(check, 5000); // notices when the operator adds you
    return () => clearInterval(t);
  }, [check]);

  async function copy() {
    if (!pub) return;
    try {
      await navigator.clipboard.writeText(pub);
      setCopied(true);
    } catch {
      setCopied(false); // no clipboard over plain http on some phones: the key is selectable
    }
  }

  const member = hub.state === "up" && !!pub && hub.members.has(pub);

  return (
    <PhoneShell title="Join a cell" hint="Show this to an operator, in person. They add your key to the roster, and your reports are signed from then on.">
      <div className="space-y-6">
        <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
          <p className="caption">Your public key</p>
          <p className="mt-2 select-all break-all font-mono text-lg leading-relaxed" data-testid="pub">
            {pub ?? "…"}
          </p>
          <button type="button" onClick={copy} className="mt-3 min-h-12 w-full rounded-lg border border-[var(--border-strong)] px-3 text-base">
            {copied ? "Copied" : "Copy key"}
          </button>
          <p className="mt-3 text-xs text-[var(--muted)]">
            This is the public half only. The private half stays in this browser. Clearing the browser&apos;s data makes a new key, which
            would need adding again.
          </p>
        </section>

        <section aria-live="polite" className="rounded-xl border px-4 py-3" style={{ borderColor: member ? "var(--ok)" : "var(--border)" }}>
          {hub.state === "loading" && <p>Checking the hub…</p>}
          {hub.state === "down" && <p>Can&apos;t reach the hub. Check you&apos;re on its Wi-Fi.</p>}
          {hub.state === "up" && member && (
            <p>
              <strong>You&apos;re on the roster of {hub.hubId}.</strong> Your reports are signed and show as verified.
            </p>
          )}
          {hub.state === "up" && !member && (
            <p>
              Not on the roster of {hub.hubId} yet.{" "}
              {hub.requireSigned
                ? "This hub only takes reports from members, so you can't send until you're added."
                : "Until you're added, your reports still go through but show as not verified."}
            </p>
          )}
        </section>

        <details className="text-sm text-[var(--muted)]">
          <summary className="cursor-pointer py-2">For the operator</summary>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-[var(--panel-2)] p-3 font-mono text-xs">
            {`cd hub\n.venv/bin/python scripts/roster_tool.py add ${pub ?? "<key>"} \\\n  --hub http://localhost:8001 --operator demo/operator.key`}
          </pre>
          <p className="mt-2">It syncs to the other hub by itself.</p>
        </details>
      </div>
    </PhoneShell>
  );
}
