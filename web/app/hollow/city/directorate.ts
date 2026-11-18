// What the Directorate officially claims, so the map can put it next to what residents and the
// boxes report (questions 9 and 13). These are DEMO FIGURES, written for the story, until the
// simulation (sim/ground_truth, Alanna) publishes the Directorate's falsified numbers. The UI
// always labels them as such. Replace this file's values; nothing else needs to change.

/** Officially reported lung-sickness cases per level. */
export const DIRECTORATE_LUNG_CASES: Record<number, number> = { 12: 0, 27: 1, 34: 0, 35: 0, 38: 0 };

/** The official line on the surface. */
export const DIRECTORATE_SURFACE_CLAIM = "The air up there kills in minutes";

export const DIRECTORATE_SOURCE = "Directorate bulletin · demo figures until the simulation publishes them";
