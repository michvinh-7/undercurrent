import type { HollowEvent } from "./types";

/** "just now", "5 min ago", "2 hours ago". Fake example events (dated 2087) show as "example". */
export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (Number.isNaN(s) || s < -60) return "example";
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"} ago`;
  return `${Math.round(h / 24)} days ago`;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** One readable line per event, built only from what the resident reported. */
export function summary(e: HollowEvent): string {
  const p = e.payload;
  switch (e.type) {
    case "checkin":
      return [p.status === "need_help" ? "Needs help" : "Checked in OK", str(p.name), str(p.note)].filter(Boolean).join(" · ");
    case "hazard":
      return [`${String(p.kind ?? "hazard").replace("_", " ")} (${p.severity ?? "?"})`, str(p.location), str(p.note)]
        .filter(Boolean)
        .join(" · ");
    case "case": {
      const symptoms = Array.isArray(p.symptoms) ? p.symptoms.join(", ") : "";
      const people = typeof p.people_affected === "number" ? `${p.people_affected} affected` : null;
      return [symptoms || str(p.raw_text) || "Symptom report", people].filter(Boolean).join(" · ");
    }
    case "missing_person":
      return [`Missing: ${str(p.name) ?? "unknown"}`, `last seen level ${p.last_seen_level ?? "?"}`, str(p.description)]
        .filter(Boolean)
        .join(" · ");
    case "roster":
      return `${p.action === "remove" ? "Removed" : "Added"} ${p.role === "operator" ? "operator" : "member"} ${String(p.pub ?? "?").slice(0, 8)}…`;
    case "exchange":
      if (str(p.closes)) return "Marked a Have / Need post as done";
      return [
        `${p.side === "have" ? "Has" : "Needs"} ${String(p.category ?? "something")}: ${str(p.item) ?? "unnamed"}`,
        typeof p.quantity === "number" ? `× ${p.quantity}` : null,
        str(p.location),
      ].filter(Boolean).join(" · ");
  }
}

export const TYPE_LABEL: Record<HollowEvent["type"], string> = {
  checkin: "check-in",
  hazard: "hazard",
  case: "symptoms",
  missing_person: "missing",
  roster: "roster",
  exchange: "have / need",
};
