"use client";

// Do the two hubs hold exactly the same events? The primary hub's GET /sync/status says so:
// `fingerprint` (a hash over every stored event) and `agrees_with` {peer url: true | false |
// null}, null while the link is cut or the peer isn't answering. Polled every 3 s.

import { useEffect, useState } from "react";

export interface Agreement {
  fingerprint: string | null;
  /** true: same events; false: still catching up; null: unknown (cut, peer down, no peer). */
  agrees: boolean | null;
}

export function useAgreement(primaryUrl: string | null, enabled: boolean): Agreement {
  const [state, setState] = useState<Agreement>({ fingerprint: null, agrees: null });
  useEffect(() => {
    if (!primaryUrl || !enabled) {
      setState({ fingerprint: null, agrees: null });
      return;
    }
    let stop = false;
    async function poll() {
      try {
        const res = await fetch(`${primaryUrl}/sync/status`, { cache: "no-store", signal: AbortSignal.timeout(1500) });
        if (!res.ok) throw new Error(String(res.status));
        const s = (await res.json()) as { fingerprint?: string; agrees_with?: Record<string, boolean | null> };
        const votes = Object.values(s.agrees_with ?? {});
        const agrees = votes.length === 0 ? null : votes.includes(false) ? false : votes.includes(null) ? null : true;
        if (!stop) setState({ fingerprint: s.fingerprint ?? null, agrees });
      } catch {
        if (!stop) setState({ fingerprint: null, agrees: null });
      }
    }
    poll();
    const t = setInterval(poll, 3000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [primaryUrl, enabled]);
  return state;
}
