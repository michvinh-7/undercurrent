"use client";

// Top bar: the level tabs (the only navigation), add a level, and the view controls.

import { useState } from "react";
import type { Undercurrent } from "@/lib/useUndercurrent";
import type { summarize } from "../adapter";
import { MAX_LEVEL, MIN_LEVEL, type CityWorld } from "../model";
import { SEVERITY_COLOR, type View } from "../scene/CityScene";

export default function TopBar(p: {
  net: Undercurrent; world: CityWorld; active: number; sums: Map<number, ReturnType<typeof summarize>>; view: View; setView: (v: View) => void;
  follow: boolean; setFollow: (b: boolean) => void; onLevel: (n: number) => void; onReset: () => void; onAdd: (n: number) => void;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <header className="relative z-[var(--z-header)] flex h-[52px] shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--panel)] px-3">
      <div className="flex shrink-0 items-baseline gap-2">
        <span className="text-[15px] font-semibold tracking-tight">The Hollow</span>
        <span className={`hidden rounded-full px-2 py-0.5 text-[11px] sm:inline ${p.net.mode === "live" ? "bg-[color-mix(in_oklab,var(--ok)_14%,transparent)] text-[var(--ok)]" : "bg-[var(--panel-2)] text-[var(--muted)]"}`}>
          {p.net.mode === "live" ? "● Live" : p.net.mode === "demo" ? "Demo data" : "Connecting…"}
        </span>
      </div>

      <nav className="flex min-w-0 items-center gap-1 overflow-x-auto" aria-label="Levels">
        {p.world.levels.map((l) => {
          const s = p.sums.get(l.n);
          const on = l.n === p.active;
          return (
            <button
              key={l.n}
              onClick={() => p.onLevel(l.n)}
              className={`flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition ${on ? "bg-[var(--foreground)] text-[var(--panel)]" : "text-[var(--muted)] hover:bg-[var(--panel-2)] hover:text-[var(--foreground)]"}`}
              aria-current={on ? "true" : undefined}
            >
              <span className="font-medium">L{l.n}</span>
              <span className="hidden lg:inline">{l.name}</span>
              {s?.worst && <span className="size-2 rounded-full" style={{ background: SEVERITY_COLOR[s.worst] }} title={`${s.total} event${s.total === 1 ? "" : "s"}`} />}
            </button>
          );
        })}
        <div className="relative shrink-0">
          <button onClick={() => setAdding((a) => !a)} className="rounded-md border border-dashed border-[var(--border-strong)] px-2.5 py-1.5 text-sm text-[var(--muted)] hover:text-[var(--foreground)]">
            + Add level
          </button>
          {adding && <AddLevel world={p.world} onAdd={(n) => { p.onAdd(n); setAdding(false); }} onClose={() => setAdding(false)} />}
        </div>
      </nav>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <div className="flex rounded-md border border-[var(--border)] p-0.5 text-xs">
          {(["3d", "top"] as View[]).map((v) => (
            <button key={v} onClick={() => p.setView(v)} className={`rounded px-2 py-1 ${p.view === v ? "bg-[var(--panel-2)] font-medium text-[var(--foreground)]" : "text-[var(--muted)]"}`}>
              {v === "3d" ? "3D" : "Top"}
            </button>
          ))}
        </div>
        <button onClick={p.onReset} className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted)] hover:text-[var(--foreground)]">Reset view</button>
        <label className="hidden items-center gap-1.5 text-xs text-[var(--muted)] lg:flex">
          <input type="checkbox" checked={p.follow} onChange={(e) => p.setFollow(e.target.checked)} /> Follow alerts
        </label>
      </div>
    </header>
  );
}

function AddLevel({ world, onAdd, onClose }: { world: CityWorld; onAdd: (n: number) => void; onClose: () => void }) {
  const have = new Set(world.levels.map((l) => l.n));
  const suggest = [...Array(MAX_LEVEL)].map((_, i) => i + 1).find((n) => !have.has(n) && n > Math.max(...have)) ?? 1;
  const [val, setVal] = useState(String(suggest));
  const n = Number(val);
  const error = !Number.isInteger(n) || n < MIN_LEVEL || n > MAX_LEVEL ? `Pick a level from ${MIN_LEVEL} to ${MAX_LEVEL}` : have.has(n) ? `L${n} is already on the map` : null;
  return (
    <div className="absolute left-0 top-[calc(100%+6px)] z-[var(--z-popover)] w-64 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3 shadow-lg">
      <form onSubmit={(e) => { e.preventDefault(); if (!error) onAdd(n); }} className="flex items-center gap-2">
        <label className="text-sm">Level</label>
        <input autoFocus value={val} onChange={(e) => setVal(e.target.value)} inputMode="numeric" className="w-16 rounded border border-[var(--border-strong)] bg-[var(--panel)] px-2 py-1 text-sm" />
        <button disabled={!!error} className="rounded bg-[var(--foreground)] px-2.5 py-1 text-sm text-[var(--panel)] disabled:opacity-40">Add</button>
        <button type="button" onClick={onClose} className="ml-auto text-xs text-[var(--muted)]">Close</button>
      </form>
      <p className={`mt-2 text-xs ${error ? "text-[var(--danger)]" : "text-[var(--muted)]"}`}>
        {error ?? "Generates its streets, buildings and pipes from the seed and joins it to the riser. Levels already on the map don't change."}
      </p>
    </div>
  );
}
