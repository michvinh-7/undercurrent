// Small building blocks shared by the Hollow panels.

export function Card({ title, children, right }: { title: React.ReactNode; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3.5 shadow-sm">
      <div className="mb-2 flex items-start gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <div className="ml-auto flex items-center gap-2">{right}</div>
      </div>
      {children}
    </section>
  );
}

export const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="flex justify-between gap-3 py-0.5 text-sm"><span className="text-[var(--muted)]">{k}</span><span className="text-right">{v}</span></div>
);

export const Btn = ({ onClick, children, tone }: { onClick: () => void; children: React.ReactNode; tone?: "danger" }) => (
  <button onClick={onClick} className={`mt-2 w-full rounded-md border px-3 py-1.5 text-sm transition hover:bg-[var(--panel-2)] ${tone === "danger" ? "border-[var(--danger)] text-[var(--danger)]" : "border-[var(--border-strong)]"}`}>{children}</button>
);

export const SimTag = () => <span className="ml-1 rounded bg-[color-mix(in_oklab,var(--sim)_14%,transparent)] px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-[var(--sim)]">Simulated</span>;

export function Fact({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-[7px] size-2 shrink-0 rounded-full" style={{ background: color }} />
      <span>{children}</span>
    </li>
  );
}

export const Swatch = ({ c, round, children }: { c: string; round?: boolean; children: React.ReactNode }) => (
  <li className="flex items-center gap-2"><span className={`size-3 shrink-0 ${round ? "rounded-full" : "rounded-sm"}`} style={{ background: c }} />{children}</li>
);
