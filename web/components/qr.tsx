"use client";

// A QR code as inline SVG (qrcode-generator, no network). Always dark modules on white with
// a quiet zone, whatever the page theme, because phone cameras need that contrast.

import qrcode from "qrcode-generator";
import { useMemo } from "react";

export function QR({ value, label, size = 240 }: { value: string; label: string; size?: number }) {
  const { n, path } = useMemo(() => {
    const code = qrcode(0, "M"); // 0: smallest version that fits
    code.addData(value, "Byte");
    code.make();
    const n = code.getModuleCount();
    let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (code.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
    return { n, path: d };
  }, [value]);
  const box = n + 8; // 4-module quiet zone on each side
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${box} ${box}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className="mx-auto block h-auto max-w-full rounded-lg"
    >
      <rect width={box} height={box} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
