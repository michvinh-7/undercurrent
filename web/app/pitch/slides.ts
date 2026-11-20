// The 2-minute pitch (/pitch): six slides, each with one live component. Edit the words here;
// page.tsx only lays them out. Durations add up to 120 s and drive auto-play (P or ?auto=1).
// Narration is sized at about 150 words a minute.

export type SlideId = "problem" | "how" | "holds" | "thinks" | "shares" | "proof";

export interface Slide {
  id: SlideId;
  seconds: number;
  kicker: string;
  title: string;
  sub: string;
  /** Speaker notes: what to say while this slide is up (N toggles them). */
  say: string;
  /** What to do on screen or in the terminal during this slide, if anything. */
  doNote?: string;
}

export const SLIDES: Slide[] = [
  {
    id: "problem", seconds: 15, kicker: "The Hollow · 40 levels underground",
    title: "The Directorate owns the only network.",
    sub: "Undercurrent is the one it can't read, fake or shut off, and it takes on 13 of the brief's 15 questions, with designs for the last 2.",
    say: "Forty levels underground, the Directorate owns the only network. It can read every message, fake an all-clear, or cut the line. Undercurrent is the network it can't, and it reaches across almost every problem in the brief.",
  },
  {
    id: "how", seconds: 20, kicker: "How it works",
    title: "Every alert is signed, checked by two hubs, and shared.",
    sub: "A sensor box and residents' phones sign with their own keys. Two hubs check every signature, chain every record and stay in sync.",
    say: "A Canary sensor box and residents' phones sign every alert with their own key. Two hubs, one per level, refuse anything unsigned or off the roster, chain every record to the last, and sync with each other. These chips are live from the hubs.",
  },
  {
    id: "holds", seconds: 25, kicker: "Attack it live",
    title: "Forge it, cut it, edit it. It holds.",
    sub: "Each tile is the hubs' live state. Below each, what we measured.",
    say: "Now we play the Directorate. A forged all-clear: refused, and the counter goes up. Cut the link: alerts wait, then all arrive. Edit a stored record: the chain points to the exact row. Across 300 forgeries we accepted zero.",
    doNote: "Terminal, from hub/: directorate.py forge, then cut, a phone SOS, restore, then edit.",
  },
  {
    id: "thinks", seconds: 25, kicker: "It thinks",
    title: "Urgent first. Blackouts before they hit.",
    sub: "An AI model on the hub, offline, reads each report; code does the math. A line fit on voltage predicts the blackout.",
    say: "On a slow link the SOS has to go first. A small model on the hub reads messy text and pulls out the facts, and plain code scores it, so it never invents a number. And from a relay's voltage, the hub predicts when the power drops out, with a range.",
    doNote: "Click Panicked SOS, then Rank it.",
  },
  {
    id: "shares", seconds: 20, kicker: "It shares",
    title: "It shares what's left and sees who's struggling.",
    sub: "Needs meet offers across levels, medicine first. Daily check-ins show the deep levels sleeping hours less.",
    say: "Residents post what they can spare and what they need, and the hub matches them across levels, medicine and water first. The same check-ins track sleep and mood: the deep levels sleep three hours less. All signed, so the Directorate can't hide it.",
  },
  {
    id: "proof", seconds: 15, kicker: "Measured, not claimed",
    title: "Built to be trusted underground.",
    sub: "Every number is from a real run in eval/results.",
    say: "Zero of 300 forgeries accepted, 160 of 160 edits caught, 200 of 200 alerts through link cuts. Undercurrent: the network they can't take away.",
  },
];

export const TOTAL_SECONDS = SLIDES.reduce((t, s) => t + s.seconds, 0);

/** The 15 questions from the brief, and where we stand on each. */
export const QUESTIONS: { n: number; short: string; status: "live" | "partial" | "design" }[] = [
  { n: 1, short: "Warn before blackouts", status: "live" },
  { n: 2, short: "Share fairly", status: "live" },
  { n: 3, short: "Keep levels livable", status: "partial" },
  { n: 4, short: "Catch bad water", status: "live" },
  { n: 5, short: "Safe tunnels", status: "live" },
  { n: 6, short: "Share space", status: "live" },
  { n: 7, short: "Organize without them", status: "live" },
  { n: 8, short: "Reconnect families", status: "live" },
  { n: 9, short: "Real outbreak numbers", status: "live" },
  { n: 10, short: "Care that reaches people", status: "live" },
  { n: 11, short: "Life without sunlight", status: "live" },
  { n: 12, short: "Grow and share food", status: "partial" },
  { n: 13, short: "Is the surface safe?", status: "live" },
  { n: 14, short: "Suits, domes or outposts", status: "design" },
  { n: 15, short: "Plan the move up", status: "design" },
];

/** Headline numbers for the last slide, from eval/results/RESULTS.md. */
export const PROOF = [
  { value: "0 / 300", label: "forged or replayed alerts accepted" },
  { value: "160 / 160", label: "edits caught at the exact row" },
  { value: "200 / 200", label: "alerts delivered through link cuts" },
  { value: "88%", label: "AI triage urgency (54% keywords)" },
  { value: "6 min", label: "blackout forecast error an hour out (27 for a guess)" },
];

export const STACK = [
  "Next.js 15", "React 19", "Tailwind 4", "shadcn/ui", "three.js + React Three Fiber",
  "FastAPI", "SQLite hash chain", "Ed25519 (PyNaCl, tweetnacl)", "XSalsa20-Poly1305 cells",
  "Ollama · Llama 3.2 3B (offline)", "Gemini (eval)", "Arduino UNO Q",
];

/** FILL IN BEFORE RECORDING: who built what. Shown on the last slide with a marker until edited. */
export const TEAM_PLACEHOLDER = true;
export const TEAM: { name: string; built: string }[] = [
  { name: "[Name]", built: "[what they built]" },
  { name: "[Name]", built: "[what they built]" },
  { name: "[Name]", built: "[what they built]" },
  { name: "[Name]", built: "[what they built]" },
];
