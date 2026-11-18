// Test alerts: what each kind of Canary box will send, made on this page so the map can be
// built, checked and filmed before the hardware sends it. They're labelled "test" everywhere,
// never sent to a hub, and never count as verified.

import type { HollowEvent } from "@/lib/types";
import { SURFACE_DEVICE } from "../sensors";
import { Card } from "./ui";

export type TestPreset = "bad_air" | "blackout_soon" | "blackout_now" | "heat" | "flooding" | "surface";

const PRESETS: Record<TestPreset, { label: string; level: number; device: string; payload: Record<string, unknown> }> = {
  blackout_soon: { label: "Blackout warning, 20 min", level: 34, device: "canary-34", payload: { kind: "blackout", severity: "high", expected_in_min: 20, reading: { value: 168, unit: "V" }, note: "Supply voltage dropping" } },
  blackout_now: { label: "Blackout now", level: 34, device: "canary-34-school", payload: { kind: "blackout", severity: "high", note: "No mains power" } },
  bad_air: { label: "Bad air at the market", level: 34, device: "canary-34-market", payload: { kind: "bad_air", severity: "high", reading: { value: 1850, unit: "ppm CO₂" }, note: "Fan stalled, CO₂ rising" } },
  heat: { label: "Heat at the school", level: 34, device: "canary-34-school", payload: { kind: "heat", severity: "medium", reading: { value: 39, unit: "°C" } } },
  flooding: { label: "Flooding at the lift station", level: 34, device: "canary-34", payload: { kind: "flooding", severity: "high", note: "Water probe past threshold for 3 s" } },
  surface: { label: "Surface air reading", level: 1, device: SURFACE_DEVICE, payload: { kind: "other", severity: "low", reading: { value: 412, unit: "ppm CO₂" }, oxygen_pct: 20.9, note: "Surface intake, top of the shaft" } },
};

export const isPreset = (s: string): s is TestPreset => s in PRESETS;

export function testEvent(preset: TestPreset, now = Date.now()): HollowEvent {
  const p = PRESETS[preset];
  return {
    id: `test-${preset}-${now}`, type: "hazard", hub_id: `hub-L${p.level}`, level: p.level,
    created_at: new Date(now).toISOString(), author: p.device, priority: 0.8,
    payload: p.payload, prev_hash: "", hash: "", source: "sensor", device_id: p.device,
  };
}

export default function TestAlerts({ onSend, onClear, count }: { onSend: (p: TestPreset) => void; onClear: () => void; count: number }) {
  return (
    <Card title="Test a sensor alert" right={<span className="rounded bg-[var(--panel-2)] px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">Test</span>}>
      <p className="mb-2 text-xs text-[var(--muted)]">What each Canary box will send. Made on this page, never sent to a hub, never verified.</p>
      <div className="grid grid-cols-2 gap-1.5">
        {(Object.keys(PRESETS) as TestPreset[]).map((k) => (
          <button key={k} onClick={() => onSend(k)} className="rounded-md border border-[var(--border)] px-2 py-1.5 text-left text-xs hover:bg-[var(--panel-2)]">
            {PRESETS[k].label}
          </button>
        ))}
      </div>
      {count > 0 && (
        <button onClick={onClear} className="mt-2 w-full rounded-md border border-[var(--border-strong)] px-3 py-1.5 text-sm hover:bg-[var(--panel-2)]">
          Clear {count} test alert{count === 1 ? "" : "s"}
        </button>
      )}
    </Card>
  );
}
