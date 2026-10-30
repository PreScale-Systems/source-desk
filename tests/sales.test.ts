import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptQuotation, addOffer, calculateTotals, compareOffers, createLead, createQuotation, createSeedState, dispatchOrder, markPacked, markQuoteSent, matchInventory, receiveSupplierOrder, updateOrder } from '../lib/sales.ts';
import type { SalesState } from '../lib/sales.ts';

const NOW = '2026-10-27T10:00:00.000Z';
const seed = () => createSeedState(NOW);
function draftSupplier(state = seed()) { state = createQuotation(state, { leadId: 'LD-001', sourceType: 'supplier', sourceId: 'OFR-003', salePrice: 140000 }, NOW); return { state, quoteId: state.quotations[0].id }; }
function acceptedSupplier() { let { state } = draftSupplier(); const quoteId = state.quotations[0].id; state = markQuoteSent(state, quoteId, NOW); state = acceptQuotation(state, quoteId, NOW); return { state, quoteId, orderId: state.orders[0].id }; }
function addInventoryLead(state: SalesState, quantity = 2) { const base = state.leads.find(row => row.id === 'LD-004')!; state = createLead(state, { ...base, company: 'Test Workshop', contact: 'Test Buyer', quantity, requirements: { ...base.requirements } }, NOW); return { state, leadId: state.leads[0].id }; }

test('sample data covers a full pipeline with no exact primary inventory match', () => {
  const state = seed();
  assert.equal(state.leads.length, 6); assert.equal(state.inventory.length, 8);
  assert.equal(matchInventory(state, 'LD-001').some(row => row.eligible), false);
  assert.equal(state.leads.find(row => row.id === 'LD-006')?.status, 'dispatched');
  assert.equal(state.inventory.find(row => row.id === 'INV-002')?.available, 2);
});

test('offer ranking explains incompatible low price, late delivery and unconfirmed upgrade', () => {
  const rows = compareOffers(seed(), 'LD-001', NOW);
  assert.equal(rows[0].offer.id, 'OFR-003'); assert.equal(rows[0].eligible, true);
  assert.match(rows.find(row => row.offer.id === 'OFR-001')!.reasons.join(' '), /RAM.*16.*Storage.*1000/);
  assert.match(rows.find(row => row.offer.id === 'OFR-002')!.reasons.join(' '), /9 days.*5 days/);
  assert.equal(rows.find(row => row.offer.id === 'OFR-004')!.eligible, false);
});

test('money uses paise, tax on selling subtotal and gross margin after supplier freight', () => {
  assert.deepEqual(calculateTotals({ quantity: 2, unitCost: 80, freight: 10, salePrice: 100, gstRate: 18 }), { subtotal: 200, gst: 36, total: 236, costTotal: 170, profit: 30, margin: 15 });
  const small = calculateTotals({ quantity: 3, unitCost: 0.05, freight: 0, salePrice: 0.1, gstRate: 18 });
  assert.equal(small.subtotal, 0.3); assert.equal(small.gst, 0.05); assert.equal(small.total, 0.35);
  assert.throws(() => calculateTotals({ quantity: 1.5, unitCost: 1, freight: 0, salePrice: 2, gstRate: 18 }), /whole number/);
});

test('alternatives require recorded customer approval and never silently upgrade', () => {
  const state = seed();
  assert.throws(() => createQuotation(state, { leadId: 'LD-001', sourceType: 'supplier', sourceId: 'OFR-004', salePrice: 130000 }, NOW), /Customer approval/);
  assert.throws(() => createQuotation(state, { leadId: 'LD-001', sourceType: 'supplier', sourceId: 'OFR-004', salePrice: 130000, varianceApproved: true }, NOW), /Customer approval/);
  const updated = createQuotation(state, { leadId: 'LD-001', sourceType: 'supplier', sourceId: 'OFR-004', salePrice: 130000, varianceApproved: true, varianceNote: 'Customer accepted 1 TB in writing.' }, NOW);
  assert.equal(updated.quotations[0].snapshot.ssdGb, 1000);
  assert.equal(updated.quotations[0].varianceNote, 'Customer accepted 1 TB in writing.');
});

test('quotes freeze buyer and source values without mutating original state', () => {
  const original = seed(), before = JSON.stringify(original);
  const { state } = draftSupplier(original);
  assert.equal(JSON.stringify(original), before);
  original.leads[0].company = 'Changed customer';
  assert.equal(state.quotations[0].buyerSnapshot.company, 'Studio North');
  assert.equal(state.quotations[0].snapshot.total, 330400);
});

test('supplier offers cannot be borrowed from unrelated leads', () => {
  assert.throws(() => createQuotation(seed(), { leadId: 'LD-002', sourceType: 'supplier', sourceId: 'OFR-003', salePrice: 140000 }, NOW), /another lead/);
});

test('expired supplier offers block new quotations and later acceptance', () => {
  const future = '2026-11-10T10:00:00.000Z';
  assert.throws(() => createQuotation(seed(), { leadId: 'LD-001', sourceType: 'supplier', sourceId: 'OFR-003', salePrice: 140000 }, future), /expired/);
  const { state, quoteId } = draftSupplier();
  assert.throws(() => acceptQuotation(markQuoteSent(state, quoteId, NOW), quoteId, future), /expired/);
});

