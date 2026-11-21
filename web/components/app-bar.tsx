"use client";

// The shared top bar on every laptop page: where you are, the other pages, and the live
// state of the channel at a glance (both hubs, the link, whether they agree, forgeries
// blocked, the chain check, signing). Pass the page's own useUndercurrent() so the bar adds
// no second connection. Links keep ?hub=, ?peer= and ?demo=, so moving between pages never
// drops to demo data.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { MenuIcon, WavesIcon } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAgreement } from "@/lib/useAgreement";
import type { Undercurrent } from "@/lib/useUndercurrent";
import { cn } from "@/lib/utils";

const PAGES = [
  { href: "/overview", label: "Overview" },
  { href: "/dashboard", label: "Console" },
  { href: "/hollow", label: "Map" },
  // The pitch (/pitch) is kept in the repo for recording, but not linked from the site.
] as const;

type Tone = "ok" | "warn" | "danger" | "accent" | "muted" | "sim";
const TONE: Record<Tone, string> = {
  ok: "var(--ok)", warn: "var(--warn)", danger: "var(--danger)", accent: "var(--accent)", muted: "var(--muted)", sim: "var(--sim)",
};

export interface Chip {
  key: string;
  label: string;
  tone: Tone;
  /** Draw the border in the tone too: for states that need attention. */
  loud?: boolean;
  help: string;
}

/** The query string to carry across pages (?hub, ?peer, ?demo), read after mount. */
export function useCarriedQuery() {
  const [q, setQ] = useState("");
  useEffect(() => {
    const now = new URLSearchParams(window.location.search);
    const keep = new URLSearchParams();
    for (const k of ["hub", "peer", "demo"]) {
      const v = now.get(k);
      if (v) keep.set(k, v);
    }
    const s = keep.toString();
    setQ(s ? `?${s}` : "");
  }, []);
  return q;
}

/** The status chips, worked out from the page's live data. Also used by /overview. */
export function useStatusChips(net: Undercurrent): Chip[] {
  const primary = net.hubs.find((h) => h.role === "primary") ?? null;
  const hasPeer = net.hubs.some((h) => h.role === "peer");
  const agreement = useAgreement(primary?.url ?? null, net.mode === "live" && hasPeer);

  if (net.mode === "demo")
    return [net.recorded
      ? { key: "demo", label: `Recorded run · no hub here`, tone: "sim", loud: true, help: `No hub answered, so this page plays back a real run of our hubs, recorded ${new Date(net.recorded.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}, with times shifted to now. Buttons act on the recording only. Add ?hub=…&peer=… to the address to go live.` }
      : { key: "demo", label: "Demo data: no hub reachable", tone: "sim", loud: true, help: "No hub answered, so this page shows labelled sample data. Add ?hub=…&peer=… to the address to go live." }];
  if (net.mode === "connecting")
    return [{ key: "connecting", label: "Connecting to the hubs…", tone: "muted", help: "Waiting for the first answer from the hubs." }];

  const chips: Chip[] = [];
  for (const h of net.hubs) {
    const name = h.hubId?.replace("hub-", "") ?? (h.role === "primary" ? "Primary hub" : "Peer hub");
    chips.push(
      h.online
        ? { key: `hub-${h.url}`, label: `${name} online`, tone: "ok", help: `${h.hubId ?? "This hub"} at ${h.url} is answering.` }
        : { key: `hub-${h.url}`, label: `${name} not answering`, tone: "danger", loud: true, help: `${h.url} hasn't answered the last polls. Its alerts wait until it's back.` },
    );
  }
  const link = net.sendingHub?.link;
  if (link) {
    const waiting = `${link.queued} waiting`;
    chips.push(
      link.cut
        ? { key: "link", label: `Link cut · ${waiting}`, tone: "warn", loud: true, help: "The link between the hubs is cut. Alerts queue on the sending hub and all arrive when it's restored." }
        : { key: "link", label: `Link up · ${waiting}`, tone: "ok", help: "The link between the hubs is up. Waiting = alerts queued to send." },
    );
  }
  if (hasPeer) {
    const fp = agreement.fingerprint?.slice(0, 6);
    chips.push(
      agreement.agrees === true
        ? { key: "agree", label: `Hubs agree${fp ? ` · ${fp}` : ""}`, tone: "ok", help: `Both hubs hold exactly the same events: the same fingerprint (${agreement.fingerprint}) over every stored hash.` }
        : agreement.agrees === false
          ? { key: "agree", label: "Hubs catching up", tone: "warn", help: "The hubs hold different events right now. Normal for a second or two after new alerts or a restore." }
          : { key: "agree", label: "Agreement unknown", tone: "muted", help: "Can't compare the hubs while the link is cut or a hub isn't answering." },
    );
  }
  chips.push({
    key: "forgeries", label: `${net.forgeriesBlocked} ${net.forgeriesBlocked === 1 ? "forgery" : "forgeries"} blocked`, tone: "accent",
    help: "Events the hubs refused: unknown key, bad signature, replay, unsigned. Every one is listed with its reason.",
  });
  if (net.chain && !net.chain.chain_intact)
    chips.push({
      key: "chain", label: `Chain broken at ${net.chain.first_bad_event?.slice(0, 8) ?? "a row"}`, tone: "danger", loud: true,
      help: "A stored record was changed after it was written. The hash chain breaks at exactly that row; the other hub still holds the original.",
    });
  if (net.roster)
    chips.push(
      net.roster.require_signed
        ? { key: "signing", label: "Signing required", tone: "ok", help: "Hubs refuse anything not signed by a key on the roster." }
        : { key: "signing", label: "Signing optional", tone: "warn", help: "Hubs still accept unsigned posts (shown as not verified). Start them with --signed for the demo." },
    );
  return chips;
}

