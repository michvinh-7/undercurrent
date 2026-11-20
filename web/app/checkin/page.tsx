"use client";

import { useState } from "react";
import { UserCheckIcon } from "lucide-react";
import { Choice, Label, PhoneShell, ReportForm, TextArea, TextInput } from "@/components/phone";

export default function CheckinPage() {
  const [status, setStatus] = useState<"ok" | "need_help" | null>(null);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  // Optional, for question 11 (what living underground does to people): whole numbers only.
  const [sleep, setSleep] = useState<string | null>(null);
  const [mood, setMood] = useState<string | null>(null);

  const payload = status && {
    status,
    ...(name.trim() && { name: name.trim() }),
    ...(note.trim() && { note: note.trim() }),
    ...(sleep !== null && { sleep_h: Number(sleep) }),
    ...(mood !== null && { mood: Number(mood) }),
  };

  return (
    <PhoneShell title="Check in" icon={<UserCheckIcon />} hint="Let people know where you are and how you're doing.">
      <ReportForm type="checkin" payload={payload} onSent={() => { setStatus(null); setNote(""); setSleep(null); setMood(null); }}>
        <div>
          <Label>How are you?</Label>
          <Choice
            value={status}
            onChange={setStatus}
            options={[
              { value: "ok", label: "I'm OK", tone: "ok" },
              { value: "need_help", label: "I need help", tone: "danger" },
            ]}
          />
        </div>
        <div>
          <Label optional>Hours slept last night</Label>
          <Choice
            value={sleep}
            onChange={(v) => setSleep(sleep === v ? null : v)}
            columns={4}
            options={[
              { value: "3", label: "< 4 h" },
              { value: "5", label: "4–6 h" },
              { value: "7", label: "6–8 h" },
              { value: "9", label: "8+ h" },
            ]}
          />
        </div>
        <div>
          <Label optional>How are you feeling?</Label>
          <Choice
            value={mood}
            onChange={(v) => setMood(mood === v ? null : v)}
            columns={5}
            options={[
              { value: "1", label: "1" },
              { value: "2", label: "2" },
              { value: "3", label: "3" },
              { value: "4", label: "4" },
              { value: "5", label: "5" },
            ]}
          />
          <p className="mt-2 flex justify-between text-xs text-muted-foreground"><span>1 = awful</span><span>5 = great</span></p>
          <p className="mt-1 text-xs text-muted-foreground">Only shown as an average for your level, and only once 2 or more people answer.</p>
        </div>
        <label className="block">
          <Label optional>Name, so family can find you</Label>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </label>
        <label className="block">
          <Label optional>Note</Label>
          <TextArea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Safe at the pump room with the kids" />
        </label>
      </ReportForm>
    </PhoneShell>
  );
}
