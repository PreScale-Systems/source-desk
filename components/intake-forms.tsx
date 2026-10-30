"use client";

import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { FileText, Sparkles } from "lucide-react";
import { z } from "zod";
import type { Condition, LeadInput, OfferInput, SalesState } from "@/lib/sales";
import {
  clarificationsSchema,
  leadIntakeSchema,
  offerIntakeSchema,
  parseLeadNote,
  parseOfferNote,
} from "@/lib/intake";
import type { IntakeResult, LeadIntake, OfferIntake } from "@/lib/intake";

const SAMPLE_LEAD = "Company: Meridian Design Studio; Contact: Ananya Rao; Email: ananya@example.test; Phone: +91 98765 43210; Qty: 2; AMD Ryzen 9; 32GB RAM; 2TB SSD; new; 1 year warranty; budget per unit: INR 115,000; delivery within 5 days; Address: 42 Sample Business Park, Pune 411001";
const SAMPLE_OFFER = "Model: ASUS Vivobook Pro 15; AMD Ryzen 9 7940HS; 32GB RAM; 2TB SSD; new; 1 year warranty; price: INR 89,500 + 18% GST; freight: INR 800; delivery in 3 days; available: 4";
const value = (input: number | null | undefined) => input === null || input === undefined ? "" : String(input);
const deviceCondition = (input: string): "" | Condition => input === "new" ? "New" : input === "refurbished" ? "Refurbished" : "";
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Could not read the note. Review the fields manually.";

async function extractLead(text: string): Promise<IntakeResult<LeadIntake> & { model?: string }> {
  const response = await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "lead", text }) });
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error(z.object({ error: z.string() }).safeParse(payload).data?.error || "Nemotron could not process the note.");
  return z.object({ data: leadIntakeSchema, clarifications: clarificationsSchema, mode: z.literal("nemotron"), model: z.string().optional() }).parse(payload);
}

async function extractOffer(text: string): Promise<IntakeResult<OfferIntake> & { model?: string }> {
  const response = await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "offer", text }) });
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error(z.object({ error: z.string() }).safeParse(payload).data?.error || "Nemotron could not process the note.");
  const result = z.object({ data: offerIntakeSchema.extend({ sourceText: z.string() }), clarifications: clarificationsSchema, mode: z.literal("nemotron"), model: z.string().optional() }).parse(payload);
  return { ...result, data: { ...result.data, sourceText: text } };
}

function Field({ label, children, full = false }: { label: string; children: ReactNode; full?: boolean }) {
  return <label className={`field${full ? " full" : ""}`}><span>{label}</span>{children}</label>;
}

function Clarifications({ questions }: { questions: string[] }) {
  if (!questions.length) return null;
  return <div className="note warning" role="status"><div><strong>Review these details</strong><ul style={{ paddingLeft: 17, margin: "7px 0 0" }}>{questions.map((question, index) => <li key={`${index}-${question}`}>{question}</li>)}</ul></div></div>;
}