export function StatusChip({ chip }: { chip: Chip }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border bg-card px-2.5 py-1 font-mono text-xs text-foreground/85 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{ borderColor: chip.loud ? TONE[chip.tone] : "var(--border)" }}
        >
          <span className="size-2 shrink-0 rounded-full" style={{ background: TONE[chip.tone] }} aria-hidden="true" />
          {chip.label}
        </span>
      </TooltipTrigger>
      <TooltipContent>{chip.help}</TooltipContent>
    </Tooltip>
  );
}

export function AppBar({ net, className }: { net: Undercurrent; className?: string }) {
  const path = usePathname();
  const q = useCarriedQuery();
  const chips = useStatusChips(net);
  const phoneHub = net.sendingHub?.url;
  // ?phone=1: stay on the phone page on a wide screen (see components/desktop-redirect.tsx)
  const phones = phoneHub && net.mode === "live" ? `/?hub=${encodeURIComponent(phoneHub)}&phone=1` : "/?phone=1";

  const links = (
    <>
      {PAGES.map((p) => {
        const on = path === p.href || (p.href !== "/overview" && path?.startsWith(p.href));
        return (
          <Link
            key={p.href}
            href={`${p.href}${q}`}
            aria-current={on ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm transition-colors",
              on ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {p.label}
          </Link>
        );
      })}
      <Link href={phones} className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
        Phones
      </Link>
    </>
  );

  return (
    <TooltipProvider>
      <header className={cn("relative z-[var(--z-header)] shrink-0 border-b border-border bg-card", className)}>
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5 sm:px-6">
          <Link href={`/overview${q}`} className="flex items-center gap-2 text-foreground">
            <WavesIcon className="size-5 text-primary" aria-hidden="true" />
            <span className="font-mono text-xs font-medium tracking-[0.18em]">UNDERCURRENT</span>
          </Link>
          <nav aria-label="Pages" className="hidden items-center gap-1 md:flex">
            {links}
          </nav>
          <Sheet>
            <SheetTrigger className="ml-auto inline-flex size-10 items-center justify-center rounded-md border border-border-strong text-foreground md:hidden" aria-label="Open the page menu">
              <MenuIcon className="size-5" />
            </SheetTrigger>
            <SheetContent>
              <SheetTitle>Undercurrent</SheetTitle>
              <SheetDescription>Pages</SheetDescription>
              <nav aria-label="Pages" className="flex flex-col gap-1">
                {links}
              </nav>
            </SheetContent>
          </Sheet>
          <div className="flex w-full gap-1.5 overflow-x-auto pb-0.5 md:ml-auto md:w-auto md:flex-wrap md:justify-end md:overflow-visible md:pb-0">
            {chips.map((c) => (
              <StatusChip key={c.key} chip={c} />
            ))}
          </div>
        </div>
      </header>
    </TooltipProvider>
  );
}
