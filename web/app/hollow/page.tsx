"use client";

// The Hollow map. WebGL needs the browser, so the view loads client-side only.
import dynamic from "next/dynamic";

const CityApp = dynamic(() => import("./city/CityApp"), {
  ssr: false,
  loading: () => (
    <main className="flex min-h-[100dvh] items-center justify-center">
      <p className="caption">Loading the Hollow…</p>
    </main>
  ),
});

export default function HollowPage() {
  return <CityApp />;
}
