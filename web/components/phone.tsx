"use client";

// Shared building blocks for the resident phone pages (Person 3).
// Big tap targets, 16px+ text (stops iOS zooming into inputs), works at 360px wide.

import Link from "next/link";
import { useEffect, useState } from "react";
import { addEvent } from "@/lib/hub";
import type { EventType } from "@/lib/types";

/** localStorage-backed state. Falls back to memory if storage is blocked (private mode). */
export function useStored<T>(key: string, initial: T | (() => T)) {
  const [value, setValue] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) setValue(JSON.parse(raw));
      else localStorage.setItem(key, JSON.stringify(typeof initial === "function" ? (initial as () => T)() : initial));
    } catch {}
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

export function PhoneShell({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-md px-4 pb-16 pt-6">
      <Link href="/" className="inline-block py-2 text-sm text-[var(--muted)]">
        ← All reports
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">{title}</h1>
      {hint && <p className="mt-1 text-[var(--muted)]">{hint}</p>}
      <div className="mt-6">{children}</div>
    </main>
  );
}

export function Label({ children, optional }: { children: React.ReactNode; optional?: boolean }) {
  return (
    <span className="mb-2 block text-sm font-medium">
      {children}
      {optional && <span className="ml-1 font-normal text-[var(--muted)]">(optional)</span>}
    </span>
  );
}

const inputClass =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-3 text-base outline-none focus:border-[var(--accent)]";

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={inputClass} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...props} className={inputClass} />;
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
            className="min-h-12 rounded-lg border px-3 py-3 text-base"
            style={{
              borderColor: on ? tone : "var(--border)",
              background: on ? `color-mix(in srgb, ${tone} 18%, var(--panel))` : "var(--panel)",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

type Sent = { state: "idle" } | { state: "sending" } | { state: "sent"; hub: string } | { state: "error"; message: string };

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
  const ready = payload !== null && level !== null && sent.state !== "sending";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setSent({ state: "sending" });
    try {
      const saved = await addEvent({ type, level: level!, author, payload: payload! });
      setSent({ state: "sent", hub: saved.hub_id });
      onSent?.();
    } catch {
      setSent({ state: "error", message: "Couldn't reach the hub. Your report was not sent. Check you're on the hub's Wi-Fi and try again." });
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <label className="block">
        <Label>Your level</Label>
        <select
          value={level ?? ""}
          onChange={(e) => setLevel(e.target.value ? Number(e.target.value) : null)}
          className={inputClass}
          required
        >
          <option value="">Choose your level</option>
          {Array.from({ length: 40 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              Level {n}
            </option>
          ))}
        </select>
      </label>

      {children}

      <button
        type="submit"
        disabled={!ready}
        className="min-h-14 w-full rounded-lg bg-[var(--accent)] px-4 text-lg font-semibold text-white disabled:opacity-40"
      >
        {sent.state === "sending" ? "Sending…" : "Send report"}
      </button>

      <div aria-live="polite">
        {sent.state === "sent" && (
          <p className="rounded-lg border border-[var(--ok)] px-3 py-3">
            Sent. Saved on {sent.hub}. You can send another.
          </p>
        )}
        {sent.state === "error" && <p className="rounded-lg border border-[var(--danger)] px-3 py-3">{sent.message}</p>}
      </div>

      <p className="text-xs text-[var(--muted)]">Sent as {author}. Your real name is never attached unless you type it.</p>
    </form>
  );
}
