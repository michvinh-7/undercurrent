// The "What's happening" bubble. Fixed sentence rules over real state — not a language
// model — so it works offline and can only say what the data says. Pure TypeScript.

export type Tone = "calm" | "caution" | "alert" | "sim";

export interface Story {
  tone: Tone;
  title: string;
  lines: string[];
  /** Small print: where the claim comes from. */
  source: string;
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
}

const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function narrate(s: NarrateInput): Story {
  const demoNote = s.demo ? " Demo data: no hub connected." : "";

  if (s.forgery)
    return {
      tone: "alert",
      title: "A fake message was just blocked.",
      lines: [`Someone tried to post a report with a key no member holds (${s.forgery}). The hub refused it, so it never reached anyone's feed.`],
      source: `Hub signature check · live${demoNote}`,
    };

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
      source: `${f.spread ? "Simulated spread · " : ""}Canary box reading ${f.ago}${f.demo ? " · demo data" : f.verified ? " · verified by the hub" : " · not verified"} · blocked streets are assumed`,
    };
  }

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
      lines: ["Their reports say which level, not where on it, so they're listed rather than pinned. The console has the details."],
      source: `Resident reports via the hub${demoNote}`,
    };

  const elsewhere = s.reportsElsewhere ? ` The most reports right now are on L${s.reportsElsewhere.level} (${s.reportsElsewhere.count}).` : "";
  return {
    tone: "calm",
    title: `All quiet on L${s.level}, ${s.levelName}.`,
    lines: [
      `Water is reaching all ${s.buildings} buildings${s.link ? s.link.online ? ` and the hub is linked to L${s.link.other}` : ", but this level's hub is offline" : ""}.${elsewhere}`,
      "Click any building, pipe or hub to see what it is.",
    ],
    source: s.demo ? "Demo data: no hub connected" : "Live from the hubs",
  };
}
