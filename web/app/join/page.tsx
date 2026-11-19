"use client";

// Join a cell (Alanna's workstream; written by Michael while she's out). Joining happens in
// person: the resident shows this page, an operator adds the public key to the roster with
// hub/scripts/roster_tool.py add, and from then on this phone's reports are signed and
// verified. The key is made on first visit and never leaves the phone; only the public half
// is shown, as text and as a QR code the operator scans.

import { useCallback, useEffect, useState } from "react";
import { CheckIcon, CircleAlertIcon, CircleCheckIcon, CopyIcon, LoaderCircleIcon, QrCodeIcon, TriangleAlertIcon } from "lucide-react";
import { Notice, PhoneShell } from "@/components/phone";
import { Button } from "@/components/ui/button";
import { QR } from "@/components/qr";
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
    <PhoneShell title="Join a cell" eyebrow="Your key" icon={<QrCodeIcon />} hint="Show this to an operator, in person. They add your key to the roster, and your reports are signed from then on.">
      <div className="space-y-5">
        <section aria-live="polite">
          {hub.state === "loading" && (
            <div className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-3 text-muted-foreground">
              <LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" /> Checking the hub…
            </div>
          )}
          {hub.state === "down" && <Notice tone="danger" icon={<CircleAlertIcon />}>Can&apos;t reach the hub. Check you&apos;re on its Wi-Fi.</Notice>}
          {hub.state === "up" && member && (
            <Notice tone="ok" icon={<CircleCheckIcon />}>
              <strong>You&apos;re on the roster of {hub.hubId}.</strong> Your reports are signed and show as verified.
            </Notice>
          )}
          {hub.state === "up" && !member && (
            <Notice tone="warn" icon={<TriangleAlertIcon />}>
              Not on the roster of {hub.hubId} yet.{" "}
              {hub.requireSigned
                ? "This hub only takes reports from members, so you can't send until you're added."
                : "Until you're added, your reports still go through but show as not verified."}
            </Notice>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card p-4">
          <p className="caption">Your public key</p>
          {pub && (
            <div className="mt-3 rounded-lg bg-white p-2">
              <QR value={pub} label="QR code of your public key" />
            </div>
          )}
          <p className="mt-3 select-all break-all rounded-lg bg-background px-3 py-2.5 font-mono text-base leading-relaxed" data-testid="pub">
            {pub ?? "…"}
          </p>
          <Button type="button" variant="outline" size="lg" onClick={copy} className="mt-3 h-12 w-full">
            {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
            {copied ? "Copied" : "Copy key"}
          </Button>
          <p className="mt-3 text-xs text-muted-foreground">
            This is the public half only. The private half stays in this browser. Clearing the browser&apos;s data makes a new key, which
            would need adding again.
          </p>
        </section>

        <details className="rounded-xl border border-border px-4 text-sm text-muted-foreground">
          <summary className="flex min-h-11 cursor-pointer items-center">For the operator</summary>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-background p-3 font-mono text-xs text-foreground/85">
            {`cd hub\n.venv/bin/python scripts/roster_tool.py add ${pub ?? "<key>"} \\\n  --hub http://localhost:8001 --operator demo/operator.key`}
          </pre>
          <p className="py-3">It syncs to the other hub by itself.</p>
        </details>
      </div>
    </PhoneShell>
  );
}
