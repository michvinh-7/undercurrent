// The same header on every laptop page, so a judge knows in one glance what the page is,
// which of the brief's 15 questions it answers, and what it proves; and the numbered zone
// label that groups each page's panels. Shared by the console, the map, the Directorate
// view and the overview.

import { cn } from "@/lib/utils";

export function QuestionChips({ questions, className }: { questions: number[]; className?: string }) {
  if (!questions.length) return null;
  return (
    <span className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <span className="font-mono text-[11px] text-muted-foreground">answers</span>
      {questions.map((q) => (
        <span key={q} className="rounded-full border border-border-strong px-2 py-px font-mono text-[11px] text-foreground/85">
          Q{q}
        </span>
      ))}
    </span>
  );
}

export function PageIntro({
  kicker,
  questions = [],
  title,
  sub,
  kickerColor = "var(--accent)",
  actions,
  right,
  className,
}: {
  kicker: string;
  questions?: number[];
  title: React.ReactNode;
  sub?: React.ReactNode;
  kickerColor?: string;
  /** Small controls beside the kicker (a live badge, a toggle). */
  actions?: React.ReactNode;
  /** The page's key numbers, beside the title on wide screens and under it on narrow ones. */
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-end gap-x-8 gap-y-5", className)}>
      <div className="flex min-w-0 flex-[999_1_440px] flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="font-mono text-[11px] uppercase tracking-[0.16em]" style={{ color: kickerColor }}>{kicker}</span>
          <QuestionChips questions={questions} />
          {actions && <span className="ml-auto flex flex-wrap items-center gap-3">{actions}</span>}
        </div>
        <h1 className="text-balance text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">{title}</h1>
        {sub && <p className="max-w-[78ch] text-[15px] text-foreground/70">{sub}</p>}
      </div>
      {right && <div className="min-w-0 flex-[1_1_680px]">{right}</div>}
    </header>
  );
}

/** A numbered group of panels with what it proves, in one line. */
export function Zone({
  n,
  title,
  note,
  children,
  className,
  id,
}: {
  n: number | string;
  title: React.ReactNode;
  note?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("flex min-w-0 flex-col gap-2.5", className)}>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
        <span className="font-mono text-xs text-primary">{n}</span>
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {note && <span className="text-[12.5px] text-muted-foreground">{note}</span>}
      </div>
      {children}
    </section>
  );
}

/** One line for full-height pages (the 3D map): kicker, claim, questions, and a legend. */
export function PageIntroSlim({
  kicker,
  title,
  questions = [],
  legend = [],
}: {
  kicker: string;
  title: React.ReactNode;
  questions?: number[];
  legend?: { label: string; color: string; mark?: "dot" | "line" | "square" }[];
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-[var(--border)] bg-[var(--panel)] px-4 py-2">
      <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--accent)]">{kicker}</span>
      <span className="text-[15px] font-semibold">{title}</span>
      <QuestionChips questions={questions} className="hidden md:flex" />
      {legend.length > 0 && (
        <span className="ml-auto hidden flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-[var(--muted)] lg:flex" aria-label="Legend">
          {legend.map((l) => (
            <span key={l.label} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={l.mark === "line" ? "h-0.5 w-3.5 rounded" : l.mark === "square" ? "size-2.5 rounded-sm" : "size-2 rounded-full"}
                style={{ background: l.color }}
              />
              {l.label}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}
