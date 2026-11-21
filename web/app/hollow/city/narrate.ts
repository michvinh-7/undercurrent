// The "What's happening" bubble. Fixed sentence rules over real state — not a language
// model — so it works offline and can only say what the data says. Pure TypeScript.

export type Tone = "calm" | "caution" | "alert" | "sim";

export interface Story {
  tone: Tone;
  title: string;
  lines: string[];
  /** Small print: where the claim comes from. */
  source: string;
  /** Other things going on, lower priority than the headline. */
  also?: string[];
}

export interface FloodFacts {
  where: string;
  ago: string;
  verified: boolean;
  demo: boolean;
  blockedStreets: string[];
  cutOff: number;
  spread: boolean;
  route: { to: string; minutes: number; via: string[] } | null;
}

export interface NarrateInput {
  level: number;
  levelName: string;
  buildings: number;
  flood: FloodFacts | null;
  sim: { label: string; dry: number; people: number; levels: number[]; facilities: string[] } | null;
  link: { other: number; cut: boolean; queued: number; online: boolean } | null;
  forgery: string | null;
  sosHere: number;
  reportsHere: number;
  reportsElsewhere: { level: number; count: number } | null;
  demo: boolean;
  /** A building the user clicked: the way to care from there. */
  selected?: { name: string; isCare?: boolean; care: { to: string; minutes: number; via: string[]; kind?: "care" | "shelter" } | null; avoidsFlood: boolean; atRisk: boolean; dry: boolean } | null;
  /** Bad water traced up the pipes (needs 2+ reports). */
  water?: { source: string; reports: number; atRisk: number } | null;
  /** Bad-water reports that couldn't be traced (fewer than two). */
  waterReports?: number;
  /** Breathing-sickness reports on this level. */
  lungs?: { reports: number; people: number } | null;
  checkins?: { ok: number; help: number } | null;
  /** Where the nearest care is for this level, in words. */
  care?: string | null;
  /** Live sensor alerts other than flooding (bad air, heat, blackout), most urgent first. */
  sensors?: SensorFacts[];
}

export interface SensorFacts {
  kind: "bad_air" | "heat" | "blackout";
  /** Where the box is, e.g. "the L34 Market". */
  where: string;
  ago: string;
  reading: string | null;
  /** Minutes until it's expected; null when it's happening now. */
  expectedIn: number | null;
  verified: boolean;
  demo: boolean;
  /** A test alert made on this page, not from a hub. */
  test: boolean;
  /** A route around it, when there is one. */
  route?: { to: string; minutes: number } | null;
}

const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The most important story, plus one-line titles of anything else going on. */
export function narrate(s: NarrateInput): Story {
  const main = narrateOne(s);
  const also: string[] = [];
  for (let r = peel(s); r && also.length < 3; r = peel(r)) {
    const next = narrateOne(r);
    if (next.tone === "calm") break;
    also.push(next.title);
  }
  return also.length ? { ...main, also } : main;
}

/** The same input with its top situation removed (null once nothing is left). */
function peel(r: NarrateInput): NarrateInput | null {
  if (r.forgery) return { ...r, forgery: null };
  if (r.selected) return { ...r, selected: null };
  if (r.sim && r.sim.dry > 0) return { ...r, sim: null };
  if (r.flood) return { ...r, flood: null };
  if (r.sensors?.length) return { ...r, sensors: r.sensors.slice(1) };
  if (r.water) return { ...r, water: null };
  if (r.link?.cut) return { ...r, link: { ...r.link, cut: false } };
  if (r.sosHere > 0) return { ...r, sosHere: 0 };
  if (r.lungs && r.lungs.reports > 0) return { ...r, lungs: null };
  return null;
}

