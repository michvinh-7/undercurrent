"use client";

import { useState } from "react";
import { UserSearchIcon } from "lucide-react";
import { Label, PhoneShell, ReportForm, TextArea, TextInput } from "@/components/phone";

export default function MissingPage() {
  const [name, setName] = useState("");
  const [lastLevel, setLastLevel] = useState("");
  const [lastSeen, setLastSeen] = useState("");
  const [description, setDescription] = useState("");

  const level = Number.parseInt(lastLevel, 10);
  const payload =
    name.trim() && level >= 1 && level <= 40
      ? {
          name: name.trim(),
          last_seen_level: level,
          ...(lastSeen && { last_seen_at: new Date(lastSeen).toISOString() }),
          ...(description.trim() && { description: description.trim() }),
          photo_id: null,
        }
      : null;

  return (
    <PhoneShell title="Report a missing person" icon={<UserSearchIcon />} hint="Someone you can't find.">
      <ReportForm
        type="missing_person"
        payload={payload}
        onSent={() => { setName(""); setLastLevel(""); setLastSeen(""); setDescription(""); }}
      >
        <label className="block">
          <Label>Their name</Label>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </label>
        <label className="block">
          <Label>Level they were last seen on</Label>
          <TextInput inputMode="numeric" pattern="[0-9]*" value={lastLevel} onChange={(e) => setLastLevel(e.target.value.replace(/\D/g, ""))} placeholder="1 to 40" />
        </label>
        <label className="block">
          <Label optional>When</Label>
          <TextInput type="datetime-local" value={lastSeen} onChange={(e) => setLastSeen(e.target.value)} />
        </label>
        <label className="block">
          <Label optional>What they look like, what they were wearing</Label>
          <TextArea value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
      </ReportForm>
    </PhoneShell>
  );
}
