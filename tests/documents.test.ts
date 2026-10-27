import assert from "node:assert/strict";
import test from "node:test";
import { defaultTallySettings, dispatchHtml, escapeXml, invoiceHtml, quoteHtml, tallyXml } from "../lib/documents.ts";
import { calculateTotals, createSeedState, updateOrder } from "../lib/sales.ts";

const fixedNow = "2026-10-27T09:00:00.000Z";

function fixture() {
  let state = createSeedState(fixedNow);
  const candidate = state.orders.find((order) => order.status === "ready")!;
  state = updateOrder(state, candidate.id, { invoiceRef: "DEMO/2026/1043" }, fixedNow);
  const order = state.orders.find((item) => item.id === candidate.id)!;
  const quote = state.quotations.find((item) => item.id === order.quoteId)!;
  const settings = defaultTallySettings(quote.buyerSnapshot.company);
  return { state, order, quote, settings };
}

function ledgerLines(xml: string) {
  return [...xml.matchAll(/<ALLLEDGERENTRIES\.LIST>([\s\S]*?)<\/ALLLEDGERENTRIES\.LIST>/g)].map((match) => ({
    name: match[1].match(/<LEDGERNAME>(.*?)<\/LEDGERNAME>/)![1],
    amount: Math.round(Number(match[1].match(/<AMOUNT>(-?\d+\.\d{2})<\/AMOUNT>/)![1]) * 100),
    debit: match[1].includes("<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>"),
  }));
}

test("accounting sales XML balances in paise with customer debit and separate tax credits", () => {
  const { state, order, quote, settings } = fixture();
  const xml = tallyXml(state, order, settings);
  const lines = ledgerLines(xml);
  assert.equal(lines.length, 4);
  assert.equal(lines[0].amount, -Math.round(quote.snapshot.total * 100));
  assert.equal(lines[0].debit, true);
  assert.ok(lines.slice(1).every((line) => !line.debit && line.amount > 0));
  assert.equal(lines.reduce((sum, line) => sum + line.amount, 0), 0);
  assert.match(xml, /<PERSISTEDVIEW>Accounting Voucher View<\/PERSISTEDVIEW>/);
  assert.match(xml, /<DATE>20261027<\/DATE>/);
  assert.doesNotMatch(xml, /GSTIN|ALLINVENTORYENTRIES/);
  assert.match(xml, /unvalidated in Tally/);
  assert.match(xml, /Repeated imports may create duplicate vouchers/);
});

test("IGST exports one tax line; odd paise CGST and SGST still balance", () => {
  const { state, order, quote, settings } = fixture();
  quote.snapshot.salePrice = 100.06;
  Object.assign(quote.snapshot, calculateTotals({ quantity: quote.snapshot.quantity, salePrice: 100.06, unitCost: 50, freight: 0, gstRate: 18 }));
  assert.equal(quote.snapshot.gst, 18.01);
  let lines = ledgerLines(tallyXml(state, order, settings));
  assert.equal(lines[2].amount + lines[3].amount, 1801);
  assert.equal(lines.reduce((sum, line) => sum + line.amount, 0), 0);
  lines = ledgerLines(tallyXml(state, order, { ...settings, taxMode: "igst" }));
  assert.deepEqual(lines.map((line) => line.name), [settings.customerLedger, settings.salesLedger, settings.outputIgstLedger]);
  assert.equal(lines[2].amount, 1801);
  assert.equal(lines.reduce((sum, line) => sum + line.amount, 0), 0);
});

