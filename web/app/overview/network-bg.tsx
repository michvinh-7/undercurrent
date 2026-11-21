"use client";

// The Overview's background: a faint underground network. Nodes sit at three depths (far ones
// small, dim and slow; near ones larger and brighter), nearby nodes at a similar depth are linked,
// and now and then a "signed message" pulse runs along a link. It follows the mouse a little for
// depth. Decorative only: aria-hidden, no pointer events, paused when the tab is hidden, and a
// single still frame for anyone who prefers reduced motion.

import { useEffect, useRef } from "react";

interface Node { x: number; y: number; z: number; vx: number; vy: number }
interface Packet { a: number; b: number; t: number; green: boolean }

export function NetworkBackground() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#8b7cf6";
    const ok = getComputedStyle(document.documentElement).getPropertyValue("--ok").trim() || "#22c55e";
    const rgb = (hex: string) => {
      const h = hex.replace("#", "");
      const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
      return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
    };
    const A = rgb(accent), G = rgb(ok);

    let w = 0, h = 0, nodes: Node[] = [], packets: Packet[] = [], raf = 0, last = performance.now(), spawn = 0;
    const mouse = { x: 0, y: 0, tx: 0, ty: 0 };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth; h = window.innerHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(70, Math.round((w * h) / 24000));
      nodes = Array.from({ length: count }, () => {
        const z = [0.35, 0.6, 1][Math.floor(Math.random() * 3)];
        const speed = 0.012 * z;
        const ang = Math.random() * Math.PI * 2;
        return { x: Math.random() * w, y: Math.random() * h, z, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed };
      });
      packets = [];
    };

    const pos = (n: Node) => [n.x + mouse.x * 14 * n.z, n.y + mouse.y * 10 * n.z] as const;
    const linked = (a: Node, b: Node) => Math.abs(a.z - b.z) < 0.01 && Math.hypot(a.x - b.x, a.y - b.y) < 120 + 90 * a.z;

    const draw = (dt: number) => {
      ctx.clearRect(0, 0, w, h);
      mouse.x += (mouse.tx - mouse.x) * 0.04;
      mouse.y += (mouse.ty - mouse.y) * 0.04;
      for (const n of nodes) {
        n.x += n.vx * dt; n.y += n.vy * dt;
        if (n.x < -40) n.x = w + 40; if (n.x > w + 40) n.x = -40;
        if (n.y < -40) n.y = h + 40; if (n.y > h + 40) n.y = -40;
      }
      // Links, far layer first so near ones sit on top.
      for (const z of [0.35, 0.6, 1]) {
        for (let i = 0; i < nodes.length; i++) {
          const a = nodes[i];
          if (a.z !== z) continue;
          const [ax, ay] = pos(a);
          for (let j = i + 1; j < nodes.length; j++) {
            const b = nodes[j];
            if (!linked(a, b)) continue;
            const [bx, by] = pos(b);
            const d = Math.hypot(ax - bx, ay - by), max = 120 + 90 * z;
            ctx.strokeStyle = `rgba(${A}, ${(1 - d / max) * 0.22 * z})`;
            ctx.lineWidth = 0.6 + 0.6 * z;
            ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
          }
        }
        for (const n of nodes) {
          if (n.z !== z) continue;
          const [x, y] = pos(n);
          ctx.fillStyle = `rgba(${A}, ${0.18 + 0.5 * z})`;
          ctx.beginPath(); ctx.arc(x, y, 0.8 + 1.8 * z, 0, Math.PI * 2); ctx.fill();
        }
      }
      // Message pulses travelling along links.
      spawn += dt;
      if (spawn > 650 && packets.length < 10) {
        spawn = 0;
        for (let tries = 0; tries < 20; tries++) {
          const a = Math.floor(Math.random() * nodes.length), b = Math.floor(Math.random() * nodes.length);
          if (a !== b && nodes[a].z >= 0.6 && linked(nodes[a], nodes[b])) { packets.push({ a, b, t: 0, green: Math.random() < 0.25 }); break; }
        }
      }
      packets = packets.filter((p) => (p.t += dt / 1400) < 1 && linked(nodes[p.a], nodes[p.b]));
      for (const p of packets) {
        const [ax, ay] = pos(nodes[p.a]), [bx, by] = pos(nodes[p.b]);
        const x = ax + (bx - ax) * p.t, y = ay + (by - ay) * p.t;
        const c = p.green ? G : A, fade = Math.sin(Math.PI * p.t);
        const glow = ctx.createRadialGradient(x, y, 0, x, y, 10);
        glow.addColorStop(0, `rgba(${c}, ${0.7 * fade})`);
        glow.addColorStop(1, `rgba(${c}, 0)`);
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.fill();
      }
    };

    const loop = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      if (!document.hidden) draw(dt);
      raf = requestAnimationFrame(loop);
    };
    const onMove = (e: PointerEvent) => { mouse.tx = e.clientX / w - 0.5; mouse.ty = e.clientY / h - 0.5; };

    resize();
    window.addEventListener("resize", resize);
    if (still) draw(0);
    else {
      window.addEventListener("pointermove", onMove);
      raf = requestAnimationFrame(loop);
    }
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 opacity-80 [mask-image:radial-gradient(ellipse_at_50%_35%,black_35%,transparent_85%)]"
    />
  );
}
