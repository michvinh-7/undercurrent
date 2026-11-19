"use client";

// Shared building blocks for the resident phone pages (Person 3).
// Big tap targets, 16px+ text (stops iOS zooming into inputs), works at 360px wide.
// Same look as the laptop pages: the UNDERCURRENT wordmark, mono captions, the dark
// tokens, and a status chip saying whether this phone reaches the hub and signs.

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeftIcon, CheckIcon, CircleAlertIcon, CircleCheckIcon, LoaderCircleIcon, SendIcon, ShieldCheckIcon, WavesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addEvent, hubUrl } from "@/lib/hub";
import { hubSigningInfo, loadIdentity, NotJoinedError, prepare } from "@/lib/sign";
import type { EventType } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * localStorage-backed state. Falls back to memory if storage is blocked (private mode).
 * A function `initial` (e.g. a random handle) runs only in the browser, after the page
 * loads: running it during render would give the server and the browser different
 * values and break hydration. Until then the value is undefined.
 */
export function useStored<T>(key: string, initial: T | (() => T)) {
  const lazy = typeof initial === "function";
  const [value, setValue] = useState<T>(lazy ? (undefined as T) : (initial as T));
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let next: T | undefined;
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) next = JSON.parse(raw);
    } catch {}
    if (next === undefined && lazy) next = (initial as () => T)();
    if (next !== undefined) setValue(next);
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }, [key, value, loaded]);
  return [value, setValue] as const;
}

const newHandle = () => `anon-${Math.random().toString(16).slice(2, 6)}`;

/**
 * Saves a ?hub=URL from the address bar on this phone (lib/hub.ts), on pages that don't
 * otherwise talk to the hub, like the home page the setup link opens.
 */
export function RememberHub() {
  useEffect(() => {
    hubUrl();
  }, []);
  return null;
}

type HubChip = { state: "checking" } | { state: "down" } | { state: "up"; hubId: string; member: boolean; requireSigned: boolean };

/** Is the hub reachable, and is this phone on its roster? Polled every 5 s. */
export function usePhoneHub(): HubChip {
  const [chip, setChip] = useState<HubChip>({ state: "checking" });
  useEffect(() => {
    let stop = false;
    async function check() {
      try {
        const info = await hubSigningInfo(hubUrl());
        const me = loadIdentity();
        if (!stop) setChip({ state: "up", hubId: info.hubId, member: info.members.has(me.pub), requireSigned: info.requireSigned });
      } catch {
        if (!stop) setChip({ state: "down" });
      }
    }
    check();
    const t = setInterval(check, 5000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);
  return chip;
}

function HubStatusChip() {
  const hub = usePhoneHub();
  const [tone, label] =
    hub.state === "checking"
      ? ["var(--muted)", "Finding the hub…"]
      : hub.state === "down"
        ? ["var(--danger)", "Hub not reachable"]
        : hub.member
          ? ["var(--ok)", `${hub.hubId} · signed`]
          : [hub.requireSigned ? "var(--warn)" : "var(--muted)", `${hub.hubId} · not joined`];
  return (
    <Link
      href="/join"
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-background px-2.5 py-1 font-mono text-xs text-foreground/85"
      aria-label={`Hub status: ${label}. Open Join a cell.`}
    >
      <span className="size-2 rounded-full" style={{ background: tone }} aria-hidden="true" />
      {label}
    </Link>
  );
}

/** The thin bar at the top of every phone page: wordmark and the hub chip. */
export function PhoneHeader() {
  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex max-w-md items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 text-foreground">
          <WavesIcon className="size-5 text-primary" aria-hidden="true" />
          <span className="font-mono text-xs font-medium tracking-[0.18em]">UNDERCURRENT</span>
        </Link>
        <HubStatusChip />
      </div>
    </header>
  );
}

export function PhoneShell({
  title,
  hint,
  icon,
  eyebrow = "Report",
  children,
}: {
  title: string;
  hint?: string;
  icon?: React.ReactNode;
  eyebrow?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-[100dvh] bg-background">
      <RememberHub />
      <PhoneHeader />
      <main className="mx-auto max-w-md px-4 pb-16 pt-4">
        <Link href="/" className="-ml-1 inline-flex min-h-11 items-center gap-1.5 rounded-md px-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon className="size-4" aria-hidden="true" /> All reports
        </Link>
        <div className="mt-3 flex items-start gap-3">
          {icon && (
            <span className="mt-1 flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-primary [&_svg]:size-5" aria-hidden="true">
              {icon}
            </span>
          )}
          <div className="min-w-0">
            <p className="caption">{eyebrow}</p>
            <h1 className="mt-1 text-balance text-2xl font-semibold tracking-tight">{title}</h1>
          </div>
        </div>
        {hint && <p className="mt-2 text-foreground/70">{hint}</p>}
        <div className="mt-6">{children}</div>
      </main>
    </div>
  );
}

export function Label({ children, optional }: { children: React.ReactNode; optional?: boolean }) {
  return (
    <span className="mb-2 block text-sm font-medium">
      {children}
      {optional && <span className="ml-1.5 font-normal text-muted-foreground">(optional)</span>}
    </span>
  );
}

export const inputClass =
  "w-full rounded-lg border border-border bg-card px-3 py-3 text-base text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus-visible:ring-2 focus-visible:ring-ring/40";

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(inputClass, props.className)} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...props} className={cn(inputClass, props.className)} />;
}

