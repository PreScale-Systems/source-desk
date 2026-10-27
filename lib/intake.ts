import { z } from "zod";

// These parsers are deliberately limited sample rules, not model inference.
export const SAMPLE_PARSER_LABEL = "Sample parser · rules only";
export const MAX_INTAKE_CHARACTERS = 12_000;

const shortText = z.string().max(500);
const optionalNumber = z.number().finite().nonnegative().nullable();
const optionalInteger = z.number().int().nonnegative().nullable();
export const conditionSchema = z.enum(["", "new", "refurbished", "used"]);

export const leadIntakeSchema = z.object({
  company: shortText,
  contact: shortText,
  email: shortText,
  phone: shortText,
  quantity: z.number().int().positive().max(100_000).nullable(),
  requirements: z.object({
    cpuFamily: shortText,
    ramGb: optionalInteger,
    ssdGb: optionalInteger,
    condition: conditionSchema,
    warrantyMonths: optionalInteger,
  }).strict(),
  budget: optionalNumber,
  maxDeliveryDays: optionalInteger,
  address: z.string().max(2_000),
}).strict();

export const offerIntakeSchema = z.object({
  model: shortText,
  cpuFamily: shortText,
  cpuModel: shortText,
  ramGb: optionalInteger,
  ssdGb: optionalInteger,
  condition: conditionSchema,
  warrantyMonths: optionalInteger,
  unitCost: optionalNumber,
  freight: optionalNumber,
  deliveryDays: optionalInteger,
  quantityAvailable: optionalInteger,
  taxIncluded: z.boolean().nullable(),
  gstRate: z.number().finite().min(0).max(100).nullable(),
}).strict();

export const clarificationsSchema = z.array(z.string().min(1).max(500)).max(30);
export type LeadIntake = z.infer<typeof leadIntakeSchema>;
export type OfferIntake = z.infer<typeof offerIntakeSchema> & { sourceText: string };
export type IntakeResult<T> = {
  data: T;
  clarifications: string[];
  mode: "sample-rules" | "nemotron";
};

function boundedText(text: string): string {
  if (text.length > MAX_INTAKE_CHARACTERS) {
    throw new Error(`Use a note of ${MAX_INTAKE_CHARACTERS.toLocaleString("en-IN")} characters or fewer.`);
  }
  return text.trim();
}

