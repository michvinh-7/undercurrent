// Real answers recorded from the running hubs on Nov 20, shown when no hub answers (a hosted copy
// of the site, or the hubs down), so the overview never shows an empty box. Labelled as recorded
// wherever shown. Triage: the hub's offline model (Llama 3.2 3B) on the three Try it examples.
// Forecast: the simulated L12 relay; the simulation compresses a night into a minute, so its times
// are short. Re-record by posting the examples to POST /triage and reading GET /forecast.

import type { BoxForecast, Triage } from "./sections";

export const RECORDED_ON = "Nov 20, 2026";
export const RECORDED_TRIAGE: Record<string, Triage> = {
  "pls help water coming in fast lvl 34 my kid cant swim 3 of us stuck by the pumps": {
    "type": "hazard",
    "urgency": "sos",
    "level": 34,
    "injuries": null,
    "people_count": null,
    "hazard": "flooding",
    "priority": 0.92,
    "source": "model"
  },
  "my grandma fell on the stairs L12, bleeding from her head, cant get up, 2 of us here": {
    "type": "case",
    "urgency": "sos",
    "level": 12,
    "injuries": null,
    "people_count": null,
    "hazard": null,
    "priority": 0.9,
    "source": "model"
  },
  "checking in from 35, we're ok, water still clean at the clinic": {
    "type": "checkin",
    "urgency": "routine",
    "level": 35,
    "injuries": null,
    "people_count": null,
    "hazard": null,
    "priority": 0.25,
    "source": "model"
  }
};
export const RECORDED_FORECAST: BoxForecast = {
  "device_id": "canary-12-relay",
  "level": 12,
  "hub_id": "hub-L12",
  "readings": 8,
  "latest_v": 193.0,
  "latest_at": "2026-11-20T16:53:54.795Z",
  "slope_v_per_min": -42.503,
  "status": "falling",
  "eta_s": 18.618,
  "eta_low_s": 17.866,
  "eta_high_s": 19.436,
  "cutoff_v": 180.0,
  "simulated": true
};
export const RECORDED_POINTS: { t: string; v: number }[] = [{"t": "2026-11-20T16:53:02.130Z", "v": 229}, {"t": "2026-11-20T16:53:10.130Z", "v": 225}, {"t": "2026-11-20T16:53:18.796Z", "v": 218}, {"t": "2026-11-20T16:53:27.463Z", "v": 213}, {"t": "2026-11-20T16:53:36.130Z", "v": 206}, {"t": "2026-11-20T16:53:42.459Z", "v": 203}, {"t": "2026-11-20T16:53:46.795Z", "v": 199}, {"t": "2026-11-20T16:53:51.463Z", "v": 195}, {"t": "2026-11-20T16:53:54.795Z", "v": 193}];
