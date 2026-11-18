"use client";

// The 3D Hollow map. WebGL needs the browser, so the view loads client-side only.
// ?map=v2 opens the city-map rebuild; the default stays on the current map until it's signed off.
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

const loading = () => (
  <main className="flex min-h-[100dvh] items-center justify-center">
    <p className="caption">Loading the Hollow…</p>
  </main>
);
const HollowApp = dynamic(() => import("./HollowApp"), { ssr: false, loading });
const CityApp = dynamic(() => import("./city/CityApp"), { ssr: false, loading });

export default function HollowPage() {
  const [v2, setV2] = useState<boolean | null>(null);
  useEffect(() => setV2(new URLSearchParams(window.location.search).get("map") === "v2"), []);
  if (v2 === null) return loading();
  return v2 ? <CityApp /> : <HollowApp />;
}
