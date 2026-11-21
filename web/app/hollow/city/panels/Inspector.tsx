"use client";

// The "Selected" tab: details for whatever was clicked (building, pipe, hub or report).

import { useState } from "react";
import { summary, timeAgo } from "@/lib/format";
import { sendOrQueue } from "@/lib/outbox";
import { NotJoinedError } from "@/lib/sign";
import type { Undercurrent } from "@/lib/useUndercurrent";
import { SEVERITY_LABEL, type MapEvent, type Resident } from "../adapter";
import { buildingById, nameOf, USE_LABEL, type Building, type CityWorld, type Failure, type solveWater } from "../model";
import { pinTitle, SEVERITY_COLOR, type HubView, type Selection } from "../scene/CityScene";
import { Btn, Card, Row, SimTag } from "./ui";

export default function Inspector({ world, selection, events, water, net, hubs, homes, onClose, onFocus, onSim, sim }: {
  world: CityWorld; selection: Selection; events: MapEvent[]; water: ReturnType<typeof solveWater>; net: Undercurrent; hubs: HubView[];
  homes: Map<string, Resident[]>;
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
        <Residents key={b.id} b={b} list={homes.get(b.id) ?? []} net={net} />
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
      <p className="mb-2 text-xs text-[var(--muted)]">{SEVERITY_LABEL[e.severity]} · {timeAgo(e.event.created_at)}{e.test ? " · test alert, not from a hub" : e.demo ? " · demo data" : e.simulated ? " · simulated (sim/simulate.py), signed like a real one" : ""}</p>
      {e.severity !== "message" && <p className="mb-2 text-sm">{summary(e.event)}</p>}
      {e.severity === "message" && <p className="mb-2 text-sm text-[var(--muted)]">Encrypted cell message. Only members with the key can read it.</p>}
      <Row k="Check" v={tampered ? <span className="text-[var(--danger)]">Record edited after the fact</span> : e.verified ? <span className="text-[var(--ok)]">Verified by hub</span> : <span className="text-[var(--warn)]">Not verified</span>} />
      <Row k="From" v={e.origin === "sensor" ? `${e.simulated ? "Simulated " : ""}Canary box ${e.event.device_id ?? ""}` : e.simulated ? "A simulated resident" : "A resident"} />
      <Row k="Where" v={where} />
      <Row k="Via" v={e.event.hub_id} />
    </Card>
  );
}

// Who is in this building. Assigning is a signed check-in with { home, name }, so it reaches
// every hub and every viewer; nothing is kept only in this browser.
function Residents({ b, list, net }: { b: Building; list: Resident[]; net: Undercurrent }) {
  const [name, setName] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "sending" | "done" | "error"; msg?: string }>({ kind: "idle" });
  const live = net.mode === "live" && !!net.sendingHub?.url;
  const assign = async () => {
    const who = name.trim().slice(0, 40);
    if (!who || !live) return;
    setState({ kind: "sending" });
    try {
      const r = await sendOrQueue(
        { type: "checkin", level: b.level, author: "hollow-map", payload: { status: "ok", home: b.id, name: who } },
        net.sendingHub!.url,
      );
      setName("");
      setState({ kind: "done", msg: r.state === "sent" ? `${who} assigned here.` : "Hub unreachable: saved, sends itself when it's back." });
    } catch (err) {
      setState({ kind: "error", msg: err instanceof NotJoinedError ? "This browser isn't on the roster yet: add its key from /join." : String((err as Error)?.message ?? err) });
    }
  };
  return (
    <div className="mt-3 border-t border-[var(--border)] pt-3">
      <div className="mb-1.5 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">Residents</h3>
        <span className="text-xs text-[var(--muted)]">{list.length} assigned</span>
      </div>
      {list.length > 0 ? (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {list.map((r) => (
            <li key={r.name} className="rounded-full border border-[var(--border-strong)] px-2 py-0.5 text-xs">{r.name}{r.simulated && <SimTag />}</li>
          ))}
        </ul>
      ) : (
        <p className="mb-2 text-xs text-[var(--muted)]">Nobody assigned yet.</p>
      )}
      <form onSubmit={(e) => { e.preventDefault(); assign(); }} className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Person's name"
          maxLength={40}
          disabled={!live}
          className="min-w-0 flex-1 rounded-md border border-[var(--border-strong)] bg-[var(--panel)] px-2 py-1.5 text-sm"
        />
        <button disabled={!live || !name.trim() || state.kind === "sending"} className="rounded-md bg-[var(--foreground)] px-3 py-1.5 text-sm font-medium text-[var(--panel)] disabled:opacity-40">
          {state.kind === "sending" ? "Assigning…" : "Assign"}
        </button>
      </form>
      <p className={`mt-1.5 text-xs ${state.kind === "error" ? "text-[var(--danger)]" : "text-[var(--muted)]"}`}>
        {!live ? "Needs a live hub: assignments are shared through the hubs." : state.msg ?? "Shared with every hub. Assigning a name again moves that person."}
      </p>
    </div>
  );
}
