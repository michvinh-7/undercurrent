// The five demo beats as the judges' front door tells them. Copy and commands only; the
// live proof for each is worked out in page.tsx from the hubs. Commands run from the repo
// root against the demo hubs (hub/scripts/demo_hubs.py up).

export type BeatId = "box" | "cut" | "forge" | "edit" | "sniff";

export interface Beat {
  id: BeatId;
  title: string;
  what: string;
  watch: string;
  /** Where to show it (a page path; the bar's ?hub=&peer= is added). */
  open: { href: string; label: string };
  commandLabel: string;
  command: string;
  measured: string;
}

const PY = "hub/.venv/bin/python";

export const BEATS: Beat[] = [
  {
    id: "box",
    title: "Water on the box",
    what: "Water touches the probe on level 34's Canary box. It beeps, and within a second the alert lands on the other hub with a verified badge.",
    watch: "The L34 lift station lights up on the map, and the alert tops the console queue on hub L12.",
    open: { href: "/hollow", label: "Open the 3D map" },
    commandLabel: "No box on the table? Fill both hubs with the simulated crisis",
    command: `${PY} sim/simulate.py run`,
    measured: "0.81 s probe to the other hub (dry run)",
  },
  {
    id: "cut",
    title: "Cut the link",
    what: "The Directorate cuts the link between the hubs. Alerts wait on the sending hub, then every one arrives when the link is back, none twice.",
    watch: "The waiting count climbs while the link is down, then drops to zero as the alerts land.",
    open: { href: "/dashboard", label: "Open the console" },
    commandLabel: "Cut, post a few alerts, then restore",
    command: `${PY} hub/scripts/directorate.py cut\n${PY} hub/scripts/directorate.py restore`,
    measured: "200 / 200 delivered after 26 random cuts",
  },
  {
    id: "forge",
    title: "Forged all-clear",
    what: "The Directorate posts a fake “all clear, go home” signed with a key nobody on the roster holds. Both hubs refuse it.",
    watch: "The forgeries counter goes up by one; the fake never reaches the feed or the map.",
    open: { href: "/dashboard", label: "Open the console" },
    commandLabel: "Send a forgery",
    command: `${PY} hub/scripts/directorate.py forge --note "All clear, go home"`,
    measured: "0 / 300 forged or replayed alerts accepted",
  },
  {
    id: "edit",
    title: "Edited record",
    what: "Someone with the laptop edits a stored alert straight in the database. The hash chain breaks at exactly that row.",
    watch: "The console's chain check turns red and names the edited row. The other hub still holds the original.",
    open: { href: "/dashboard", label: "Open the console" },
    commandLabel: "Edit the newest row in the database file",
    command: `${PY} hub/scripts/directorate.py edit`,
    measured: "160 / 160 edits caught at the exact row",
  },
  {
    id: "sniff",
    title: "Sniffing the link",
    what: "The Directorate taps the link. Public alerts are readable on purpose; cell messages are ciphertext to everyone without the cell key, the hubs included.",
    watch: "On the Directorate view the left column shows bytes; a member's phone shows the words. On the console, flip to the Directorate view: it's their control room, and every command they fire (forge, replay, rewrite, cut, decrypt) is stamped with what the hubs actually did.",
    open: { href: "/truth", label: "Open the Directorate view" },
    commandLabel: "Send a sealed message from a phone",
    command: "Phone: Cell messages → Send encrypted",
    measured: "secretbox (XSalsa20-Poly1305), key shared in person",
  },
];

/** Measured results, from eval/results/RESULTS.md. */
export const RESULTS = [
  { value: "0 / 300", label: "forged or replayed alerts accepted", source: "eval/run_attacks.py" },
  { value: "160 / 160", label: "database edits caught at the row", source: "eval/run_attacks.py" },
  { value: "200 / 200", label: "alerts delivered after random cuts", source: "sync stress, simulated cuts" },
  { value: "0.81 s", label: "probe to the alert on the other hub", source: "dry run; the real box run is next" },
  { value: "72%", label: "less SOS delay on a slow link", source: "local model + priority queue vs first-come" },
];

/** Messages to try on the live triage box: a panicked SOS, an injury, and a routine check-in. */
export const TRIAGE_EXAMPLES = [
  { label: "Panicked SOS", text: "pls help water coming in fast lvl 34 my kid cant swim 3 of us stuck by the pumps" },
  { label: "Injury", text: "my grandma fell on the stairs L12, bleeding from her head, cant get up, 2 of us here" },
  { label: "All fine", text: "checking in from 35, we're ok, water still clean at the clinic" },
];

/** Triage on the held-out test split (n=149), from eval/results/RESULTS.md, 2026-11-17.
 * The AI column is the model the hub runs offline; the cloud model is in the caption only. */
export const TRIAGE_MODEL = "Llama 3.2 3B";
export const TRIAGE_RESULTS = [
  { label: "Urgency right", ai: "75.8%", aiCi: "68.5–82.6", rules: "53.7%" },
  { label: "SOS caught (recall)", ai: "87.9%", aiCi: "75.8–97.3", rules: "27.3%" },
  { label: "SOS ranked first in a batch of 10", ai: "62.1%", aiCi: "52.2–71.4", rules: "37.1%" },
  { label: "Level pulled out exactly", ai: "95.3%", aiCi: "91.9–98.7", rules: "63.1%" },
  { label: "SOS delay cut by the priority queue", ai: "72.4%", aiCi: "63.6–80.3", rules: "29.8%" },
];

/** Blackout forecast backtest, from eval/results/forecast_synthetic_2026-11-19.md (n=1000 synthetic sags). */
export const FORECAST_RESULTS = [
  { label: "Error in the predicted drop-out time, an hour ahead", forecast: "6 min", baseline: "27 min" },
  { label: "Error 15 minutes ahead", forecast: "1 min", baseline: "2 min" },
  { label: "Sags warned before the power drops", forecast: "99.6%", baseline: "–" },
  { label: "False alarms on steady power", forecast: "0%", baseline: "35%" },
];
