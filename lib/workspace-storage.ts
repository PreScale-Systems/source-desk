import { z } from 'zod';
import type { SalesState } from './sales.ts';
import type { TallySettings } from './documents.ts';

export const STORAGE = 'sourcedesk.workspace.v1';
export const SETTINGS = 'sourcedesk.tally.v1';
const text = z.string();
const count = z.number().int().nonnegative().safe();
const money = z.number().finite().nonnegative();
const date = text.refine(value => Number.isFinite(Date.parse(value)));
const requirements = z.object({ cpuFamily: text.min(1), ramGb: count.positive(), ssdGb: count.positive(), condition: z.enum(['New', 'Refurbished']), warrantyMonths: count });
const product = requirements.extend({ model: text, cpuModel: text });
const buyer = z.object({ company: text, contact: text, email: text, phone: text, address: text });
const checklist = z.object({ specs: z.boolean(), accessories: z.boolean(), invoice: z.boolean(), address: z.boolean() });
export const workspaceSchema = z.object({
  version: z.literal(1),
  inventory: z.array(product.extend({ id: text, brand: text, available: count, unitCost: money, serials: z.array(text) })),
  distributors: z.array(z.object({ id: text, name: text, contact: text, channel: z.enum(['WhatsApp', 'Email']) })),
  leads: z.array(buyer.extend({ id: text, notes: text, quantity: count.positive(), requirements, budget: money, maxDeliveryDays: count.positive(), status: z.enum(['new', 'sourcing', 'quoted', 'approved', 'ready', 'packed', 'dispatched']), createdAt: date })),
  offers: z.array(product.extend({ id: text, leadId: text, distributorId: text, unitCost: money, freight: money, deliveryDays: count, quantityAvailable: count, sourceChannel: z.enum(['WhatsApp', 'Email']), sourceText: text, validUntil: date })),
  quotations: z.array(z.object({ id: text, leadId: text, sourceType: z.enum(['inventory', 'supplier']), sourceId: text, snapshot: product.extend({ unitCost: money, freight: money, salePrice: money, quantity: count.positive(), subtotal: money, gstRate: money.max(100), gst: money, total: money, margin: z.number().finite(), costTotal: money, profit: z.number().finite() }), buyerSnapshot: buyer, requirementsSnapshot: requirements, status: z.enum(['draft', 'sent', 'accepted']), createdAt: date, varianceApproved: z.boolean(), varianceNote: text, maxDeliveryDaysSnapshot: count.positive() })),
  orders: z.array(z.object({ id: text, leadId: text, quoteId: text, status: z.enum(['procurement', 'ready', 'packed', 'dispatched']), serials: z.array(text), receiptConfirmed: z.boolean(), checklist, address: text, courier: text, tracking: text, invoiceRef: text, tallyExportedAt: date.nullable(), createdAt: date })),
  activities: z.array(z.object({ id: text, leadId: text, title: text, detail: text, createdAt: date })),
}).superRefine((state, ctx) => {
  const exists = (rows: { id: string }[], id: string) => rows.some(row => row.id === id);
  const invalid = () => ctx.addIssue({ code: 'custom', message: 'Workspace contains duplicate IDs or broken record references.' });
  for (const rows of [state.inventory, state.distributors, state.leads, state.offers, state.quotations, state.orders, state.activities]) {
    if (new Set(rows.map(row => row.id)).size !== rows.length) invalid();
  }
  for (const offer of state.offers) if (!exists(state.leads, offer.leadId) || !exists(state.distributors, offer.distributorId)) invalid();
  for (const quote of state.quotations) {
    if (!exists(state.leads, quote.leadId) || !exists(quote.sourceType === 'inventory' ? state.inventory : state.offers, quote.sourceId)) invalid();
  }
  for (const order of state.orders) if (!state.quotations.some(quote => quote.id === order.quoteId && quote.leadId === order.leadId) || !exists(state.leads, order.leadId)) invalid();
  for (const activity of state.activities) if (!exists(state.leads, activity.leadId)) invalid();
});
const settingsSchema = z.object({ companyName: text, customerLedger: text, salesLedger: text, outputCgstLedger: text, outputSgstLedger: text, outputIgstLedger: text, taxMode: z.enum(['cgst-sgst', 'igst']) });

export function readWorkspace(storage: Pick<Storage, 'getItem'>): { data: SalesState | null; settings: TallySettings | null; recovery: string | null } {
  try {
    const raw = storage.getItem(STORAGE);
    const storedSettings = storage.getItem(SETTINGS);
    return { data: raw === null ? null : workspaceSchema.parse(JSON.parse(raw)), settings: storedSettings === null ? null : settingsSchema.parse(JSON.parse(storedSettings)), recovery: null };
  } catch {
    return { data: null, settings: null, recovery: 'Saved data could not be loaded. It has been left untouched. Download it before resetting, or try again if browser storage is unavailable.' };
  }
}

export function saveWorkspace(storage: Pick<Storage, 'setItem'>, data: SalesState, settings: TallySettings): string | null {
  try {
    storage.setItem(STORAGE, JSON.stringify(data));
    storage.setItem(SETTINGS, JSON.stringify(settings));
    return null;
  } catch {
    return 'Browser storage is unavailable. Keep this tab open and download a workspace backup; changes cannot be saved.';
  }
}