function narrateOne(s: NarrateInput): Story {
  const demoNote = s.demo ? " Not live: no hub connected." : "";

  if (s.forgery)
    return {
      tone: "alert",
      title: "A fake message was just blocked.",
      lines: [`Someone tried to post a report with a key no member holds (${s.forgery}). The hub refused it, so it never reached anyone's feed.`],
      source: `Hub signature check · live${demoNote}`,
    };

  if (s.selected) {
    const b = s.selected;
    const lines: string[] = [];
    if (b.isCare) lines.push("This is where care is on this level. Anyone hurt nearby can be routed here.");
    else if (b.care) lines.push(`${b.care.kind === "shelter" ? "No clinic on this level. Nearest shelter" : "Nearest care"}: the ${b.care.to}, about ${plural(b.care.minutes, "minute")} on foot${b.care.via.length ? ` via ${list(b.care.via.slice(0, 2))}` : ""}.${b.avoidsFlood ? " The green path avoids the flooded streets." : ""}`);
    else lines.push("No dry route to care from here right now.");
    if (b.dry) lines.push("In this simulation it has no running water.");
    else if (b.atRisk) lines.push("It gets water from the pipe that bad-water reports point to. Boil tap water here until it's checked.");
    return { tone: "calm", title: b.name, lines, source: "Generated building and streets · route avoids anything reported unsafe" };
  }

  if (s.sim && s.sim.dry > 0) {
    const hit = s.sim.facilities.length ? ` That includes ${list(s.sim.facilities)}.` : "";
    return {
      tone: "sim",
      title: `What if ${s.sim.label.charAt(0).toLowerCase()}${s.sim.label.slice(1)}?`,
      lines: [
        `${plural(s.sim.dry, "building")} on ${list(s.sim.levels.map((n) => `L${n}`))} would lose water: about ${s.sim.people.toLocaleString()} people.${hit}`,
        "Amber buildings are the ones cut off. Clear the simulation to go back to the live view.",
      ],
      source: "Simulated on the generated water network, not real readings",
    };
  }

  if (s.flood) {
    const f = s.flood;
    const lines: string[] = [];
    lines.push(
      f.blockedStreets.length
        ? `Treat ${list(f.blockedStreets)} as unsafe near the water.`
        : "No streets are blocked yet.",
    );
    if (f.route) lines.push(`Safest way to the ${f.route.to}: about ${plural(f.route.minutes, "minute")}${f.route.via.length ? ` via ${list(f.route.via.slice(0, 2))}` : ""}. Follow the green path.`);
    if (f.cutOff > 0) lines.push(`${plural(f.cutOff, "building")} have no dry way to the stairs.`);
    return {
      tone: "alert",
      title: `${f.spread ? "If it keeps rising: f" : "F"}looding at ${f.where}.`,
      lines,
      source: `${f.spread ? "Simulated spread · " : ""}Canary box reading ${f.ago}${f.demo ? " · not live" : f.verified ? " · verified by the hub" : " · not verified"} · blocked streets are assumed`,
    };
  }

  if (s.sensors?.length) return sensorStory(s, s.sensors[0]);

  if (s.water)
    return {
      tone: "caution",
      title: `Bad water likely comes from the ${s.water.source.charAt(0).toLowerCase()}${s.water.source.slice(1)}.`,
      lines: [
        `${plural(s.water.reports, "report")} of bad water trace back to it through the pipes.`,
        `${plural(s.water.atRisk, "building gets", "buildings get")} water through it: boil tap water there until someone checks it.`,
      ],
      source: "A guess from where reports came from, not a water test · pipes are generated",
    };

  if (s.link?.cut)
    return {
      tone: "caution",
      title: `L${s.level} is cut off from L${s.link.other}.`,
      lines: [
        s.link.queued
          ? `${plural(s.link.queued, "report is", "reports are")} waiting here. They'll cross on their own when the link is back. Nothing is lost.`
          : "New reports will wait here and cross on their own when the link is back.",
      ],
      source: `Hub link status · live${demoNote}`,
    };

  if (s.sosHere > 0)
    return {
      tone: "alert",
      title: s.sosHere === 1 ? `Someone on L${s.level} needs help.` : `${s.sosHere} people on L${s.level} need help.`,
      lines: [
        "Their report says which level, not where on it, so it's listed rather than pinned.",
        ...(s.care ? [`Nearest care: ${s.care}.`] : []),
      ],
      source: `Resident reports via the hub${demoNote}`,
    };

  if (s.lungs && s.lungs.reports > 0)
    return {
      tone: "caution",
      title: `${plural(s.lungs.people, "person", "people")} on L${s.level} report coughing or trouble breathing.`,
      lines: [
        `From ${plural(s.lungs.reports, "report")}. These are residents' own counts, which is what the Directorate's figures leave out.`,
        ...(s.care ? [`Nearest care: ${s.care}.`] : []),
      ],
      source: `Resident reports via the hub${demoNote}`,
    };

  const elsewhere = s.reportsElsewhere ? ` The most reports right now are on L${s.reportsElsewhere.level} (${s.reportsElsewhere.count}).` : "";
  return {
    tone: "calm",
    title: `All quiet on L${s.level}, ${s.levelName}.`,
    lines: [
      `Water is reaching all ${s.buildings} buildings${s.link ? s.link.online ? ` and the hub is linked to L${s.link.other}` : ", but this level's hub is offline" : ""}.${elsewhere}`,
      ...(s.checkins && s.checkins.ok + s.checkins.help > 0 ? [`Check-ins from this level: ${s.checkins.ok} safe${s.checkins.help ? `, ${s.checkins.help} asking for help` : ""}.`] : []),
      ...(s.waterReports ? [`${plural(s.waterReports, "bad-water report")} so far: not enough to point to a source.`] : []),
      "Click your building to see the way to the nearest care.",
    ],
    source: s.demo ? "Not live: no hub connected" : "Live from the hubs",
  };
}

function sensorStory(s: NarrateInput, f: SensorFacts): Story {
  const source = `Canary box reading ${f.ago}${f.test ? " · test alert made on this page, not from a hub" : f.demo ? " · not live" : f.verified ? " · verified by the hub" : " · not verified"}`;
  const reading = f.reading ? ` (${f.reading})` : "";
  if (f.kind === "blackout") {
    const soon = f.expectedIn !== null;
    return {
      tone: "alert",
      title: soon ? `Blackout expected on L${s.level} in about ${plural(f.expectedIn!, "minute")}.` : `Power is out around ${f.where}.`,
      lines: [
        soon ? "Charge lamps and phones now. Fill water containers while the pumps still run." : "Darkened buildings have no power. Stay put unless the air feels wrong.",
        ...(s.care ? [`If someone relies on powered air or medical equipment, move them toward ${s.care}${soon ? " before it hits" : ""}.`] : []),
      ],
      source: `${source}${soon ? " · a warning: it hasn't happened yet" : ""}`,
    };
  }
  if (f.kind === "bad_air")
    return {
      tone: "alert",
      title: `Bad air near ${f.where}${reading}.`,
      lines: [
        "Stay out of the hazy area and keep children and anyone coughing away from it.",
        f.route ? `The green path to the ${f.route.to} goes around it: about ${plural(f.route.minutes, "minute")}.` : "If you feel dizzy or short of breath, report it.",
      ],
      source,
    };
  return {
    tone: "caution",
    title: `${f.where.charAt(0).toUpperCase()}${f.where.slice(1)} is running hot${reading}.`,
    lines: [
      "Drink water, rest through the hottest hours, and check on older neighbours.",
      ...(f.expectedIn !== null ? [`The box expects it to get worse in about ${plural(f.expectedIn, "minute")}.`] : []),
    ],
    source,
  };
}
