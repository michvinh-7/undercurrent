// Right column: one tab bar for the details. Feed (everything the hubs received), Selected
// (whatever was clicked on the map), What if (the simulation sandbox).

export type Tab = "feed" | "selected" | "whatif";

export default function SideTabs({ tab, setTab, hasSelection, simOn, count, selected, whatIf, feed }: {
  tab: Tab; setTab: (t: Tab) => void; hasSelection: boolean; simOn: boolean; count: number;
  selected: React.ReactNode; whatIf: React.ReactNode; feed: React.ReactNode;
}) {
  const shown: Tab = tab === "selected" && !hasSelection ? "feed" : tab;
  const items: { id: Tab; label: string; badge?: React.ReactNode; disabled?: boolean }[] = [
    { id: "feed", label: "Feed", badge: count ? <span className="tabular-nums text-[var(--faint)]">{count}</span> : null },
    { id: "selected", label: "Selected", disabled: !hasSelection, badge: hasSelection && shown !== "selected" ? <span className="size-1.5 rounded-full bg-[var(--accent)]" /> : null },
    { id: "whatif", label: "What if", badge: simOn ? <span className="size-1.5 rounded-full bg-[var(--sim)]" /> : null },
  ];
  return (
    <>
      <div role="tablist" aria-label="Details" className="flex rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-0.5 text-sm">
        {items.map((t) => (
          <button
            key={t.id} role="tab" aria-selected={shown === t.id} disabled={t.disabled}
            onClick={() => setTab(t.id)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 transition disabled:opacity-40 ${shown === t.id ? "bg-[var(--panel)] font-medium text-[var(--foreground)] shadow-sm" : "text-[var(--muted)] hover:text-[var(--foreground)]"}`}
          >
            {t.label}{t.badge}
          </button>
        ))}
      </div>
      <div role="tabpanel">{shown === "selected" ? selected : shown === "whatif" ? whatIf : feed}</div>
    </>
  );
}