function numberFrom(match: RegExpMatchArray | null, index = 1): number | null {
  if (!match) return null;
  const amount = Number(match[index].replaceAll(",", ""));
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function labelled(text: string, labels: string): string {
  return text.match(new RegExp(`(?:^|[;\\n])\\s*(?:${labels})\\s*:\\s*([^;\\n]+)`, "i"))?.[1].trim() ?? "";
}

function memory(text: string, kind: "ram" | "ssd"): number | null {
  const unit = kind === "ram" ? "(?:RAM|memory)" : "(?:SSD|NVMe|storage)";
  const after = text.match(new RegExp(`\\b(\\d+(?:\\.\\d+)?)\\s*(GB|TB)\\s*(?:DDR[345]\\s*)?${unit}\\b`, "i"));
  const before = text.match(new RegExp(`\\b${unit}\\s*[:=-]?\\s*(\\d+(?:\\.\\d+)?)\\s*(GB|TB)\\b`, "i"));
  const match = after ?? before;
  if (!match) return null;
  // Storage capacity is displayed in the manufacturers' decimal GB units.
  const gb = Number(match[1]) * (match[2].toLowerCase() === "tb" ? 1_000 : 1);
  return Number.isInteger(gb) ? gb : null;
}

function cpu(text: string): { family: string; model: string; ambiguous: boolean } {
  const ryzen = text.match(/\b(?:AMD\s+)?Ryzen\s+(?:AI\s+)?([3579])\b(?:\s+([0-9]{4,5}[A-Z]{0,4}))?/i);
  if (ryzen) return { family: `AMD Ryzen ${/\bAI\b/i.test(ryzen[0]) ? "AI " : ""}${ryzen[1]}`, model: ryzen[2] ?? "", ambiguous: false };
  const intel = text.match(/\b(?:Intel\s+)?(?:Core\s+)?(i[3579])(?:[-\s]+([0-9]{4,5}[A-Z]{0,4}))?\b/i);
  if (intel) return { family: `Intel Core ${intel[1].toLowerCase()}`, model: intel[2] ?? "", ambiguous: false };
  const ultra = text.match(/\b(?:Intel\s+)?Core\s+Ultra\s+([579])\b(?:\s+([0-9]{3}[A-Z]{0,3}))?/i);
  if (ultra) return { family: `Intel Core Ultra ${ultra[1]}`, model: ultra[2] ?? "", ambiguous: false };
  return { family: "", model: "", ambiguous: /\bAMD\s*[3579]\b/i.test(text) };
}

function condition(text: string): z.infer<typeof conditionSchema> {
  if (/\brefurb(?:ished)?\b/i.test(text)) return "refurbished";
  if (/\b(?:used|pre[- ]owned)\b/i.test(text)) return "used";
  if (/\b(?:new|brand[- ]new)\b/i.test(text)) return "new";
  return "";
}

function warranty(text: string): number | null {
  const match = text.match(/\b(\d+)\s*[- ]?\s*(months?|years?|mos?|yrs?)\s+(?:manufacturer\s+)?warranty\b/i)
    ?? text.match(/\bwarranty\s*[:=-]?\s*(\d+)\s*(months?|years?|mos?|yrs?)\b/i);
  if (!match) return null;
  return Number(match[1]) * (/^(?:year|yr)/i.test(match[2]) ? 12 : 1);
}

function delivery(text: string): number | null {
  return numberFrom(text.match(/\b(?:delivery|deliver|dispatch|lead\s*time|needed|required)(?:\s+(?:in|within|by))?\s*[:=-]?\s*(\d+)\s*days?\b/i)
    ?? text.match(/\b(?:within|in)\s+(\d+)\s*days?\b/i));
}

function amount(text: string, name: string): number | null {
  const match = text.match(new RegExp(`\\b(?:${name})\\s*[:=-]?\\s*(?:₹|INR|Rs\\.?\\s*)?\\s*([0-9][0-9,]*(?:\\.[0-9]+)?)\\s*(k|lakh|lakhs)?\\b`, "i"));
  const value = numberFrom(match);
  if (value === null) return null;
  return value * (match?.[2]?.toLowerCase() === "k" ? 1_000 : /^lakh/i.test(match?.[2] ?? "") ? 100_000 : 1);
}

function hasInrAmounts(text: string): boolean {
  return /₹|\b(?:INR|Rs\.?)\b/i.test(text) && !/[$€£]|\b(?:USD|EUR|GBP)\b/i.test(text);
}

function requirementClarifications(data: LeadIntake["requirements"], ambiguous: boolean): string[] {
  const questions: string[] = [];
  if (ambiguous) questions.push('Clarify "AMD 9": confirm the processor family, exact model or acceptable generation.');
  else if (!data.cpuFamily) questions.push("Confirm the required processor family and acceptable model or generation.");
  if (data.ramGb === null) questions.push("Confirm the required RAM capacity.");
  if (data.ssdGb === null) questions.push("Confirm the required SSD capacity.");
  if (!data.condition) questions.push("Confirm whether new, refurbished or used devices are acceptable.");
  if (data.warrantyMonths === null) questions.push("Confirm the required warranty period.");
  return questions;
}

/** Explicitly opt-in deterministic sample parser; unknown values remain empty. */
export function parseLeadNote(note: string): IntakeResult<LeadIntake> {
  const text = boundedText(note);
  const processor = cpu(text);
  const quantity = numberFrom(text.match(/\b(?:quantity|qty)\s*[:=-]?\s*(\d+)\b/i)
    ?? text.match(/\b(\d+)\s+(?:laptops?|devices?|units?|pcs|pieces)\b/i));
  const data: LeadIntake = {
    company: labelled(text, "company|customer|business"),
    contact: labelled(text, "contact|contact name|name"),
    email: text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0] ?? "",
    phone: labelled(text, "phone|mobile|tel"),
    quantity: quantity !== null && quantity > 0 ? quantity : null,
    requirements: {
      cpuFamily: processor.family,
      ramGb: memory(text, "ram"),
      ssdGb: memory(text, "ssd"),
      condition: condition(text),
      warrantyMonths: warranty(text),
    },
    budget: hasInrAmounts(text) ? amount(text, "budget\\s+per\\s+(?:unit|laptop)|max(?:imum)?\\s+price\\s+per\\s+(?:unit|laptop)") : null,
    maxDeliveryDays: delivery(text),
    address: labelled(text, "address|delivery address|ship to"),
  };
  const clarifications = requirementClarifications(data.requirements, processor.ambiguous);
  if (data.quantity === null) clarifications.push("Confirm the number of laptops required.");
  if (!data.company) clarifications.push("Add the customer company name.");
  if (data.maxDeliveryDays === null) clarifications.push("Confirm the delivery deadline.");
  if (data.budget === null && /\bbudget\b/i.test(text)) clarifications.push("Confirm whether the budget is per laptop or for the complete order.");
  if (/\bbudget\b/i.test(text) && !hasInrAmounts(text)) clarifications.push("Confirm the budget in INR; the sample parser does not assume or convert currencies.");
  return { data: leadIntakeSchema.parse(data), clarifications, mode: "sample-rules" };
}

