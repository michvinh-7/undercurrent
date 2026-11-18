"use client";

// The "Selected" tab: details for whatever was clicked (building, pipe, hub or report).

import { summary, timeAgo } from "@/lib/format";
import type { Undercurrent } from "@/lib/useUndercurrent";
import { SEVERITY_LABEL, type MapEvent } from "../adapter";
import { buildingById, nameOf, USE_LABEL, type CityWorld, type Failure, type solveWater } from "../model";
import { pinTitle, SEVERITY_COLOR, type HubView, type Selection } from "../scene/CityScene";
import { Btn, Card, Row, SimTag } from "./ui";

export default function Inspector({ world, selection, events, water, net, hubs, onClose, onFocus, onSim, sim }: {
  world: CityWorld; selection: Selection; events: MapEvent[]; water: ReturnType<typeof solveWater>; net: Undercurrent; hubs: HubView[];
  onClose: () => void; onFocus: () => void; onSim: (label: string, f: Failure) => void; sim: { label: string; failure: Failure } | null;
}) {
  const close = (
    <>
      <button onClick={onFocus} className="text-xs text-[var(--muted)] hover:text-[var(--foreground)]">Zoom to</button>
      <button onClick={onClose} className="text-xs text-[var(--muted)] hover:text-[var(--foreground)]" aria-label="Close">✕</button>
    </>
  );
  const cause = (id: string) => nameOf(world, id);

  if (selection.type === "building") {
    const b = buildingById(world, selection.id);
    if (!b) return null;
    const tap = world.network.tapOf.get(b.id);
    const dry = water.dry.get(b.id);
    return (
      <Card title={b.use === "housing" || b.use === "workshop" ? USE_LABEL[b.use] : b.name} right={close}>
        <p className="mb-2 text-xs text-[var(--muted)]">L{b.level} · generated building</p>
        <Row k="Water" v={dry ? <span className="text-[var(--warn)]">None: {cause(dry)} <SimTag /></span> : <span className="text-[var(--ok)]">Supplied</span>} />
        {b.residents > 0 && <Row k="People (estimate)" v={b.residents} />}
        <Row k="Height" v={`${b.height} m`} />
        {tap && <Row k="Fed by" v={nameOf(world, tap.pipe)} />}
        {tap && !dry && <Btn onClick={() => onSim(`${nameOf(world, tap.pipe)} breaks`, { pipes: [tap.pipe] })}>What if its main breaks?</Btn>}
      </Card>
    );
  }
  if (selection.type === "pipe" || selection.type === "node") {
    const id = selection.id;
    const pipe = world.network.pipe.get(id), node = world.network.node.get(id);
    const label = pipe?.label ?? node?.label ?? id;
    const failed = water.failed.has(id);
    const ok = pipe ? water.flowing.has(id) : water.supplied.has(id);
    const downstream = failed ? [...water.dry.values()].filter((c) => c === id).length : 0;
    const isOnlyFailure = sim && [...(sim.failure.nodes ?? []), ...(sim.failure.pipes ?? [])].length === 1 && failed;
    return (
      <Card title={label} right={close}>
        <p className="mb-2 text-xs text-[var(--muted)]">L{(pipe ?? node)!.level} · generated water network</p>
        <Row k="State" v={failed ? <span className="text-[var(--danger)]">Failed <SimTag /></span> : ok ? <span className="text-[var(--ok)]">{pipe ? "Water flowing" : "Running"}</span> : <span className="text-[var(--warn)]">No water reaching it</span>} />
        {failed && <Row k="Buildings cut off" v={downstream} />}
        {node?.kind === "pump" && <Row k="Lifts water from" v="the riser to this level's mains" />}
        {node?.kind === "source" && <Row k="Feeds" v="the riser for every level" />}
        {isOnlyFailure
          ? <Btn onClick={() => onSim("", {})}>Repair (end simulation)</Btn>
          : !failed && <Btn tone="danger" onClick={() => onSim(`${label} ${pipe ? "breaks" : "stops"}`, pipe ? { pipes: [id] } : { nodes: [id] })}>Simulate a {pipe ? "break" : "failure"} here</Btn>}
      </Card>
    );
  }
  if (selection.type === "hub") {
    const view = hubs.find((h) => h.hubId === selection.id);
    const state = net.hubs.find((h) => h.hubId === selection.id);
    if (!view) return null;
    return (
      <Card title={`Hub ${view.hubId.replace("hub-", "")}`} right={close}>
        <p className="mb-2 text-xs text-[var(--muted)]">Live · relay on level {view.level}</p>
        <Row k="Status" v={view.online ? "Online" : "Offline"} />
        <Row k="Link" v={view.cut ? <span className="text-[var(--danger)]">Cut</span> : <span className="text-[var(--ok)]">Up</span>} />
        {view.cut && <Row k="Waiting to send" v={view.queued} />}
        {state?.link && <Btn onClick={() => net.actions.setLink(state, { cut: !state.link!.cut })}>{state.link.cut ? "Restore the link" : "Cut the link"}</Btn>}
        <p className="mt-2 text-xs text-[var(--muted)]">The console shows the counters and checks that prove what happened.</p>
      </Card>
    );
  }
  // event
  const e = events.find((x) => x.id === selection.id);
  if (!e) return <Card title="Report" right={close}><p className="text-sm text-[var(--muted)]">No longer in the feed.</p></Card>;
  const tampered = net.chain?.first_bad_event === e.id;
  const where = e.place.kind === "exact"
    ? `At ${e.place.deviceId} (its mount is known)`
    : e.place.kind === "named" ? `${e.place.name} (named in the report)`
    : e.place.kind === "level" ? `Somewhere on L${e.level}; the report doesn't say where${e.onMap ? "" : " (level not on the map yet)"}` : "Unknown: no level given";
  return (
    <Card title={<><span style={{ color: SEVERITY_COLOR[e.severity] }}>●</span> {pinTitle(e)}</>} right={close}>
      <p className="mb-2 text-xs text-[var(--muted)]">{SEVERITY_LABEL[e.severity]} · {timeAgo(e.event.created_at)}{e.test ? " · test alert, not from a hub" : e.demo ? " · demo data" : ""}</p>
      {e.severity !== "message" && <p className="mb-2 text-sm">{summary(e.event)}</p>}
      {e.severity === "message" && <p className="mb-2 text-sm text-[var(--muted)]">Encrypted cell message. Only members with the key can read it.</p>}
      <Row k="Check" v={tampered ? <span className="text-[var(--danger)]">Record edited after the fact</span> : e.verified ? <span className="text-[var(--ok)]">Verified by hub</span> : <span className="text-[var(--warn)]">Not verified</span>} />
      <Row k="From" v={e.origin === "sensor" ? `Canary box ${e.event.device_id ?? ""}` : "A resident"} />
      <Row k="Where" v={where} />
      <Row k="Via" v={e.event.hub_id} />
    </Card>
  );
}
