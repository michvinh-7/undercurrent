"use client";

// The 3D Hollow map. WebGL needs the browser, so the whole view loads client-side only.
import dynamic from "next/dynamic";

const HollowApp = dynamic(() => import("./HollowApp"), {
  ssr: false,
  loading: () => (
    <main className="flex min-h-[100dvh] items-center justify-center">
      <p className="caption">Loading the Hollow…</p>
    </main>
  ),
});

export default function HollowPage() {
  return <HollowApp />;
}
