// What the Directorate officially claims, so the map can put it next to what residents and the
// boxes report (questions 9 and 13). These are the simulation's Directorate bulletin: the same
// figures as "directorate" in sim/world.json (sim/simulate.py truth writes them to
// sim/ground_truth/directorate.json). Change both together. The UI labels them as simulated.

/** Officially reported lung-sickness cases per level. */
export const DIRECTORATE_LUNG_CASES: Record<number, number> = { 12: 0, 27: 1, 34: 0, 35: 0, 38: 0 };

/** The official line on the surface. */
export const DIRECTORATE_SURFACE_CLAIM = "The air up there kills in minutes";

export const DIRECTORATE_SOURCE = "Directorate bulletin (simulated, from sim/world.json)";
