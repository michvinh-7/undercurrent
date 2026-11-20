"use client";

// The phone home page is the site's root, but a judge opening the link on a laptop wants the
// overview. So when the browser loads "/" itself on a wide screen with a mouse, go there
// (keeping ?hub= and ?peer=). Only for that first load, and only once: moving around inside
// the site (the Phones tab, or Home on a phone page tested in a wide window) stays put.
// ?phone=1 always stays on the phone page, for example after a refresh.

import { useRouter } from "next/navigation";
import { useEffect } from "react";

let redirected = false; // once per page load: after it, "/" is somewhere the visitor chose

function loadedAtRoot(): boolean {
  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  try {
    return new URL(nav?.name ?? window.location.href).pathname === "/";
  } catch {
    return false;
  }
}

export function DesktopRedirect() {
  const router = useRouter();
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (redirected || params.get("phone") || !loadedAtRoot()) return;
    if (window.matchMedia("(min-width: 1024px) and (pointer: fine)").matches) {
      redirected = true;
      router.replace(`/overview${window.location.search}`);
    }
  }, [router]);
  return null;
}
