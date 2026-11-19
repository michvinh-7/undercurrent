import Link from "next/link";
import { RememberHub } from "@/components/phone";

// The hub's home page on a resident's phone: pick what to report.
const REPORTS = [
  { href: "/checkin", title: "Check in", hint: "I'm OK, or I need help" },
  { href: "/hazard", title: "Report a hazard", hint: "Flooding, bad air, collapse…" },
  { href: "/symptoms", title: "Report symptoms", hint: "Someone is sick or hurt" },
  { href: "/missing", title: "Missing person", hint: "Someone you can't find" },
  { href: "/cell", title: "Cell messages", hint: "Encrypted: only your cell can read them" },
];

export default function Home() {
  return (
    <main className="mx-auto max-w-md px-4 pb-16 pt-8">
      <RememberHub />
      <p className="font-mono text-xs uppercase tracking-widest text-[var(--muted)]">Undercurrent · works without internet</p>
      <h1 className="mt-2 text-3xl font-semibold">What do you need to report?</h1>
      <ul className="mt-6 space-y-3">
        {REPORTS.map((r) => (
          <li key={r.href}>
            <Link
              href={r.href}
              className="block rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 py-4 active:border-[var(--accent)]"
            >
              <span className="block text-lg font-semibold">{r.title}</span>
              <span className="block text-[var(--muted)]">{r.hint}</span>
            </Link>
          </li>
        ))}
      </ul>
      <Link href="/join" className="mt-6 block rounded-xl border border-dashed border-[var(--border)] px-4 py-3 text-[var(--muted)]">
        Join a cell: show your key to an operator →
      </Link>
      <Link href="/overview" className="mt-6 inline-block py-2 text-sm text-[var(--muted)]">
        Overview for judges →
      </Link>
    </main>
  );
}
