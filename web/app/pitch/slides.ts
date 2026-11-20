// The 3-minute pitch (/pitch): eight slides, each with one live component. Edit the words here;
// page.tsx only lays them out. Durations add up to 180 s and drive auto-play (P or ?auto=1).
// Narration is sized at about 150 words a minute.
//
// The arc: the stakes → the answer → the box → proof under attack → intelligence → human
// impact → breadth (earned, after the proof) → why it wins. Each slide hands off to the next.

export type SlideId = "problem" | "answer" | "box" | "holds" | "thinks" | "shares" | "reach" | "proof";

export interface Slide {
  id: SlideId;
  seconds: number;
  kicker: string;
  title: string;
  sub: string;
  /** Why this slide exists, for the presenter (in the speaker notes). */
  purpose: string;
  /** The one line a judge should leave the slide with (shown at the slide's foot). */
  takeaway: string;
  /** Speaker notes: what to say while this slide is up (N toggles them). */
  say: string;
  /** What to do on screen or in the terminal during this slide, if anything. */
  doNote?: string;
}

export const SLIDES: Slide[] = [
  {
    id: "problem", seconds: 20, kicker: "The Hollow · 40 levels underground",
    title: "The Directorate owns the only network.",
    sub: "Billions live underground, and every message, alarm and number goes through them.",
    purpose: "Set the stakes in one breath: three concrete things they do to the network.",
    takeaway: "Whoever controls the network controls the truth.",
    say: "Forty levels underground, the Directorate owns the only network. They read every message. They post fake all-clears when the water's rising. And when it suits them, they cut the line, and their numbers say nobody is sick.",
  },
  {
    id: "answer", seconds: 20, kicker: "Undercurrent",
    title: "So we built one they can't read, fake or shut off.",
    sub: "A sensor box and residents' phones sign every alert. Two hubs check each one and keep identical copies.",
    purpose: "Give the whole answer in one picture before any detail.",
    takeaway: "Every alert is signed, checked twice, and shared.",
    say: "Undercurrent is the residents' own network. A Canary sensor box and people's phones sign every alert with their own key. Two hubs, one per level, refuse anything unsigned, chain every record, and sync. These chips are live from the hubs.",
  },
  {
    id: "box", seconds: 20, kicker: "The Canary box",
    title: "It starts with a box on the wall.",
    sub: "An Arduino UNO Q that is its own hub: a water probe, an SOS button, a buzzer, heat and a fan monitor.",
    purpose: "Show the hardware: real sensors, and signing at the source.",
    takeaway: "Real sensors, signed at the source.",
    say: "It starts with a box on the wall. Water touches the probe, it beeps, and the board signs the alert itself, so nobody can fake it in transit. Within a second it lands on the other level's hub, verified.",
    doNote: "Dip the probe if the box is on the table; otherwise the simulated boxes are labelled.",
  },
  {
    id: "holds", seconds: 30, kicker: "Attack it live",
    title: "Forge it, cut it, edit it. It holds.",
    sub: "Each tile is the hubs' live state. Below each, what we measured.",
    purpose: "Prove the security claims under attack, on camera, with numbers.",
    takeaway: "Attacks fail on camera, and we measured it.",
    say: "Now we play the Directorate. A forged all-clear: refused, and the counter goes up. Cut the link: alerts wait in line, then every one arrives. Edit a stored record: the chain points to the exact row. Across 300 forgeries we accepted zero, and caught 160 of 160 edits.",
    doNote: "Terminal, from hub/: directorate.py forge, then cut, a phone SOS, restore, then edit, then scripts/verify.py --hub … --hub … --roster demo/roster.json: a separate checker that uses none of the hub's code names the edited row.",
  },
  {
    id: "thinks", seconds: 25, kicker: "It thinks",
    title: "Urgent first. Blackouts before they hit.",
    sub: "An AI model on the hub, offline, reads each report; code does the math. A line fit on voltage predicts the blackout.",
    purpose: "Show the intelligence: triage and prediction, both honest about how they work.",
    takeaway: "It predicts, not just reports.",
    say: "On a slow link the SOS has to go first. A small model on the hub reads messy text and pulls out the facts, and plain code scores it, so it never invents a number. And from the relay's voltage, the hub predicts when the power drops out, with a range.",
    doNote: "Click Panicked SOS, then Rank it.",
  },
  {
    id: "shares", seconds: 25, kicker: "It shares",
    title: "It shares what's left and sees who's struggling.",
    sub: "Needs meet offers across levels, medicine first. Check-ins track sleep. One score per level says which is failing, and why.",
    purpose: "Bring it back to people: fairness, wellbeing, and which level needs help first.",
    takeaway: "It makes life underground fairer.",
    say: "Residents post what they can spare and what they need, and the hub matches them across levels, medicine and water first. Check-ins show the deep levels sleep three hours less. And it all adds up to one score per level. Here's one night, simulated: level 34 turns unsafe, and it says why, the air.",
    doNote: "The night below plays by itself, 10 simulated minutes a second: L34 turns unsafe about 12 s in. Pause (the button by the clock) to hold it there.",
  },
  {
    id: "reach", seconds: 15, kicker: "The brief",
    title: "One network, 13 of the 15 questions.",
    sub: "Built on the same signed channel, with designs for the last two: the move back up.",
    purpose: "Show breadth after the proof, so it lands as earned.",
    takeaway: "One system, not fifteen features.",
    say: "Because it's one trusted channel, it reaches 13 of the brief's 15 questions, twelve of them live, and the last two, the move back to the surface, are designed on top of it.",
  },
  {
    id: "proof", seconds: 25, kicker: "Measured, not claimed",
    title: "Built to be trusted underground.",
    sub: "Every number is from a real run in eval/results.",
    purpose: "Close on evidence and the team: why it should win.",
    takeaway: "Every claim has a number behind it.",
    say: "Zero of 300 forgeries accepted. 160 of 160 edits caught. Across 40 hubs with the deep levels cut off, not one alert lost. An AI and a fuzzer played the Directorate: 40,000 attacks, none got through. Offline AI triage gets urgency right 76 percent of the time. Built by four of us. Undercurrent: the network they can't take away.",
  },
];

