import { fakeEvents } from "@/lib/fake-events";

// Placeholder home: shows the fake events by priority so everyone can see the format.
// Person 3 builds the phone pages, Person 4 builds the dashboard.
export default function Home() {
  const queue = [...fakeEvents].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <p className="font-mono text-xs uppercase tracking-widest text-[var(--muted)]">Hub online · offline-first</p>
      <h1 className="mt-2 text-3xl font-semibold">Undercurrent</h1>
      <p className="mt-2 text-[var(--muted)]">The Hollow&apos;s network the Directorate can&apos;t shut off.</p>

      <h2 className="mt-10 font-mono text-sm uppercase tracking-widest text-[var(--muted)]">Priority queue (fake data)</h2>
      <ul className="mt-3 space-y-2">
        {queue.map((e) => (
          <li
            key={e.id}
            className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--panel)] px-4 py-3"
          >
            <span>
              <span className="font-mono text-xs uppercase text-[var(--accent)]">{e.type}</span>
              <span className="ml-3">Level {e.level}</span>
            </span>
            <span className="font-mono text-sm">{(e.priority ?? 0).toFixed(2)}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
