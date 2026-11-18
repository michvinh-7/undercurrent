// The "What if" tab: break a pipe or stop a pump in the generated network and see who loses water.
// Always simulated, always labelled.

import { buildingById, FACILITY_USES, scenariosFor, type CityWorld, type Failure, type solveWater } from "../model";
import { Card, SimTag } from "./ui";

export default function WhatIf({ world, level, sim, setSim, water }: {
  world: CityWorld; level: number; sim: { label: string; failure: Failure } | null; setSim: (s: { label: string; failure: Failure } | null) => void; water: ReturnType<typeof solveWater>;
}) {
  const list = scenariosFor(world, level);
  const dry = [...water.dry.keys()].map((id) => buildingById(world, id)!).filter(Boolean);
  const people = dry.reduce((s, b) => s + b.residents, 0);
  const levels = [...new Set(dry.map((b) => b.level))].sort((a, b) => a - b);
  const facilities = dry.filter((b) => FACILITY_USES.includes(b.use) && b.use !== "pumphouse");
  const active = sim && (sim.failure.nodes?.length || sim.failure.pipes?.length);
  return (
    <Card title="What if…" right={<SimTag />}>
      {!active && (
        <div className="flex flex-col gap-1.5">
          {list.map((s) => (
            <button key={s.id} onClick={() => setSim({ label: s.label, failure: s.failure })} className="rounded-md border border-[var(--border)] px-3 py-1.5 text-left text-sm hover:bg-[var(--panel-2)]">
              {s.label}
            </button>
          ))}
          <p className="text-xs text-[var(--muted)]">Or click any pipe or lift station on the map. Uses the generated network, not real readings.</p>
        </div>
      )}
      {active && (
        <div className="sim-hatch -m-1 rounded-lg p-1">
          <p className="text-sm font-medium">{sim!.label}</p>
          <ul className="mt-1.5 space-y-0.5 text-sm">
            <li><b>{dry.length}</b> buildings lose water{levels.length ? ` on ${levels.map((n) => `L${n}`).join(", ")}` : ""}</li>
            <li>About <b>{people.toLocaleString()}</b> people (generated estimate)</li>
            {facilities.length > 0 && <li className="text-[var(--danger)]">Hit: {facilities.map((b) => b.name).join(", ")}</li>}
          </ul>
          <button onClick={() => setSim(null)} className="mt-2 w-full rounded-md border border-[var(--border-strong)] bg-[var(--panel)] px-3 py-1.5 text-sm hover:bg-[var(--panel-2)]">Clear simulation</button>
        </div>
      )}
    </Card>
  );
}
