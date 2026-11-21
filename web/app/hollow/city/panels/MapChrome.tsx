"use client";

// Everything that floats on the map itself: collapse buttons, the map key. Keep this small;
// anything that explains goes in the side columns, not on top of the map.

import { useState } from "react";
import type { LayerId, Layers } from "../scene/CityScene";
import { Swatch } from "./ui";

const LAYER_LIST: { id: LayerId; label: string }[] = [
  { id: "buildings", label: "Buildings" },
  { id: "xray", label: "X-ray" },
  { id: "water", label: "Water" },
  { id: "network", label: "Hubs & link" },
  { id: "alerts", label: "Alerts" },
  { id: "sensors", label: "Sensors" },
];

export function PaneToggle({ side, open, onClick }: { side: "left" | "right"; open: boolean; onClick: () => void }) {
  const arrow = (side === "left") === open ? "‹" : "›";
  return (
    <button
      onClick={onClick}
      aria-label={`${open ? "Hide" : "Show"} the ${side} panel`}
      title={`${open ? "Hide" : "Show"} panel`}
      className={`absolute top-3 z-[var(--z-map-ui)] hidden size-7 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--panel)] text-base leading-none text-[var(--muted)] shadow-sm hover:text-[var(--foreground)] ${side === "left" ? "left-3 md:flex" : "right-3 xl:flex"}`}
    >
      {arrow}
    </button>
  );
}

export function MapKey() {
  const [open, setOpen] = useState(false);
  return (
    <div className="absolute bottom-14 right-3 z-[var(--z-map-ui)] flex flex-col items-end gap-2 lg:bottom-3">
      {open && (
        <div className="z-[var(--z-popover)] max-h-[60vh] w-72 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3.5 text-xs shadow-lg">
          <LegendBody />
        </div>
      )}
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="rounded-full border border-[var(--border)] bg-[var(--panel)] px-3 py-1 text-xs shadow-sm hover:bg-[var(--panel-2)]">
        {open ? "Close key" : "? Map key"}
      </button>
    </div>
  );
}

function LegendBody() {
  return (
    <>
      <p className="font-semibold text-[var(--foreground)]">How to read this map</p>
      <ul className="mt-2 space-y-1.5">
        <Swatch c="#5e667e">Homes and workshops (grey roofs)</Swatch>
        <Swatch c="#9a5f55">Clinics and hospitals</Swatch>
        <Swatch c="#5f7d6b">Shelters</Swatch>
        <Swatch c="#3b82c4">Pipe carrying water; arrows show which way it flows</Swatch>
        <Swatch c="#c98f2e">Building cut off from water (simulated)</Swatch>
        <Swatch c="#9bc53d">Gets water through the likely bad-water source (a guess)</Swatch>
        <Swatch c="#62605b">No dry way to the stairs during a flood</Swatch>
        <Swatch c="#2fbf8f">Safest walking route</Swatch>
        <Swatch c="#c2412d" round>Pin: a sensor alert at a known spot. Faded = not verified.</Swatch>
      </ul>
      <p className="mt-2 text-[var(--muted)]">
        Streets, buildings and pipes are <b>generated</b>. Hubs, the link and alerts are <b>live</b> from the hubs.
        Reports only say which level they came from, so they're listed, not pinned. Drag to pan, right-drag to rotate, scroll to zoom.
      </p>
    </>
  );
}

/** Layer switches, bottom-left of the map. Solid = shown, outlined = hidden. */
export function LayerBar({ layers, onToggle }: { layers: Layers; onToggle: (id: LayerId) => void }) {
  return (
    <div className="absolute bottom-3 left-3 z-[var(--z-map-ui)] flex flex-wrap items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--panel)]/95 p-1 shadow-sm backdrop-blur">
      <span className="hidden px-2 text-[11px] text-[var(--muted)] sm:inline">Show</span>
      {LAYER_LIST.map((l) => (
        <button
          key={l.id}
          onClick={() => onToggle(l.id)}
          className={`rounded-full border px-2.5 py-0.5 text-xs transition ${layers[l.id] ? "border-[var(--foreground)] bg-[var(--foreground)] text-[var(--panel)]" : "border-[var(--border-strong)] bg-transparent text-[var(--muted)] hover:text-[var(--foreground)]"}`}
          aria-pressed={layers[l.id]}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}

/** Banners across the top of the map: simulation (purple, with Exit, plus a purple frame) and demo data. */
export function MapBanners({ sim, demo, onExit }: { sim: string | null; demo: boolean; onExit: () => void }) {
  return (
    <>
      <div className="pointer-events-none absolute inset-x-12 top-3 z-[var(--z-map-ui)] flex flex-col items-center gap-1.5">
        {sim && (
          <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full border border-[var(--sim)] bg-[var(--panel)] py-1 pl-3 pr-1 text-xs shadow-sm">
            <span className="font-semibold uppercase tracking-wide text-[var(--sim)]">Simulation</span>
            <span className="truncate text-[var(--foreground)]">{sim} · not real readings</span>
            <button onClick={onExit} className="shrink-0 rounded-full bg-[var(--sim)] px-2.5 py-0.5 font-medium text-white hover:opacity-90">Exit</button>
          </div>
        )}
        {demo && (
          <div className="max-w-full truncate rounded-full border border-[var(--warn)] bg-[var(--panel)] px-3 py-1 text-xs text-[var(--warn)] shadow-sm">
            Demo data: no hub reachable. Pass <code>?hub=</code> to go live.
          </div>
        )}
      </div>
      {sim && <div className="pointer-events-none absolute inset-0 z-[var(--z-map-ui)] border-2 border-[var(--sim)]" aria-hidden />}
    </>
  );
}
