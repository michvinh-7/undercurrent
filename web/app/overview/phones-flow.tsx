"use client";

// The deep dive's "Phones" tab: what a resident's phone sends, and how the same report shows up on
// the console and the 3D map. The table states what each screen does with each kind of report
// (web/app/dashboard/page.tsx, web/app/hollow/city/adapter.ts and panels). The live strip shows the
// newest report that came from a phone, so a judge can send one and watch it land.

import Link from "next/link";
import { ArrowRightIcon, LayoutListIcon, MapIcon, ServerIcon, SmartphoneIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { summary, timeAgo } from "@/lib/format";
import { isEncrypted, isSensor, isSimulated, type Undercurrent } from "@/lib/useUndercurrent";
import { FlowArrow, FlowNode } from "./sections";

const ROWS: { report: string; console: string; map: string }[] = [
  { report: "Check in: I need help", console: "An SOS row at the top of Urgent", map: "A red \"Needs help\" marker on the level" },
  { report: "Check in: I'm OK", console: "A row under Everything else; counts in the roll call", map: "Feed → Who checked in; feeds the level's sleep and mood" },
  { report: "Hazard", console: "Urgent if high or medium, else Everything else", map: "On the street or building the note names; a flood closes streets, bad water is traced up the pipes" },
  { report: "Symptoms", console: "A row with the people affected", map: "Feed → Needs care; lung reports counted per level" },
  { report: "Missing person", console: "The People board, searchable", map: "Find someone" },
  { report: "Have / Need", console: "A row; the hub pairs needs with offers across levels", map: "Briefs → See the posts" },
  { report: "Cell message", console: "\"Encrypted for the cell\": nobody but members can read it", map: "A sealed private message" },
];

export function PhonesFlow({ net, q }: { net: Undercurrent; q: string }) {
  // The newest report from a person's phone: not a sensor box, not a roster change, not the simulation.
  const fromPhones = net.events
    .filter((e) => !isSensor(e) && e.type !== "roster" && !isSimulated(e))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const latest = fromPhones.find((e) => net.isVerified(e)) ?? fromPhones[0];
  const live = net.mode === "live";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">One report, three screens</h2>
        <p className="max-w-[70ch] text-foreground/75">
          A resident&apos;s phone is a sender like the sensor boxes. It signs each report with its own key and sends it to its level&apos;s hub over
          local Wi-Fi, no internet. The hub checks it, stores it and syncs it to the other hub, and the console and the 3D map show it within a
          couple of seconds. Nothing is typed twice, and the operator and the map see the same signed report.
        </p>
      </div>

      <Card className="gap-6 p-6 sm:p-7">
        <div className="flex flex-wrap items-center gap-2.5">
          <FlowNode tone="ok" icon={<SmartphoneIcon className="size-5 text-primary" aria-hidden="true" />} title="Resident's phone"
            body="Check in, report, ask for help. Signed on the phone. Offline, it waits and sends itself later." />
          <FlowArrow label="signed" tone="muted" back={false} />
          <FlowNode tone="ok" icon={<ServerIcon className="size-5 text-primary" aria-hidden="true" />} title="Level's hub"
            body="Checks the signature and the roster, stores it, syncs it to the other hub." />
          <FlowArrow label="live" tone="muted" back={false} />
          <div className="grid min-w-0 flex-[1_1_170px] gap-2.5">
            <FlowNode tone="ok" icon={<LayoutListIcon className="size-5 text-primary" aria-hidden="true" />} title="Console"
              body="The operator's queue: urgent first, with a Verified badge." />
            <FlowNode tone="ok" icon={<MapIcon className="size-5 text-primary" aria-hidden="true" />} title="3D map"
              body="Where on the level it happened, and what it means for the streets." />
          </div>
        </div>

        <div className="border-t border-border pt-5">
          <p className="caption mb-2">Newest report from a phone</p>
          {latest ? (
            <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-medium">{isEncrypted(latest) ? "Cell message (sealed)" : summary(latest)}</span>
              <span className="text-sm text-muted-foreground">
                L{latest.level} · {timeAgo(latest.created_at)} · {latest.hub_id} · {net.isVerified(latest) ? "✓ verified" : latest.sig ? "signed, key not on the roster" : "unsigned"}
              </span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {live ? "None yet. Send one from the phone pages and it appears here, on the console and on the map." : "No hub here, so no phone reports. On the hubs' Wi-Fi, a report sent from a phone appears here."}
            </p>
          )}
        </div>
      </Card>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-card text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-normal">Sent from the phone</th>
              <th className="px-4 py-2.5 font-normal">On the console</th>
              <th className="px-4 py-2.5 font-normal">On the 3D map</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.report} className="border-t border-border align-top">
                <td className="px-4 py-2.5 font-medium">{r.report}</td>
                <td className="px-4 py-2.5 text-foreground/80">{r.console}</td>
                <td className="px-4 py-2.5 text-foreground/80">{r.map}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2.5">
          <Button asChild><Link href={`/?phone=1${q ? `&${q.slice(1)}` : ""}`}>Open the phone pages <ArrowRightIcon /></Link></Button>
          <Button asChild variant="outline"><Link href={`/dashboard${q}`}>Open the console</Link></Button>
          <Button asChild variant="outline"><Link href={`/hollow${q}`}>Open the 3D map</Link></Button>
        </div>
        <p className="max-w-[70ch] text-sm text-muted-foreground">
          On a real phone: join the hubs&apos; Wi-Fi, open the link <code className="font-mono">demo_hubs.py up --host 0.0.0.0</code> prints, and show
          your join code to an operator so your reports arrive signed. Try it side by side: send an SOS from the phone with the console and the
          map open, and it lands on both.
        </p>
      </div>
    </div>
  );
}