function NotePanel({ kind, note, setNote, busy, mode, onExtract, error, clarifications }: {
  kind: "lead" | "offer";
  note: string;
  setNote: (text: string) => void;
  busy: boolean;
  mode: string;
  onExtract: (mode: "sample-rules" | "nemotron") => void;
  error: string;
  clarifications: string[];
}) {
  return <section className="surface">
    <div className="surface-head"><h2>{kind === "lead" ? "Start with the enquiry" : "Original distributor reply"}</h2><FileText size={17} className="muted" /></div>
    <div className="surface-body stack">
      <p className="muted" style={{ fontSize: 12, lineHeight: 1.8 }}>{kind === "lead" ? "Paste call notes, a WhatsApp message or an email. Extract the details, then check the editable fields." : "Paste the supplier’s WhatsApp or email reply. Keep the original message alongside the confirmed offer."}</p>
      <Field label={kind === "lead" ? "Customer enquiry" : "Supplier message"}>
        <textarea rows={11} maxLength={12000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Paste the original message…" />
      </Field>
      <div className="actions">
        <button className="btn small" type="button" disabled={busy || !note.trim()} onClick={() => onExtract("nemotron")}><Sparkles size={14} />{busy ? "Reading note…" : "Use Nemotron"}</button>
        <button className="btn primary small" type="button" disabled={busy || !note.trim()} onClick={() => onExtract("sample-rules")}>Sample rules</button>
        <button className="btn ghost small" type="button" disabled={busy} onClick={() => setNote(kind === "lead" ? SAMPLE_LEAD : SAMPLE_OFFER)}>Load sample</button>
      </div>
      <div className="note"><div>{mode || "Fill the fields manually or choose an extraction method."}<br /><span className="tiny">Sample rules use deterministic patterns. Nemotron runs only when a server key is configured. Every extracted detail needs review.</span></div></div>
      {error && <div className="note error" role="alert">{error}</div>}
      <Clarifications questions={clarifications} />
    </div>
  </section>;
}

function SpecFields({ fields, update, includeModel = false }: {
  fields: { model?: string; cpuModel?: string; cpuFamily: string; ramGb: string; ssdGb: string; condition: string; warrantyMonths: string };
  update: (key: string, input: string) => void;
  includeModel?: boolean;
}) {
  return <>
    {includeModel && <Field label="Laptop make and model" full><input required value={fields.model} onChange={(event) => update("model", event.target.value)} placeholder="ASUS Vivobook Pro 15" /></Field>}
    <Field label="Processor family" full><input required list="processor-families" value={fields.cpuFamily} onChange={(event) => update("cpuFamily", event.target.value)} placeholder="Confirm e.g. AMD Ryzen 9" /><datalist id="processor-families"><option value="AMD Ryzen 9" /><option value="AMD Ryzen 7" /><option value="Intel Core i7" /><option value="Intel Core Ultra 7" /></datalist></Field>
    {includeModel && <Field label="Exact processor model" full><input required value={fields.cpuModel} onChange={(event) => update("cpuModel", event.target.value)} placeholder="7940HS" /></Field>}
    <Field label="RAM (GB)"><input type="number" required min="1" step="1" value={fields.ramGb} onChange={(event) => update("ramGb", event.target.value)} placeholder="32" /></Field>
    <Field label="SSD (GB · 2 TB = 2000 GB)"><input type="number" required min="1" step="1" value={fields.ssdGb} onChange={(event) => update("ssdGb", event.target.value)} placeholder="2000" /></Field>
    <Field label="Device condition"><select required value={fields.condition} onChange={(event) => update("condition", event.target.value)}><option value="">Choose condition</option><option value="New">New</option><option value="Refurbished">Refurbished</option></select></Field>
    <Field label="Warranty (months · 0 = none)"><input type="number" required min="0" step="1" value={fields.warrantyMonths} onChange={(event) => update("warrantyMonths", event.target.value)} placeholder="12" /></Field>
  </>;
}

const emptyLead = { company: "", contact: "", email: "", phone: "", quantity: "", cpuFamily: "", ramGb: "", ssdGb: "", condition: "", warrantyMonths: "", budget: "", maxDeliveryDays: "", address: "" };

export function NewLeadForm({ onSave, onCancel }: { onSave: (input: LeadInput) => void; onCancel: () => void }) {
  const [note, setNote] = useState(SAMPLE_LEAD);
  const [fields, setFields] = useState(emptyLead);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState("");
  const [clarifications, setClarifications] = useState<string[]>([]);
  const [error, setError] = useState("");
  const update = (key: string, input: string) => setFields((current) => ({ ...current, [key]: input }));

  async function extract(method: "sample-rules" | "nemotron") {
    setError(""); setBusy(true);
    try {
      const result = method === "sample-rules" ? parseLeadNote(note) : await extractLead(note);
      const data = result.data;
      setFields({ company: data.company, contact: data.contact, email: data.email, phone: data.phone, quantity: value(data.quantity), cpuFamily: data.requirements.cpuFamily, ramGb: value(data.requirements.ramGb), ssdGb: value(data.requirements.ssdGb), condition: deviceCondition(data.requirements.condition), warrantyMonths: value(data.requirements.warrantyMonths), budget: value(data.budget), maxDeliveryDays: value(data.maxDeliveryDays), address: data.address });
      setClarifications(result.clarifications);
      setMode(method === "sample-rules" ? "Extracted with sample rules · no AI inference" : `Extracted with ${"model" in result && result.model ? result.model : "Nemotron"} on Nebius Token Factory`);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    if (!fields.company.trim() || !fields.contact.trim() || !fields.cpuFamily.trim() || !["New", "Refurbished"].includes(fields.condition)) { setError("Complete and confirm the required customer and specification fields."); return; }
    try {
      onSave({ company: fields.company.trim(), contact: fields.contact.trim(), email: fields.email.trim(), phone: fields.phone.trim(), notes: note, quantity: Number(fields.quantity), requirements: { cpuFamily: fields.cpuFamily.trim(), ramGb: Number(fields.ramGb), ssdGb: Number(fields.ssdGb), condition: fields.condition as Condition, warrantyMonths: Number(fields.warrantyMonths) }, budget: Number(fields.budget), maxDeliveryDays: Number(fields.maxDeliveryDays), address: fields.address.trim() });
    } catch (cause) { setError(errorMessage(cause)); }
  }

  return <div className="split-form">
      <NotePanel kind="lead" note={note} setNote={setNote} busy={busy} mode={mode} onExtract={extract} error={error} clarifications={clarifications} />
      <section className="surface"><div className="surface-head"><h2>Confirm the requirements</h2><span className="pill">Editable</span></div><form className="surface-body" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Customer company" full><input required value={fields.company} onChange={(event) => update("company", event.target.value)} placeholder="Company name" /></Field>
          <Field label="Contact name"><input required value={fields.contact} onChange={(event) => update("contact", event.target.value)} placeholder="Customer contact" /></Field>
          <Field label="Email (optional)"><input type="email" value={fields.email} onChange={(event) => update("email", event.target.value)} placeholder="contact@company.com" /></Field>
          <Field label="Phone (optional)"><input type="tel" value={fields.phone} onChange={(event) => update("phone", event.target.value)} placeholder="+91…" /></Field>
          <Field label="Laptop quantity"><input type="number" required min="1" step="1" value={fields.quantity} onChange={(event) => update("quantity", event.target.value)} placeholder="2" /></Field>
          <SpecFields fields={fields} update={update} />
          <Field label="Budget per laptop, excluding GST (INR)"><input type="number" required min="0.01" step="0.01" value={fields.budget} onChange={(event) => update("budget", event.target.value)} placeholder="115000" /></Field>
          <Field label="Delivery within (days)"><input type="number" required min="1" step="1" value={fields.maxDeliveryDays} onChange={(event) => update("maxDeliveryDays", event.target.value)} placeholder="5" /></Field>
          <Field label="Delivery address (can be added before dispatch)" full><textarea rows={2} value={fields.address} onChange={(event) => update("address", event.target.value)} placeholder="Customer delivery address" /></Field>
        </div><div className="form-footer"><button className="btn" type="button" onClick={onCancel}>Cancel</button><button className="btn primary" type="submit" disabled={busy}>Create lead</button></div>
      </form></section>
    </div>;
}

const emptyOffer = { distributorId: "", model: "", cpuFamily: "", cpuModel: "", ramGb: "", ssdGb: "", condition: "", warrantyMonths: "", unitCost: "", freight: "", deliveryDays: "", quantityAvailable: "", sourceChannel: "", validUntil: "" };
function nextWeekLocal() {
  const date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function NewOfferForm({ state, leadId, onSave, onCancel }: { state: SalesState; leadId: string; onSave: (input: OfferInput) => void; onCancel: () => void }) {
  const [note, setNoteState] = useState(SAMPLE_OFFER);
  const [fields, setFields] = useState(() => ({ ...emptyOffer, validUntil: nextWeekLocal() }));
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState("");
  const [clarifications, setClarifications] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [taxNote, setTaxNote] = useState("Confirm the unit cost excludes GST and freight covers the whole order. Missing values must be confirmed with the distributor.");
  const update = (key: string, input: string) => { setFields((current) => ({ ...current, [key]: input })); setReviewed(false); };
  const setNote = (text: string) => { setNoteState(text); setReviewed(false); };

  async function extract(method: "sample-rules" | "nemotron") {
    setError(""); setBusy(true); setReviewed(false);
    try {
      const result = method === "sample-rules" ? parseOfferNote(note) : await extractOffer(note);
      const data = result.data;
      const normalizedCost = data.unitCost !== null && data.taxIncluded === false
        ? data.unitCost
        : data.unitCost !== null && data.taxIncluded === true && data.gstRate !== null
          ? Math.round(data.unitCost / (1 + data.gstRate / 100) * 100) / 100
          : null;
      setFields((current) => ({ ...current, model: data.model, cpuFamily: data.cpuFamily, cpuModel: data.cpuModel, ramGb: value(data.ramGb), ssdGb: value(data.ssdGb), condition: deviceCondition(data.condition), warrantyMonths: value(data.warrantyMonths), unitCost: value(normalizedCost), freight: value(data.freight), deliveryDays: value(data.deliveryDays), quantityAvailable: value(data.quantityAvailable) }));
      setTaxNote(data.taxIncluded === true && data.gstRate !== null && normalizedCost !== null ? `Supplier price includes ${data.gstRate}% GST. Unit cost was converted to INR ${normalizedCost.toLocaleString("en-IN")} excluding GST. Confirm freight covers the whole order.` : normalizedCost === null ? "Tax treatment is incomplete. Confirm and enter the unit cost excluding GST manually; the supplier price has not been assumed to exclude tax." : "Supplier price explicitly excludes GST. Confirm this unit cost and the freight charge for the complete order.");
      setClarifications(result.clarifications);
      setMode(method === "sample-rules" ? "Extracted with sample rules · no AI inference" : `Extracted with ${"model" in result && result.model ? result.model : "Nemotron"} on Nebius Token Factory`);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    if (!reviewed || !note.trim()) { setError("Keep the original supplier message and confirm the reviewed offer before saving."); return; }
    if ([fields.unitCost, fields.freight, fields.ramGb, fields.ssdGb, fields.warrantyMonths, fields.deliveryDays, fields.quantityAvailable].some((input) => !input.trim() || !Number.isFinite(Number(input)))) { setError("Confirm every numeric field, including the unit cost and freight. Enter zero only when explicitly confirmed."); return; }
    if (!["WhatsApp", "Email"].includes(fields.sourceChannel) || !["New", "Refurbished"].includes(fields.condition)) { setError("Choose the source channel and device condition."); return; }
    if (!Number.isFinite(Date.parse(fields.validUntil)) || Date.parse(fields.validUntil) <= Date.now()) { setError("Confirm an offer validity date in the future."); return; }
    try {
      onSave({ leadId, distributorId: fields.distributorId, model: fields.model.trim(), cpuFamily: fields.cpuFamily.trim(), cpuModel: fields.cpuModel.trim(), ramGb: Number(fields.ramGb), ssdGb: Number(fields.ssdGb), condition: fields.condition as Condition, warrantyMonths: Number(fields.warrantyMonths), unitCost: Number(fields.unitCost), freight: Number(fields.freight), deliveryDays: Number(fields.deliveryDays), quantityAvailable: Number(fields.quantityAvailable), sourceChannel: fields.sourceChannel as "WhatsApp" | "Email", sourceText: note, validUntil: new Date(fields.validUntil).toISOString() });
    } catch (cause) { setError(errorMessage(cause)); }
  }

  return <div className="split-form">
      <NotePanel kind="offer" note={note} setNote={setNote} busy={busy} mode={mode} onExtract={extract} error={error} clarifications={clarifications} />
      <section className="surface"><div className="surface-head"><h2>Confirm the distributor offer</h2><span className="pill">Review required</span></div><form className="surface-body" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Distributor"><select required value={fields.distributorId} onChange={(event) => update("distributorId", event.target.value)}><option value="">Choose distributor</option>{state.distributors.map((distributor) => <option key={distributor.id} value={distributor.id}>{distributor.name}</option>)}</select></Field>
          <Field label="Reply received through"><select required value={fields.sourceChannel} onChange={(event) => update("sourceChannel", event.target.value)}><option value="">Choose channel</option><option value="WhatsApp">WhatsApp</option><option value="Email">Email</option></select></Field>
          <SpecFields fields={fields} update={update} includeModel />
          <Field label="Unit cost excluding GST (INR)"><input type="number" required min="0.01" step="0.01" value={fields.unitCost} onChange={(event) => update("unitCost", event.target.value)} placeholder="89500" /></Field>
          <Field label="Freight for the whole order (INR)"><input type="number" required min="0" step="0.01" value={fields.freight} onChange={(event) => update("freight", event.target.value)} placeholder="Confirm, including zero" /></Field>
          <Field label="Delivery lead time (days)"><input type="number" required min="0" step="1" value={fields.deliveryDays} onChange={(event) => update("deliveryDays", event.target.value)} placeholder="3" /></Field>
          <Field label="Confirmed quantity available"><input type="number" required min="1" step="1" value={fields.quantityAvailable} onChange={(event) => update("quantityAvailable", event.target.value)} placeholder="4" /></Field>
          <Field label="Offer valid until · confirm with distributor" full><input type="datetime-local" required value={fields.validUntil} onChange={(event) => update("validUntil", event.target.value)} /><span className="help-line">The initial date is a sample suggestion. Confirm the actual validity before saving.</span></Field>
          <div className="full note warning">{taxNote}</div>
          <label className="full check-label"><input type="checkbox" required checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} /><span>I checked the original reply and confirmed the configuration, available quantity, delivery, validity, unit cost excluding GST, and freight for this order.</span></label>
        </div><div className="form-footer"><button className="btn" type="button" onClick={onCancel}>Cancel</button><button className="btn primary" type="submit" disabled={busy || !reviewed}>Save supplier offer</button></div>
      </form></section>
    </div>;
}
