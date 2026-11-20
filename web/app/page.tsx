import Link from "next/link";
import { ArrowRightLeftIcon, ChevronRightIcon, LockKeyholeIcon, QrCodeIcon, StethoscopeIcon, TriangleAlertIcon, UserCheckIcon, UserSearchIcon } from "lucide-react";
import { PhoneHeader, RememberHub } from "@/components/phone";

// The hub's home page on a resident's phone: pick what to report.
const REPORTS = [
  { href: "/checkin", title: "Check in", hint: "I'm OK, or I need help", icon: UserCheckIcon },
  { href: "/hazard", title: "Report a hazard", hint: "Flooding, bad air, collapse…", icon: TriangleAlertIcon },
  { href: "/symptoms", title: "Report symptoms", hint: "Someone is sick or hurt", icon: StethoscopeIcon },
  { href: "/missing", title: "Missing person", hint: "Someone you can't find", icon: UserSearchIcon },
  { href: "/exchange", title: "Have / Need", hint: "Share space, food, water, medicine, power", icon: ArrowRightLeftIcon },
];

function Row({ href, title, hint, icon: Icon, accent }: { href: string; title: string; hint: string; icon: typeof UserCheckIcon; accent?: boolean }) {
  return (
    <Link
      href={href}
      className="flex min-h-16 items-center gap-3.5 rounded-xl border border-border bg-card px-4 py-3.5 transition-colors hover:border-border-strong active:border-primary"
    >
      <span
        className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background"
        style={{ color: accent ? "var(--accent)" : "var(--foreground)" }}
        aria-hidden="true"
      >
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-lg font-semibold leading-snug">{title}</span>
        <span className="block text-muted-foreground">{hint}</span>
      </span>
      <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}

export default function Home() {
  return (
    <div className="min-h-[100dvh] bg-background">
      <RememberHub />
      <PhoneHeader />
      <main className="mx-auto flex max-w-md flex-col gap-8 px-4 pb-16 pt-7">
        <div>
          <p className="caption">Works without internet · Signed on this phone</p>
          <h1 className="mt-2 text-balance text-3xl font-semibold tracking-tight">What do you need to report?</h1>
        </div>

        <section className="flex flex-col gap-2.5" aria-label="Reports">
          {REPORTS.map((r) => (
            <Row key={r.href} {...r} />
          ))}
        </section>

        <section className="flex flex-col gap-2.5" aria-label="Your cell">
          <p className="caption">Your cell</p>
          <Row href="/cell" title="Cell messages" hint="Encrypted: only your cell can read them" icon={LockKeyholeIcon} accent />
          <Link
            href="/join"
            className="flex items-center gap-3.5 rounded-xl border border-dashed border-border-strong px-4 py-3.5 text-foreground/80 transition-colors hover:text-foreground"
          >
            <QrCodeIcon className="size-5 shrink-0 text-primary" aria-hidden="true" />
            <span className="min-w-0 flex-1">Join a cell: show your key to an operator</span>
            <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          </Link>
        </section>

        <Link href="/overview" className="self-start py-2 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          Overview for judges →
        </Link>
      </main>
    </div>
  );
}
