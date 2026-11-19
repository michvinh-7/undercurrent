"use client";

import { useState } from "react";
import { TriangleAlertIcon } from "lucide-react";
import { Choice, Label, PhoneShell, ReportForm, TextArea, TextInput } from "@/components/phone";

type Kind = "flooding" | "bad_air" | "bad_water" | "heat" | "blackout" | "collapse" | "other";
type Severity = "low" | "medium" | "high";

const KINDS: { value: Kind; label: string }[] = [
  { value: "flooding", label: "Flooding" },
  { value: "bad_air", label: "Bad air / smoke" },
  { value: "bad_water", label: "Bad water" },
  { value: "heat", label: "Heat" },
  { value: "blackout", label: "Blackout" },
  { value: "collapse", label: "Collapse" },
  { value: "other", label: "Other" },
];

export default function HazardPage() {
  const [kind, setKind] = useState<Kind | null>(null);
  const [severity, setSeverity] = useState<Severity | null>(null);
  const [location, setLocation] = useState("");
  const [note, setNote] = useState("");

  const payload = kind && severity && {
    kind,
    severity,
    ...(location.trim() && { location: location.trim() }),
    ...(note.trim() && { note: note.trim() }),
  };

  return (
    <PhoneShell title="Report a hazard" icon={<TriangleAlertIcon />} hint="Something dangerous on your level.">
      <ReportForm
        type="hazard"
        payload={payload}
        onSent={() => { setKind(null); setSeverity(null); setLocation(""); setNote(""); }}
      >
        <div>
          <Label>What is it?</Label>
          <Choice value={kind} onChange={setKind} options={KINDS} />
        </div>
        <div>
          <Label>How bad?</Label>
          <Choice
            value={severity}
            onChange={setSeverity}
            columns={3}
            options={[
              { value: "low", label: "Low" },
              { value: "medium", label: "Medium" },
              { value: "high", label: "High", tone: "danger" },
            ]}
          />
        </div>
        <label className="block">
          <Label optional>Where exactly?</Label>
          <TextInput value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. East corridor by the pumps" />
        </label>
        <label className="block">
          <Label optional>Anything else</Label>
          <TextArea value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </ReportForm>
    </PhoneShell>
  );
}
