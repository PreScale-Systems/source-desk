import assert from "node:assert/strict";
import { test } from "node:test";
import { enforceProcessorClarification, parseLeadNote, parseOfferNote } from "../lib/intake.ts";
import type { IntakeResult, OfferIntake } from "../lib/intake.ts";
import { POST } from "../app/api/ai/route.ts";

test("sample parser flags AMD 9 instead of inventing a processor family", () => {
  const result = parseLeadNote("Company: Prakash Design; 3 laptops, AMD 9, 32 GB RAM, 2 TB SSD");
  assert.equal(result.mode, "sample-rules");
  assert.equal(result.data.requirements.cpuFamily, "");
  assert.equal(result.data.quantity, 3);
  assert.ok(result.clarifications.some((question) => question.includes('"AMD 9"')));
});

test("sample parser handles explicit units and leaves model generation unspecified", () => {
  const result = parseLeadNote("Company: Vertex Works; Contact: Meera Shah; Email: meera@example.test; Qty: 2; AMD Ryzen 9; 32GB RAM, 2TB SSD; new; 1 year warranty; budget per unit: INR 95,000; delivery within 5 days; Address: 18 Sample Road, Pune");
  assert.equal(result.data.company, "Vertex Works");
  assert.equal(result.data.contact, "Meera Shah");
  assert.equal(result.data.email, "meera@example.test");
  assert.equal(result.data.requirements.cpuFamily, "AMD Ryzen 9");
  assert.equal(result.data.requirements.ramGb, 32);
  assert.equal(result.data.requirements.ssdGb, 2_000);
  assert.equal(result.data.requirements.warrantyMonths, 12);
  assert.equal(result.data.budget, 95_000);
  assert.equal(result.data.maxDeliveryDays, 5);
  assert.equal(result.data.address, "18 Sample Road, Pune");
});

test("sample parser preserves unknown facts on a minimal lead", () => {
  const { data, clarifications } = parseLeadNote("Need a laptop.");
  assert.equal(data.quantity, null);
  assert.equal(data.budget, null);
  assert.equal(data.requirements.ramGb, null);
  assert.equal(data.requirements.ssdGb, null);
  assert.equal(data.requirements.condition, "");
  assert.equal(data.contact, "");
  assert.ok(clarifications.length > 0);
});

test("an unqualified budget is not silently treated as a unit budget", () => {
  const { data, clarifications } = parseLeadNote("Need 3 laptops; budget: INR 95,000");
  assert.equal(data.budget, null);
  assert.ok(clarifications.some((question) => question.includes("complete order")));
});

test("supplier extraction distinguishes price, freight and GST terms", () => {
  const source = "Model: Lenovo ThinkPad P16v; AMD Ryzen 9 7940HS; 32GB RAM; SSD: 2TB; new; warranty: 3 years; price: INR 92,000 + 18% GST; freight: INR 700; delivery in 4 days; available: 5";
  const { data } = parseOfferNote(source);
  assert.equal(data.model, "Lenovo ThinkPad P16v");
  assert.equal(data.cpuFamily, "AMD Ryzen 9");
  assert.equal(data.cpuModel, "7940HS");
  assert.equal(data.unitCost, 92_000);
  assert.equal(data.freight, 700);
  assert.equal(data.gstRate, 18);
  assert.equal(data.taxIncluded, false);
  assert.equal(data.quantityAvailable, 5);
  assert.equal(data.warrantyMonths, 36);
  assert.equal(data.deliveryDays, 4);
  assert.equal(data.sourceText, source);
});

test("unknown supplier GST and freight are not silently assumed to be zero", () => {
  const { data, clarifications } = parseOfferNote("Model: Sample Laptop; AMD Ryzen 9; 32GB RAM; 1TB SSD; price: INR 80,000");
  assert.equal(data.freight, null);
  assert.equal(data.gstRate, null);
  assert.equal(data.taxIncluded, null);
  assert.ok(clarifications.some((question) => question.includes("GST")));
  assert.ok(clarifications.some((question) => question.includes("freight")));
});

test("explicit free freight and tax-inclusive pricing are recognized", () => {
  const { data } = parseOfferNote("Model: Sample Laptop; price: INR 82,600 incl GST; GST: 18%; freight included; RAM: 16GB; SSD: 512GB");
  assert.equal(data.taxIncluded, true);
  assert.equal(data.freight, 0);
  assert.equal(data.ramGb, 16);
  assert.equal(data.ssdGb, 512);
});

