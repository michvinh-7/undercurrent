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
    watch: "On the Directorate view the left column shows bytes; a member's phone shows the words.",
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
  { value: "72%", label: "less SOS delay on a slow link", source: "priority queue vs first-come" },
];