export const TOTAL_SECONDS = SLIDES.reduce((t, s) => t + s.seconds, 0);

/** The 15 questions from the brief, and where we stand on each. */
export const QUESTIONS: { n: number; short: string; status: "live" | "partial" | "design" }[] = [
  { n: 1, short: "Warn before blackouts", status: "live" },
  { n: 2, short: "Share fairly", status: "live" },
  { n: 3, short: "Keep levels livable", status: "live" },
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

/** What the Directorate does to the network (slide 1). */
export const THREATS = [
  { verb: "Reads", what: "every message on the only network" },
  { verb: "Fakes", what: "all-clears while the water rises" },
  { verb: "Cuts", what: "the line, and rewrites the numbers" },
];

/** The Canary box (slide 3): Tisya's hardware. */
export const BOX_PARTS = [
  { part: "Water probe", does: "wet past its threshold for 3 s → flooding alert" },
  { part: "SOS button", does: "a signed call for help" },
  { part: "LED and buzzer", does: "the alarm people hear on the level" },
  { part: "Temperature and fan", does: "heat, and a cooling fan that stalls" },
  { part: "Linux side", does: "signs every alert (Ed25519) and runs its own hub" },
];

/** Headline numbers for the last slide, from eval/results/RESULTS.md. */
export const PROOF = [
  { value: "0 / 300", label: "forged or replayed alerts accepted" },
  { value: "160 / 160", label: "edits caught at the exact row" },
  { value: "200 / 200", label: "alerts delivered through link cuts" },
  { value: "0 / 1,120", label: "alerts lost across 40 hubs, deep levels cut off" },
  { value: "0 breaches", label: "in 40,156 attacks by an AI and a fuzzer" },
  { value: "76%", label: "offline AI triage urgency (54% keywords)" },
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