test("a supplier price with missing or foreign currency is not assumed to be INR", () => {
  assert.equal(parseOfferNote("Model: Sample Laptop; price: 90000").data.unitCost, null);
  assert.equal(parseOfferNote("Model: Sample Laptop; price: USD 1100").data.unitCost, null);
});

test("the model cannot silently normalize AMD 9 either", () => {
  const baseline = parseLeadNote("AMD Ryzen 9, 32GB RAM, 2TB SSD").data;
  const result = enforceProcessorClarification("AMD 9, 32GB RAM, 2TB SSD", baseline, []);
  assert.equal(result.data.requirements.cpuFamily, "");
  assert.equal(result.mode, "nemotron");
  assert.ok(result.clarifications.some((question) => question.includes("Clarify")));
});

test("oversized notes are rejected rather than truncated", () => {
  assert.throws(() => parseLeadNote("x".repeat(12_001)), /12,000 characters/);
});

function request(payload: unknown): Request {
  return new Request("https://example.test/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

test("API rejects invalid requests and reports unconfigured Nemotron without pretending to run AI", async () => {
  const previous = process.env.NEBIUS_API_KEY;
  delete process.env.NEBIUS_API_KEY;
  try {
    const invalid = await POST(request({ kind: "other", text: "A laptop" }));
    assert.equal(invalid.status, 400);
    const oversized = await POST(request({ kind: "lead", text: "x".repeat(12_001) }));
    assert.equal(oversized.status, 400);
    const response = await POST(request({ kind: "lead", text: "A laptop" }));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: "Nemotron is not configured. Use manual entry or the clearly labelled sample parser.",
    });
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  } finally {
    if (previous === undefined) delete process.env.NEBIUS_API_KEY;
    else process.env.NEBIUS_API_KEY = previous;
  }
});

test("API validates provider output, preserves source text and retains the ambiguity guard", async () => {
  const previousKey = process.env.NEBIUS_API_KEY;
  const previousModel = process.env.NEBIUS_MODEL;
  const originalFetch = globalThis.fetch;
  process.env.NEBIUS_API_KEY = "test-key-not-a-real-secret";
  process.env.NEBIUS_MODEL = "test-nemotron-model";
  const source = "  AMD 9, 32GB RAM, 2TB SSD; price: INR 90,000  ";
  const sample = parseOfferNote(source).data;
  const { sourceText: _ignored, ...modelData } = sample;
  void _ignored;
  let providerCalls = 0;
  globalThis.fetch = async (url, options) => {
    providerCalls += 1;
    assert.equal(url, "https://api.tokenfactory.nebius.com/v1/chat/completions");
    const body = JSON.parse(String(options?.body));
    assert.equal(body.model, "test-nemotron-model");
    assert.equal(body.messages[1].content, source);
    assert.equal(options?.headers && new Headers(options.headers).get("Authorization"), "Bearer test-key-not-a-real-secret");
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ data: { ...modelData, cpuFamily: "AMD Ryzen 9", cpuModel: "Invented" }, clarifications: [] }) } }] });
  };
  try {
    const response = await POST(request({ kind: "offer", text: source }));
    assert.equal(response.status, 200);
    const payload = await response.json() as IntakeResult<OfferIntake>;
    assert.equal(payload.mode, "nemotron");
    assert.equal(payload.data.sourceText, source);
    assert.equal(payload.data.cpuFamily, "");
    assert.equal(payload.data.cpuModel, "");
    assert.ok(payload.clarifications.some((question: string) => question.includes("AMD 9")));
    assert.equal(providerCalls, 1);

    globalThis.fetch = async () => Response.json({ choices: [{ message: { content: '{"data":{"company":"Invented"},"clarifications":[]}' } }] });
    const malformed = await POST(request({ kind: "lead", text: "A laptop" }));
    assert.equal(malformed.status, 502);
    assert.ok(!(await malformed.text()).includes("Invented"));

    globalThis.fetch = async () => new Response("provider-specific diagnostic", { status: 401 });
    const rejected = await POST(request({ kind: "lead", text: "A laptop" }));
    assert.equal(rejected.status, 502);
    assert.ok(!(await rejected.text()).includes("provider-specific diagnostic"));
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.NEBIUS_API_KEY;
    else process.env.NEBIUS_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.NEBIUS_MODEL;
    else process.env.NEBIUS_MODEL = previousModel;
  }
});
