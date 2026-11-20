"use client";

// The phone home page is the site's root, but a judge opening the link on a laptop wants the
// overview. On a wide screen with a mouse, go there (keeping ?hub= and ?peer=). Add ?phone=1
// to stay on the phone page, for example when testing it in a wide browser window.

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function DesktopRedirect() {
  const router = useRouter();
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("phone")) return;
    if (window.matchMedia("(min-width: 1024px) and (pointer: fine)").matches) {
      router.replace(`/overview${window.location.search}`);
    }
  }, [router]);
  return null;
}
