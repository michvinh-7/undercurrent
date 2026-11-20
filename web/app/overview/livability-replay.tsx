"use client";

// The Livability Index over time (question 3, Caelon). A simulated night: six hours of signed
// events on four levels, scored every 5 minutes by the hub's own code (hub/app/livability.py),
// played back here at any speed. The frames are made by hub/scripts/livability_replay.py, and
// hub/tests/test_livability_replay.py fails if they no longer match the scoring code.

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronsLeftIcon, ChevronsRightIcon, PauseIcon, PlayIcon, RotateCcwIcon, StepBackIcon, StepForwardIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import replay from "./livability-replay.json";

type Band = "livable" | "strained" | "unsafe";
interface FrameLevel { score: number; band: Band; capped: boolean; by: string; why: string; coverage: number; dims: Record<string, number> }
interface Frame { t: number; events: number; levels: Record<string, FrameLevel> }
interface Moment { t: number; level: number; text: string }
interface Replay { start: string; hours: number; step_min: number; levels: number[]; event_count: number; moments: Moment[]; frames: Frame[] }

const DATA = replay as unknown as Replay; // checked by hub/tests/test_livability_replay.py
const END = DATA.hours * 60;
/** Simulated minutes per real second. */
const SPEEDS = [2, 5, 10, 20, 40, 60];
const DEFAULT_SPEED = 3; // 20 min a second: the night in 18 s
const BAND_COLOR: Record<Band, string> = { livable: "var(--ok)", strained: "var(--warn)", unsafe: "var(--danger)" };
const levelName = (n: number) => (n === 1 ? "Surface" : `L${n}`);
const START_MIN = new Date(DATA.start).getUTCHours() * 60 + new Date(DATA.start).getUTCMinutes();
const clock = (t: number) => {
  const m = Math.round(START_MIN + t) % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
const elapsed = (t: number) => (t < 60 ? `${Math.round(t)} min` : `${Math.floor(t / 60)} h ${String(Math.round(t % 60)).padStart(2, "0")} min`);
const frameAt = (t: number) => DATA.frames[Math.max(0, Math.min(DATA.frames.length - 1, Math.floor(t / DATA.step_min)))];

/** One level's score over the night, drawn up to the playhead, with the bands behind it. */
function LevelChart({ level, t, onSeek }: { level: number; t: number; onSeek: (t: number) => void }) {
  const W = 520, H = 116, padL = 32, padR = 10, padT = 8, padB = 18;
  const X = (m: number) => padL + (m / END) * (W - padL - padR);
  const Y = (s: number) => padT + ((100 - s) / 100) * (H - padT - padB);
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const key = String(level);

  const points = DATA.frames.filter((f) => f.t <= t && f.levels[key]).map((f) => ({ t: f.t, s: f.levels[key].score }));
  const path = points.map((p, i) => `${i ? "L" : "M"}${X(p.t).toFixed(1)},${Y(p.s).toFixed(1)}`).join("");
  const now = frameAt(t).levels[key];
  const moments = DATA.moments.filter((m) => m.level === level);
  const hoverFrame = hover !== null && hover <= t ? frameAt(hover).levels[key] : undefined;

  const toT = (clientX: number) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return null;
    const m = ((clientX - r.left) / r.width * W - padL) / (W - padL - padR) * END;
    return Math.max(0, Math.min(END, Math.round(m / DATA.step_min) * DATA.step_min));
  };

  return (
    <div className="relative">
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="h-auto w-full cursor-crosshair touch-none select-none" role="img"
        aria-label={`${levelName(level)} livability from ${clock(0)} to ${clock(t)}${now ? `: now ${now.score}, ${now.band}` : ""}`}
        onPointerMove={(e) => setHover(toT(e.clientX))} onPointerLeave={() => setHover(null)}
        onPointerDown={(e) => { const m = toT(e.clientX); if (m !== null) onSeek(m); }}>
        {/* the bands: unsafe under 50, strained 50 to 79, livable 80+ */}
        <rect x={padL} y={Y(50)} width={W - padL - padR} height={Y(0) - Y(50)} fill="var(--danger)" fillOpacity="0.07" />
        <rect x={padL} y={Y(80)} width={W - padL - padR} height={Y(50) - Y(80)} fill="var(--warn)" fillOpacity="0.06" />
        <rect x={padL} y={Y(100)} width={W - padL - padR} height={Y(80) - Y(100)} fill="var(--ok)" fillOpacity="0.06" />
        {[0, 50, 80, 100].map((s) => (
          <g key={s}>
            <line x1={padL} x2={W - padR} y1={Y(s)} y2={Y(s)} stroke="var(--border)" strokeWidth="1" />
            <text x={padL - 5} y={Y(s) + 3.5} textAnchor="end" fontSize="12" fill="var(--muted)">{s}</text>
          </g>
        ))}
        {[0, 120, 240, 360].map((m) => (
          <text key={m} x={X(m)} y={H - 4} textAnchor={m === 0 ? "start" : m === END ? "end" : "middle"} fontSize="12" fill="var(--muted)">{clock(m)}</text>
        ))}
        {moments.map((m) => (
          <g key={`${m.t}-${m.text}`} onPointerDown={(e) => { e.stopPropagation(); onSeek(m.t); }} className="cursor-pointer">
            <title>{`${clock(m.t)} · ${m.text}`}</title>
            <rect x={X(m.t) - 7} y={Y(0) - 14} width="14" height="14" fill="transparent" />
            <path d={`M${X(m.t)},${Y(0) - 1} l-4,-7 h8 z`} fill={m.t <= t ? "var(--accent)" : "var(--faint)"} />
          </g>
        ))}
        {path && <path d={path} fill="none" stroke="var(--foreground)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
        <line x1={X(t)} x2={X(t)} y1={padT} y2={Y(0)} stroke="var(--accent)" strokeWidth="1.5" />
        {now && <circle cx={X(t)} cy={Y(now.score)} r="5" fill={BAND_COLOR[now.band]} stroke="var(--panel)" strokeWidth="2" />}
        {hover !== null && <line x1={X(hover)} x2={X(hover)} y1={padT} y2={Y(0)} stroke="var(--muted)" strokeDasharray="3 3" />}
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute top-0 z-10 w-max max-w-[16rem] rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md"
          style={{ left: `${(X(hover) / W) * 100}%`, transform: X(hover) > W * 0.6 ? "translateX(calc(-100% - 8px))" : "translateX(8px)" }}>
          <span className="font-mono">{clock(hover)}</span>
          {hoverFrame ? (
            <span className="block">
              <span className="font-mono font-semibold tabular-nums">{hoverFrame.score}</span>{" "}
              <span style={{ color: BAND_COLOR[hoverFrame.band] }}>{hoverFrame.band}</span>
              <span className="block text-muted-foreground">{hoverFrame.by}: {hoverFrame.why}</span>
            </span>
          ) : (
            <span className="block text-muted-foreground">{hover > t ? "not played yet" : "no data"}</span>
          )}
        </div>
      )}
    </div>
  );
}

