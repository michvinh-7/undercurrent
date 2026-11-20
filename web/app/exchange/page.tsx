"use client";

// Have / Need board on a resident's phone (questions 2, 6, 10 and 12). Post what you have
// spare or what you need, signed like any report; see what's open across the hubs and the
// matches the hub suggests; mark your own posts done. The board's rules live on the hub
// (hub/app/exchange.py): only the key that posted can close a post.

import { useCallback, useEffect, useState } from "react";
import { ArrowRightLeftIcon, CheckIcon, LoaderCircleIcon } from "lucide-react";
import { Choice, Label, Notice, PhoneShell, ReportForm, TextInput } from "@/components/phone";
import { Button } from "@/components/ui/button";
import { addEvent, hubUrl } from "@/lib/hub";
import { timeAgo } from "@/lib/format";
import { loadIdentity, prepare } from "@/lib/sign";

type Side = "have" | "need";
type Category = "space" | "food" | "water" | "medicine" | "power" | "other";

const CATEGORIES: { value: Category; label: string }[] = [
  { value: "medicine", label: "Medicine" },
  { value: "water", label: "Water" },
  { value: "food", label: "Food or seeds" },
  { value: "power", label: "Power" },
  { value: "space", label: "Space or a bed" },
  { value: "other", label: "Other" },
];

interface Post {
  id: string;
  side: Side;
  category: Category;
  item: string;
  quantity: number | null;
  location: string | null;
  level: number;
  author: string;
  author_pub: string | null;
  signed: boolean;
  simulated: boolean;
  created_at: string;
  matched: boolean;
}
interface Match { need_id: string; have_id: string; category: Category; need_level: number; have_level: number }
interface Board { needs: Post[]; haves: Post[]; matches: Match[] }

export default function ExchangePage() {
  const [side, setSide] = useState<Side | null>(null);
  const [category, setCategory] = useState<Category | null>(null);
  const [item, setItem] = useState("");
  const [qty, setQty] = useState("");
  const [location, setLocation] = useState("");
  const [board, setBoard] = useState<Board | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${hubUrl()}/exchange`, { cache: "no-store" });
      if (res.ok) setBoard((await res.json()) as Board);
    } catch {}
  }, []);

  useEffect(() => {
    setMe(loadIdentity().pub);
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  const n = Number.parseInt(qty, 10);
  const payload =
    side && category && item.trim()
      ? { side, category, item: item.trim(), ...(n >= 1 && { quantity: n }), ...(location.trim() && { location: location.trim() }) }
      : null;

  async function markDone(p: Post) {
    setClosing(p.id);
    setCloseError(null);
    try {
      const { event } = await prepare({ type: "exchange", level: p.level, author: p.author, payload: { closes: p.id } }, hubUrl());
      await addEvent(event);
      await refresh();
    } catch (err) {
      setCloseError(err instanceof Error ? err.message.replace(/^Hub returned \d+: /, "") : "Couldn't reach the hub.");
    } finally {
      setClosing(null);
    }
  }

  const byId = new Map([...(board?.needs ?? []), ...(board?.haves ?? [])].map((p) => [p.id, p]));
  const mine = (p: Post) => !!me && p.author_pub === me;

  return (
    <PhoneShell title="Have / Need" eyebrow="Share what's left" icon={<ArrowRightLeftIcon />} hint="Post what you can spare or what you need. The hubs match needs with the nearest offer, most urgent and longest-waiting first.">
      <ReportForm type="exchange" payload={payload} onSent={() => { setItem(""); setQty(""); setLocation(""); refresh(); }}>
        <div>
          <Label>I...</Label>
          <Choice value={side} onChange={setSide} options={[{ value: "need", label: "Need something" }, { value: "have", label: "Have something spare" }]} />
        </div>
        <div>
          <Label>What kind?</Label>
          <Choice value={category} onChange={setCategory} options={CATEGORIES} />
        </div>
        <label className="block">
          <Label>What exactly?</Label>
          <TextInput value={item} onChange={(e) => setItem(e.target.value)} maxLength={120} placeholder={side === "have" ? "e.g. 2 spare beds" : "e.g. Rehydration salts for 2 kids"} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <Label optional>How many</Label>
            <TextInput inputMode="numeric" pattern="[0-9]*" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))} />
          </label>
          <label className="block">
            <Label optional>Where</Label>
            <TextInput value={location} onChange={(e) => setLocation(e.target.value)} maxLength={60} placeholder="e.g. North Gallery" />
          </label>
        </div>
      </ReportForm>

      <section className="mt-10 space-y-3">
        <div className="flex items-baseline justify-between">
          <p className="caption">Open on the board</p>
          {board && <span className="font-mono text-xs text-muted-foreground">{board.needs.length} needs · {board.haves.length} offers · {board.matches.length} matched</span>}
        </div>
        {closeError && <Notice tone="danger">{closeError}</Notice>}
        {!board && <p className="flex items-center gap-2 text-muted-foreground"><LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" /> Loading the board…</p>}
        {board && board.needs.length + board.haves.length === 0 && <p className="text-muted-foreground">Nothing posted yet.</p>}
        <ul className="space-y-2">
          {[...(board?.needs ?? []), ...(board?.haves ?? [])].map((p) => {
            const m = board?.matches.find((x) => x.need_id === p.id || x.have_id === p.id);
            const other = m ? byId.get(p.side === "need" ? m.have_id : m.need_id) : undefined;
            return (
              <li key={p.id} className="rounded-xl border border-border bg-card px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      <span style={{ color: p.side === "need" ? "var(--warn)" : "var(--ok)" }}>{p.side === "need" ? "Needs" : "Has"}</span> · {p.item}
                      {p.quantity ? ` × ${p.quantity}` : ""}
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                      {p.category} · L{p.level}{p.location ? ` · ${p.location}` : ""} · {timeAgo(p.created_at)}
                      {p.simulated ? " · simulated" : ""}{p.signed ? " · signed" : ""}
                    </p>
                    {other && (
                      <p className="mt-1.5 text-sm text-foreground/85">
                        Match: {other.side === "have" ? "offered" : "needed"} on L{other.level} ({other.item})
                      </p>
                    )}
                  </div>
                  {mine(p) && (
                    <Button variant="outline" size="sm" onClick={() => markDone(p)} disabled={closing === p.id}>
                      {closing === p.id ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : <CheckIcon aria-hidden="true" />} Done
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </PhoneShell>
  );
}