test('acceptance must follow sending and duplicate acceptance does not reserve twice', () => {
  let { state } = draftSupplier(); const quoteId = state.quotations[0].id;
  assert.throws(() => acceptQuotation(state, quoteId, NOW), /sent/);
  state = acceptQuotation(markQuoteSent(state, quoteId, NOW), quoteId, NOW);
  const count = state.orders.length;
  assert.equal(state.offers.find(row => row.id === 'OFR-003')?.quantityAvailable, 3);
  assert.equal(acceptQuotation(state, quoteId, NOW), state);
  assert.equal(state.orders.length, count);
  assert.equal(state.orders[0].receiptConfirmed, false);
});

test('two drafted orders cannot reserve the same stock on sequential acceptance', () => {
  let { state, leadId } = addInventoryLead(seed());
  state = createQuotation(state, { leadId, sourceType: 'inventory', sourceId: 'INV-002', salePrice: 100000 }, NOW);
  const first = state.quotations[0].id; state = markQuoteSent(state, first, NOW);
  ({ state, leadId } = addInventoryLead(state));
  state = createQuotation(state, { leadId, sourceType: 'inventory', sourceId: 'INV-002', salePrice: 100000 }, NOW);
  const second = state.quotations[0].id; state = markQuoteSent(state, second, NOW);
  state = acceptQuotation(state, first, NOW);
  assert.equal(state.inventory.find(row => row.id === 'INV-002')?.available, 0);
  assert.throws(() => acceptQuotation(state, second, NOW), /Insufficient stock/);
});

test('changed customer requirements or source price invalidate a prepared quote', () => {
  const { state: draft, quoteId } = draftSupplier(); const state = markQuoteSent(draft, quoteId, NOW);
  const changedRequirements = { ...state, leads: state.leads.map(row => row.id === 'LD-001' ? { ...row, quantity: 3 } : row) };
  assert.throws(() => acceptQuotation(changedRequirements, quoteId, NOW), /requirements changed/);
  const changedPrice = { ...state, offers: state.offers.map(row => row.id === 'OFR-003' ? { ...row, unitCost: 124000 } : row) };
  assert.throws(() => acceptQuotation(changedPrice, quoteId, NOW), /configuration or cost changed/);
});

test('physical receipt enforces quantity, case-insensitive uniqueness and global serial ownership', () => {
  const { state, orderId } = acceptedSupplier();
  assert.throws(() => receiveSupplierOrder(state, orderId, ['SUP-1'], NOW), /exactly 2/);
  assert.throws(() => receiveSupplierOrder(state, orderId, ['SUP-1', 'sup-1'], NOW), /Duplicate/);
  assert.throws(() => receiveSupplierOrder(state, orderId, ['AS-VP16-1001', 'SUP-2'], NOW), /already allocated/);
  const received = receiveSupplierOrder(state, orderId, ['SUP-1', 'SUP-2'], NOW);
  assert.equal(received.orders[0].status, 'ready'); assert.equal(received.orders[0].receiptConfirmed, true);
  assert.equal(receiveSupplierOrder(received, orderId, ['SUP-2', 'SUP-1'], NOW), received);
  assert.throws(() => receiveSupplierOrder(received, orderId, ['SUP-3', 'SUP-4'], NOW), /already confirmed/);
});

test('dispatch requires physical receipt, four checks, actual invoice and tracking', () => {
  let { state } = acceptedSupplier(); const orderId = state.orders[0].id;
  assert.throws(() => markPacked(state, orderId, NOW), /physical devices/);
  assert.throws(() => dispatchOrder(state, orderId, NOW), /packing checks/);
  state = receiveSupplierOrder(state, orderId, ['SUP-NEW-1', 'SUP-NEW-2'], NOW);
  assert.throws(() => markPacked(state, orderId, NOW), /four dispatch checks/);
  assert.throws(() => updateOrder(state, orderId, { checklist: { invoice: true } }, NOW), /real invoice reference/);
  state = updateOrder(state, orderId, { checklist: { specs: true, accessories: true, invoice: true, address: true }, invoiceRef: 'INV/2026/55' }, NOW);
  state = markPacked(state, orderId, NOW);
  assert.throws(() => dispatchOrder(state, orderId, NOW), /Courier and tracking/);
  state = updateOrder(state, orderId, { courier: 'Blue Dart', tracking: 'TEST-123' }, NOW);
  state = dispatchOrder(state, orderId, NOW);
  assert.equal(state.orders[0].status, 'dispatched'); assert.equal(state.leads.find(row => row.id === 'LD-001')?.status, 'dispatched');
  assert.throws(() => updateOrder(state, orderId, { address: 'Another place' }, NOW), /read-only/);
});

test('Tally export timestamp does not imply invoice or dispatch readiness', () => {
  const { state, orderId } = acceptedSupplier();
  const updated = updateOrder(state, orderId, { tallyExportedAt: NOW }, NOW);
  assert.equal(updated.orders[0].invoiceRef, ''); assert.equal(updated.orders[0].checklist.invoice, false);
  assert.match(updated.activities[0].detail, /Tally import must be confirmed separately/);
});

test('manual distributor offer records evidence and validates its distributor and amounts', () => {
  const state = seed(), base = state.offers[0];
  assert.throws(() => addOffer(state, { ...base, distributorId: 'missing' }, NOW), /Distributor not found/);
  assert.throws(() => addOffer(state, { ...base, sourceText: '' }, NOW), /original supplier message/);
  assert.throws(() => addOffer(state, { ...base, unitCost: -1 }, NOW), /non-negative/);
  const updated = addOffer(state, { ...base, sourceText: 'Confirmed sample offer from the distributor.' }, NOW);
  assert.equal(updated.offers.length, state.offers.length + 1); assert.equal(updated.offers[0].sourceText, 'Confirmed sample offer from the distributor.');
});