/** The index over a simulated night, with play, pause, step, scrub and speed. */
export function LivabilityReplay() {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedIx, setSpeedIx] = useState(DEFAULT_SPEED);
  const speed = SPEEDS[speedIx];
  const last = useRef<number | null>(null);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = (now: number) => {
      const dt = last.current === null ? 0 : (now - last.current) / 1000;
      last.current = now;
      setT((cur) => Math.min(END, cur + dt * speed));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); last.current = null; };
  }, [playing, speed]);

  useEffect(() => { if (playing && t >= END) setPlaying(false); }, [playing, t]);

  const seek = (m: number) => setT(Math.max(0, Math.min(END, m)));
  const step = (d: number) => { setPlaying(false); seek((Math.round(t / DATA.step_min) + d) * DATA.step_min); };
  const toggle = () => { if (t >= END) setT(0); setPlaying((p) => !p); };
  const frame = frameAt(t);
  const happened = useMemo(() => DATA.moments.filter((m) => m.t <= t).slice(-4).reverse(), [t]);

  return (
    <Card className="gap-4 p-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="caption">The index over time</span>
        <Badge variant="outline" style={{ borderColor: "var(--sim)", color: "var(--sim)" }}>Simulated night</Badge>
        <span className="ml-auto font-mono text-sm tabular-nums">
          {clock(t)} <span className="text-muted-foreground">· {elapsed(t)} in · {frame.events} signed events so far</span>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => { setPlaying(false); setT(0); }} aria-label="Back to the start"><RotateCcwIcon /></Button>
        <Button size="sm" variant="outline" onClick={() => step(-1)} aria-label={`Back ${DATA.step_min} minutes`}><StepBackIcon /></Button>
        <Button size="sm" onClick={toggle} className="min-w-24">{playing ? <><PauseIcon /> Pause</> : <><PlayIcon /> {t >= END ? "Replay" : t > 0 ? "Resume" : "Play"}</>}</Button>
        <Button size="sm" variant="outline" onClick={() => step(1)} aria-label={`Forward ${DATA.step_min} minutes`}><StepForwardIcon /></Button>
        <span className="ml-2 flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => setSpeedIx((i) => Math.max(0, i - 1))} disabled={speedIx === 0} aria-label="Slower"><ChevronsLeftIcon /> Slower</Button>
          <span className="min-w-28 text-center font-mono text-xs tabular-nums text-muted-foreground" aria-live="polite">1 s = {speed} min</span>
          <Button size="sm" variant="ghost" onClick={() => setSpeedIx((i) => Math.min(SPEEDS.length - 1, i + 1))} disabled={speedIx === SPEEDS.length - 1} aria-label="Faster">Faster <ChevronsRightIcon /></Button>
        </span>
        <input type="range" min={0} max={END} step={DATA.step_min} value={Math.round(t / DATA.step_min) * DATA.step_min}
          onChange={(e) => { setPlaying(false); seek(Number(e.target.value)); }}
          aria-label="Time of night" className="h-2 min-w-40 flex-1 cursor-pointer accent-[var(--accent)]" />
      </div>

      <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
        {DATA.levels.map((level) => {
          const l = frame.levels[String(level)];
          return (
            <div key={level} className="flex min-w-0 flex-col gap-1">
              <div className="flex min-w-0 items-baseline gap-2 text-sm">
                <span className="font-mono">{levelName(level)}</span>
                {l ? (
                  <>
                    <span className="font-mono text-lg font-semibold tabular-nums" style={{ color: BAND_COLOR[l.band] }}>{l.score}</span>
                    <span style={{ color: BAND_COLOR[l.band] }}>{l.band}</span>
                    <span className="min-w-0 truncate text-muted-foreground" title={`${l.by}: ${l.why}`}>· {l.by}: {l.why}</span>
                  </>
                ) : <span className="text-muted-foreground">no data yet</span>}
              </div>
              <LevelChart level={level} t={t} onSeek={(m) => { setPlaying(false); seek(m); }} />
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-1 border-t border-border pt-4 text-sm">
        <span className="caption">What happened {happened.length ? "" : "· press Play"}</span>
        {happened.map((m) => (
          <button key={`${m.t}-${m.text}`} onClick={() => { setPlaying(false); seek(m.t); }} className="flex gap-2 text-left hover:text-foreground">
            <span className="font-mono tabular-nums text-muted-foreground">{clock(m.t)}</span>
            <span className="font-mono">{levelName(m.level)}</span>
            <span className="text-foreground/80">{m.text}</span>
          </button>
        ))}
        <p className="pt-2 text-xs text-muted-foreground">
          Simulated: {DATA.event_count} signed events over {DATA.hours} hours, scored every {DATA.step_min} minutes by the hub&apos;s own rules
          (<code className="font-mono">hub/app/livability.py</code>), each time seeing only what had been signed by then. The same code scores the live
          index above. Click a chart or a ▼ marker to jump there; made by <code className="font-mono">hub/scripts/livability_replay.py</code>.
        </p>
      </div>
    </Card>
  );
}