/** Explicitly opt-in deterministic sample parser; preserves the original reply. */
export function parseOfferNote(note: string): IntakeResult<OfferIntake> {
  const text = boundedText(note);
  const processor = cpu(text);
  const gst = text.match(/\b(?:GST|tax)\s*[:=@-]?\s*(\d+(?:\.\d+)?)\s*%/i)
    ?? text.match(/\b(\d+(?:\.\d+)?)\s*%\s*(?:GST|tax)\b/i);
  const taxIncluded = /\b(?:incl(?:uded|usive)?\.?\s*(?:of\s*)?(?:GST|tax)|(?:GST|tax)\s*included)\b/i.test(text)
    ? true
    : /\b(?:excl(?:uded|usive)?\.?\s*(?:of\s*)?(?:GST|tax)|(?:GST|tax)\s*(?:extra|additional))\b/i.test(text) || /\+\s*(?:\d+(?:\.\d+)?\s*%\s*)?(?:GST|tax)\b/i.test(text)
      ? false : null;
  const freight = /\b(?:free\s+(?:shipping|delivery)|(?:freight|shipping)\s*(?::|is)?\s*(?:free|included))\b/i.test(text)
    ? 0 : hasInrAmounts(text) ? amount(text, "freight|shipping(?:\\s+cost)?") : null;
  const unitCost = hasInrAmounts(text)
    ? amount(text, "unit(?:\\s+cost|\\s+price)?|price(?:\\s+per\\s+(?:unit|laptop))?|rate")
      ?? numberFrom(text.match(/(?:₹|INR|Rs\.?)\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:\/\s*(?:unit|piece|pc)|(?:per|each)\s*(?:unit|laptop)?)/i))
    : null;
  const data = offerIntakeSchema.parse({
    model: labelled(text, "model|laptop"),
    cpuFamily: processor.family,
    cpuModel: processor.model,
    ramGb: memory(text, "ram"),
    ssdGb: memory(text, "ssd"),
    condition: condition(text),
    warrantyMonths: warranty(text),
    unitCost,
    freight,
    deliveryDays: delivery(text),
    quantityAvailable: numberFrom(text.match(/\b(?:available|stock|quantity|qty)\s*[:=-]?\s*(\d+)\b/i)
      ?? text.match(/\b(\d+)\s*(?:units?|pcs|pieces)\s*(?:available|in stock)\b/i)),
    taxIncluded,
    gstRate: numberFrom(gst),
  });
  const clarifications = requirementClarifications(data, processor.ambiguous);
  if (!data.model) clarifications.push("Confirm the exact laptop make and model.");
  if (data.unitCost === null) clarifications.push("Confirm the unit price and currency.");
  if (data.freight === null) clarifications.push("Confirm freight charges; missing freight is not assumed to be free.");
  if (data.deliveryDays === null) clarifications.push("Confirm the delivery lead time.");
  if (data.quantityAvailable === null) clarifications.push("Confirm the available quantity.");
  if (data.taxIncluded === null || data.gstRate === null) clarifications.push("Confirm the GST rate and whether the unit price includes GST.");
  return { data: { ...data, sourceText: note }, clarifications, mode: "sample-rules" };
}

/** Applies the same ambiguity rule to model output as to the sample parser. */
export function enforceProcessorClarification<T extends LeadIntake | OfferIntake>(
  text: string,
  data: T,
  clarifications: string[],
): IntakeResult<T> {
  const isAmbiguous = /\bAMD\s*[3579]\b/i.test(text) && !/\bRyzen\b/i.test(text);
  if (!isAmbiguous) return { data, clarifications, mode: "nemotron" };
  const copy = "requirements" in data
    ? { ...data, requirements: { ...data.requirements, cpuFamily: "" } }
    : { ...data, cpuFamily: "", cpuModel: "" };
  return {
    data: copy,
    clarifications: [...new Set([...clarifications, 'Clarify "AMD 9": confirm the processor family, exact model or acceptable generation.'])],
    mode: "nemotron",
  };
}
