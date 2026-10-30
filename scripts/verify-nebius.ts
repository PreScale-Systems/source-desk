import assert from 'node:assert/strict';
import { z } from 'zod';
import { POST } from '../app/api/ai/route.ts';
import { leadIntakeSchema, offerIntakeSchema, clarificationsSchema } from '../lib/intake.ts';

if (!process.env.NEBIUS_API_KEY?.trim()) {
  console.error('Set NEBIUS_API_KEY in .env.local before running this live check. No inference was attempted.');
  process.exitCode = 1;
} else {
  if (process.argv.includes('--details')) {
    const providerFetch = globalThis.fetch;
    globalThis.fetch = async (...args) => {
      const response = await providerFetch(...args);
      const payload = await response.clone().json() as { choices?: { finish_reason?: string; message?: { content?: string } }[] };
      console.log(JSON.stringify({ providerStatus: response.status, finishReason: payload.choices?.[0]?.finish_reason, content: payload.choices?.[0]?.message?.content }, null, 2));
      return response;
    };
  }
  const cases = [
    { kind: 'lead', text: 'Company: Sample Design; Contact: Demo Buyer; Qty: 2; AMD Ryzen 9; 32 GB RAM; 2 TB SSD; new; 12 months warranty; delivery within 5 days; budget per unit: INR 139000' },
    { kind: 'offer', text: 'Model: Sample Pro 16; AMD Ryzen 9 8945HS; 32 GB RAM; 2 TB SSD; new; 12 months warranty; price per unit: INR 123000 + 18% GST; freight: INR 1000; available: 5; delivery in 3 days' },
  ];
  for (const sample of cases) {
    const response = await POST(new Request('http://localhost/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sample) }));
    const raw: unknown = await response.json();
    const error = z.object({ error: z.string() }).safeParse(raw);
    assert.equal(response.status, 200, `${sample.kind} extraction failed: ${error.success ? error.data.error : response.status}`);
    const result = z.object({ mode: z.literal('nemotron'), data: z.union([leadIntakeSchema, offerIntakeSchema.extend({ sourceText: z.string() })]), clarifications: clarificationsSchema }).parse(raw);
    if (process.argv.includes('--details')) console.log(JSON.stringify({ kind: sample.kind, ...result }, null, 2));
    const specs = 'requirements' in result.data ? result.data.requirements : result.data;
    assert.equal(specs.cpuFamily, 'AMD Ryzen 9');
    assert.equal(specs.ramGb, 32);
    assert.equal(specs.ssdGb, 2000);
    if (sample.kind === 'lead') {
      const lead = leadIntakeSchema.parse(result.data);
      assert.equal(lead.quantity, 2);
    }
    else {
      const offer = offerIntakeSchema.extend({ sourceText: z.string() }).parse(result.data);
      assert.equal(offer.unitCost, 123000);
      assert.equal(offer.freight, 1000);
      assert.equal(offer.taxIncluded, false);
      assert.equal(offer.gstRate, 18);
      assert.equal(offer.sourceText, sample.text);
    }
    console.log(`${sample.kind}: live Nemotron extraction passed (${result.clarifications.length} clarification questions).`);
  }
}
