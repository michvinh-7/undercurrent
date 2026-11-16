"use client";

import { useState } from "react";
import { Choice, Label, PhoneShell, ReportForm, TextArea, TextInput } from "@/components/phone";

export default function CheckinPage() {
  const [status, setStatus] = useState<"ok" | "need_help" | null>(null);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");

  const payload = status && {
    status,
    ...(name.trim() && { name: name.trim() }),
    ...(note.trim() && { note: note.trim() }),
  };

  return (
    <PhoneShell title="Check in" hint="Let people know where you are and how you're doing.">
      <ReportForm type="checkin" payload={payload} onSent={() => { setStatus(null); setNote(""); }}>
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