test("XML escapes buyer, ledger, reference and narration text", () => {
  const { state, order, quote, settings } = fixture();
  order.invoiceRef = 'INV/<&"\'>';
  quote.snapshot.model = '<script>alert("x")</script>';
  settings.companyName = 'Demo & Sons <Mumbai> "Ltd"';
  settings.customerLedger = "Buyer & Partners <Accounts>";
  const xml = tallyXml(state, order, settings);
  assert.match(xml, /Demo &amp; Sons &lt;Mumbai&gt; &quot;Ltd&quot;/);
  assert.match(xml, /Buyer &amp; Partners &lt;Accounts&gt;/);
  assert.match(xml, /INV\/&lt;&amp;&quot;&apos;&gt;/);
  assert.match(xml, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.doesNotMatch(xml, /<script>/);
  assert.equal(escapeXml("a\u0000b\u000bc & d"), "abc &amp; d");
});

test("Tally export rejects missing or ambiguous accounting configuration", () => {
  const { state, order, settings } = fixture();
  for (const field of ["companyName", "customerLedger", "salesLedger", "outputCgstLedger", "outputSgstLedger"] as const) {
    assert.throws(() => tallyXml(state, order, { ...settings, [field]: " " }), /required/);
  }
  assert.throws(() => tallyXml(state, order, { ...settings, taxMode: "igst", outputIgstLedger: "" }), /required/);
  assert.throws(() => tallyXml(state, order, { ...settings, customerLedger: settings.salesLedger }), /different names/);
  assert.throws(() => tallyXml(state, order, { ...settings, salesLedger: "Sales\u0000" }), /invalid control/);
  order.invoiceRef = "";
  assert.throws(() => tallyXml(state, order, settings), /Invoice reference/);
});

test("Tally export rejects modified or invalid financial snapshots", () => {
  const { state, order, quote, settings } = fixture();
  const saved = { ...quote.snapshot };
  quote.snapshot.total += 0.01;
  assert.throws(() => tallyXml(state, order, settings), /balanced/);
  Object.assign(quote.snapshot, saved, { gst: saved.gst + 1, total: saved.total + 1 });
  assert.throws(() => tallyXml(state, order, settings), /GST/);
  Object.assign(quote.snapshot, saved, { quantity: 0 });
  assert.throws(() => tallyXml(state, order, settings), /quantity/);
  Object.assign(quote.snapshot, saved, { gstRate: Number.NaN });
  assert.throws(() => tallyXml(state, order, settings), /GST rate/);
  Object.assign(quote.snapshot, saved);
  quote.status = "draft";
  assert.throws(() => tallyXml(state, order, settings), /Accept/);
});

test("exports preserve frozen quotation values despite live inventory and lead edits", () => {
  const { state, order, quote, settings } = fixture();
  const initial = tallyXml(state, order, settings);
  state.inventory.forEach((item) => { item.unitCost = 1; item.model = "Changed live inventory"; });
  const lead = state.leads.find((item) => item.id === quote.leadId)!;
  lead.company = "Changed live customer";
  lead.address = "Changed billing address";
  assert.equal(tallyXml(state, order, settings), initial);
  const document = quoteHtml(state, quote);
  assert.match(document, new RegExp(quote.buyerSnapshot.company));
  assert.doesNotMatch(document, /Changed live/);
  assert.match(document, /2 TB SSD/);
  assert.equal(tallyXml(state, order, settings), tallyXml(state, order, settings));
});

test("exports resolve current state rather than trusting stale objects", () => {
  const { state, order, quote, settings } = fixture();
  const staleOrder = { ...order, invoiceRef: "STALE-INVOICE", address: "STALE-ADDRESS" };
  assert.doesNotMatch(tallyXml(state, staleOrder, settings), /STALE-INVOICE/);
  assert.doesNotMatch(invoiceHtml(state, staleOrder), /STALE-ADDRESS/);
  const staleQuote = { ...quote, snapshot: { ...quote.snapshot, model: "STALE-MODEL" } };
  assert.doesNotMatch(quoteHtml(state, staleQuote), /STALE-MODEL/);
  assert.throws(() => tallyXml(state, { ...order, id: "missing" }, settings), /does not exist/);
});

test("printable draft and dispatch documents escape customer content and show outstanding work", () => {
  const { state, order, quote } = fixture();
  quote.buyerSnapshot.company = '<img src=x onerror="alert(1)">';
  order.address = '<script>wrong()</script>';
  order.tallyExportedAt = fixedNow;
  const invoice = invoiceHtml(state, order);
  assert.match(invoice, /DRAFT · NOT A TAX INVOICE/);
  assert.match(invoice, /XML prepared; import has not been confirmed/);
  assert.match(invoice, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.doesNotMatch(invoice, /<img|<script>/);
  const dispatch = dispatchHtml(state, order);
  assert.match(dispatch, /Pending/);
  assert.match(dispatch, new RegExp(order.serials[0]));
  assert.match(dispatch, /Not assigned/);
  assert.doesNotMatch(dispatch, /<script>/);
});