/** A row of big buttons where one (or several, with `multi`) can be picked. */
export function Choice<T extends string>({
  options,
  value,
  onChange,
  columns = 2,
}: {
  options: { value: T; label: string; tone?: "danger" | "ok" }[];
  value: T | T[] | null;
  onChange: (v: T) => void;
  columns?: number;
}) {
  const picked = (v: T) => (Array.isArray(value) ? value.includes(v) : value === v);
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {options.map((o) => {
        const on = picked(o.value);
        const tone = o.tone === "danger" ? "var(--danger)" : o.tone === "ok" ? "var(--ok)" : "var(--accent)";
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className="flex min-h-12 items-center justify-center gap-1.5 rounded-lg border px-3 py-3 text-base transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            style={{
              borderColor: on ? tone : "var(--border)",
              background: on ? `color-mix(in srgb, ${tone} 16%, var(--panel))` : "var(--panel)",
              color: on ? "var(--foreground)" : "color-mix(in srgb, var(--foreground) 85%, transparent)",
            }}
          >
            {on && <CheckIcon className="size-4 shrink-0" style={{ color: tone }} aria-hidden="true" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

type Sent =
  | { state: "idle" }
  | { state: "sending" }
  | { state: "sent"; hub: string; signed: boolean }
  | { state: "error"; message: string; join?: boolean };

/** What to tell the resident when a report didn't go through. */
function sendError(err: unknown): Sent {
  if (err instanceof NotJoinedError)
    return { state: "error", join: true, message: "Not sent: this hub only takes reports from members, and this phone isn't on its roster yet. Show your join code to an operator." };
  const text = err instanceof Error ? err.message : "";
  const refused = /^Hub returned 403: (.*)$/.exec(text);
  if (refused)
    return { state: "error", join: /unknown key/.test(refused[1]), message: `Not sent: the hub refused it (${refused[1]}).` };
  return { state: "error", message: "Couldn't reach the hub. Your report was not sent. Check you're on the hub's Wi-Fi and try again." };
}

/**
 * Wraps a report: the resident's level (remembered), their anonymous handle, and the submit button.
 * `payload` is null while the form is incomplete.
 */
export function ReportForm({
  type,
  payload,
  onSent,
  children,
}: {
  type: EventType;
  payload: Record<string, unknown> | null;
  onSent?: () => void;
  children: React.ReactNode;
}) {
  const [level, setLevel] = useStored<number | null>("uc-level", null);
  const [author] = useStored("uc-author", newHandle);
  const [sent, setSent] = useState<Sent>({ state: "idle" });
  const ready = payload !== null && level !== null && !!author && sent.state !== "sending";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setSent({ state: "sending" });
    try {
      // Signed with this phone's key once it's on the roster (lib/sign.ts).
      const { event, signed } = await prepare({ type, level: level!, author, payload: payload! }, hubUrl());
      const saved = await addEvent(event);
      setSent({ state: "sent", hub: saved.hub_id, signed });
      onSent?.();
    } catch (err) {
      setSent(sendError(err));
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <LevelSelect level={level} setLevel={setLevel} />

      {children}

      <Button type="submit" size="lg" disabled={!ready} className="h-14 w-full text-lg font-semibold">
        {sent.state === "sending" ? (
          <>
            <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> Sending…
          </>
        ) : (
          <>
            <SendIcon aria-hidden="true" /> Send report
          </>
        )}
      </Button>

      <div aria-live="polite">
        {sent.state === "sent" && (
          <Notice tone="ok" icon={<CircleCheckIcon />}>
            Sent{sent.signed ? " and signed by this phone" : ""}. Saved on {sent.hub}. You can send another.
          </Notice>
        )}
        {sent.state === "error" && (
          <Notice tone="danger" icon={<CircleAlertIcon />}>
            {sent.message}
            {sent.join && (
              <>
                {" "}
                <Link href="/join" className="font-medium underline">
                  Show my join code
                </Link>
              </>
            )}
          </Notice>
        )}
      </div>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheckIcon className="size-3.5 shrink-0" aria-hidden="true" />
        Sent as {author ?? "an anonymous handle"}. Your real name is never attached unless you type it.
      </p>
    </form>
  );
}

/** Level picker, remembered on this phone. Shared by the reports and the cell page. */
export function LevelSelect({ level, setLevel }: { level: number | null; setLevel: (n: number | null) => void }) {
  return (
    <label className="block">
      <Label>Your level</Label>
      <select value={level ?? ""} onChange={(e) => setLevel(e.target.value ? Number(e.target.value) : null)} className={inputClass} required>
        <option value="">Choose your level</option>
        {Array.from({ length: 40 }, (_, i) => i + 1).map((n) => (
          <option key={n} value={n}>
            Level {n}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A result line under a form: green for done, red for a problem. */
export function Notice({ tone, icon, children }: { tone: "ok" | "danger" | "warn"; icon?: React.ReactNode; children: React.ReactNode }) {
  const c = tone === "ok" ? "var(--ok)" : tone === "warn" ? "var(--warn)" : "var(--danger)";
  return (
    <div
      className="flex items-start gap-2.5 rounded-lg border px-3 py-3 [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0"
      style={{ borderColor: c, background: `color-mix(in srgb, ${c} 10%, var(--panel))` }}
    >
      {icon && <span style={{ color: c }} className="mt-0.5 [&_svg]:size-4">{icon}</span>}
      <p className="min-w-0">{children}</p>
    </div>
  );
}
