"use client";

import { useState } from "react";
import { Choice, Label, PhoneShell, ReportForm, TextArea, TextInput } from "@/components/phone";

const SYMPTOMS = [
  "fever", "cough", "vomiting", "diarrhea", "rash", "headache",
  "shortness of breath", "dizziness", "bleeding", "stomach pain",
].map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }));

export default function SymptomsPage() {
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [people, setPeople] = useState("");
  const [text, setText] = useState("");

  const toggle = (s: string) => setSymptoms((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  const count = Number.parseInt(people, 10);
  const payload =
    symptoms.length || text.trim()
      ? {
          symptoms,
          ...(count >= 1 && { people_affected: count }),
          ...(text.trim() && { raw_text: text.trim() }),
          photo_id: null,
          medical_card: null,
        }
      : null;

  return (
    <PhoneShell
      title="Report symptoms"
      hint="Tell responders what you're seeing. This records symptoms. It does not diagnose."
    >
      <ReportForm type="case" payload={payload} onSent={() => { setSymptoms([]); setPeople(""); setText(""); }}>
        <div>
          <Label>Symptoms (tap all that apply)</Label>
          <Choice value={symptoms} onChange={toggle} options={SYMPTOMS} />
        </div>
        <label className="block">
          <Label optional>How many people have this?</Label>
          <TextInput inputMode="numeric" pattern="[0-9]*" value={people} onChange={(e) => setPeople(e.target.value.replace(/\D/g, ""))} />
        </label>
        <label className="block">
          <Label optional>Describe what's happening</Label>
          <TextArea value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. My dad and brother can't stop coughing since last night" />
        </label>
      </ReportForm>
    </PhoneShell>
  );
}
