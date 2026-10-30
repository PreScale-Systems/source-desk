import type { Order, Quotation, SalesState } from "./sales";

/** Exact names of existing Tally ledgers. Tax treatment is selected by accounts. */
export interface TallySettings {
  companyName: string;
  customerLedger: string;
  salesLedger: string;
  outputCgstLedger: string;
  outputSgstLedger: string;
  outputIgstLedger: string;
  taxMode: "cgst-sgst" | "igst";
}

export function defaultTallySettings(customer?: string | { company: string }): TallySettings {
  return {
    companyName: "Demo IT Trading — SAMPLE",
    customerLedger: typeof customer === "string" ? customer : customer?.company ?? "",
    salesLedger: "Sales - Laptops",
    outputCgstLedger: "Output CGST",
    outputSgstLedger: "Output SGST",
    outputIgstLedger: "Output IGST",
    taxMode: "cgst-sgst",
  };
}

/** Escape both XML text and attributes; remove characters forbidden in XML 1.0. */
export function escapeXml(value: unknown): string {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const html = escapeXml;
const money = (amount: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 }).format(amount);
const minor = (amount: number, name: string): number => {
  if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(Math.round((amount + Number.EPSILON) * 100))) {
    throw new Error(`${name} must be a finite, non-negative money amount.`);
  }
  return Math.round((amount + Number.EPSILON) * 100);
};
const decimal = (amountInPaise: number) => (amountInPaise / 100).toFixed(2);

function currentQuote(state: SalesState, quote: Pick<Quotation, "id">): Quotation {
  const found = state.quotations.find((item) => item.id === quote.id);
  if (!found) throw new Error("Quotation does not exist in the current workspace.");
  return found;
}

function orderContext(state: SalesState, order: Pick<Order, "id">) {
  const current = state.orders.find((item) => item.id === order.id);
  if (!current) throw new Error("Order does not exist in the current workspace.");
  const quote = currentQuote(state, { id: current.quoteId });
  if (quote.leadId !== current.leadId) throw new Error("Order and quotation refer to different customers.");
  return { order: current, quote };
}

function totals(quote: Quotation) {
  const line = quote.snapshot;
  if (!Number.isInteger(line.quantity) || line.quantity < 1) throw new Error("Quotation quantity must be a positive integer.");
  if (!Number.isFinite(line.gstRate) || line.gstRate < 0 || line.gstRate > 100) throw new Error("GST rate must be between 0 and 100 percent.");
  if (line.salePrice <= 0) throw new Error("The selling price must be greater than zero.");
  const subtotal = minor(line.subtotal, "Subtotal");
  const gst = minor(line.gst, "GST");
  const total = minor(line.total, "Total");
  if (minor(line.salePrice, "Selling price") * line.quantity !== subtotal) throw new Error("Quotation subtotal does not match its frozen selling price and quantity.");
  if (Math.round(subtotal * Math.round(line.gstRate * 100) / 10000) !== gst) throw new Error("Quotation GST does not match its frozen subtotal and tax rate.");
  if (subtotal + gst !== total) throw new Error("Quotation total is not balanced. Recreate the quotation before exporting.");
  return { subtotal, gst, total };
}

function requiredName(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required. Enter the exact name configured in Tally.`);
  if (/[\u0000-\u001F\uFFFE\uFFFF]/.test(value)) throw new Error(`${label} contains an invalid control character.`);
  return value.trim();
}

function tallyDate(value: string): string {
  const iso = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || Number.isNaN(Date.parse(`${iso}T00:00:00Z`)) || new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) !== iso) {
    throw new Error("Order date is invalid.");
  }
  return iso.replace(/-/g, "");
}

/**
 * Accounting voucher only: does not create masters, inventory, or a tax invoice.
 * Debits are negative in Tally XML; credits are positive. See TallyHelp sample-xml.
 * Stable REMOTEID assists reconciliation; repeated imports are NOT guaranteed safe.
 */
export function tallyXml(state: SalesState, candidate: Order, settings: TallySettings): string {
  const { order, quote } = orderContext(state, candidate);
  if (quote.status !== "accepted") throw new Error("Accept the customer quotation before preparing a Tally export.");
  const invoiceRef = requiredName(order.invoiceRef, "Invoice reference");
  const company = requiredName(settings.companyName, "Tally company");
  const customer = requiredName(settings.customerLedger, "Customer ledger");
  const sales = requiredName(settings.salesLedger, "Sales ledger");
  if (settings.taxMode !== "cgst-sgst" && settings.taxMode !== "igst") throw new Error("Select CGST + SGST or IGST with your accountant before export.");
  const amounts = totals(quote);
  const creditLines = [{ name: sales, amount: amounts.subtotal }];
  if (amounts.gst > 0 && settings.taxMode === "igst") {
    creditLines.push({ name: requiredName(settings.outputIgstLedger, "Output IGST ledger"), amount: amounts.gst });
  } else if (amounts.gst > 0) {
    const cgst = Math.round(amounts.gst / 2);
    creditLines.push({ name: requiredName(settings.outputCgstLedger, "Output CGST ledger"), amount: cgst });
    creditLines.push({ name: requiredName(settings.outputSgstLedger, "Output SGST ledger"), amount: amounts.gst - cgst });
  }
  const names = [customer, ...creditLines.map((line) => line.name)].map((name) => name.toLocaleLowerCase());
  if (new Set(names).size !== names.length) throw new Error("Customer, sales, and tax ledgers must have different names.");
  if (creditLines.reduce((sum, line) => sum + line.amount, 0) !== amounts.total) throw new Error("Tally voucher debits and credits do not balance.");
  const ref = escapeXml(invoiceRef);
  const credits = creditLines.map((line) => `          <ALLLEDGERENTRIES.LIST>\n            <LEDGERNAME>${escapeXml(line.name)}</LEDGERNAME>\n            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>\n            <AMOUNT>${decimal(line.amount)}</AMOUNT>\n          </ALLLEDGERENTRIES.LIST>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- SourceDesk DRAFT: unvalidated in Tally. Review company, existing ledgers, GST treatment and voucher numbering in a test company. Accounting-only export; no inventory or GST-compliance validation. Repeated imports may create duplicate vouchers; check the order reference before importing. -->
<ENVELOPE>
  <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES><SVCURRENTCOMPANY>${escapeXml(company)}</SVCURRENTCOMPANY></STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER REMOTEID="${escapeXml(`sourcedesk-${order.id}`)}" VCHTYPE="Sales" ACTION="Create" OBJVIEW="Accounting Voucher View">
            <DATE>${tallyDate(order.createdAt)}</DATE>
            <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
            <VOUCHERNUMBER>${ref}</VOUCHERNUMBER>
            <REFERENCE>${ref}</REFERENCE>
            <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>
            <ISINVOICE>No</ISINVOICE>
            <PARTYLEDGERNAME>${escapeXml(customer)}</PARTYLEDGERNAME>
            <NARRATION>${escapeXml(`SourceDesk draft; unvalidated in Tally. Order ${order.id}; quotation ${quote.id}; ${quote.snapshot.quantity} × ${quote.snapshot.model}. Confirm existing ledgers, tax treatment and duplicate references before import.`)}</NARRATION>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>${escapeXml(customer)}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
              <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
              <AMOUNT>-${decimal(amounts.total)}</AMOUNT>
              <BILLALLOCATIONS.LIST>
                <NAME>${ref}</NAME>
                <BILLTYPE>New Ref</BILLTYPE>
                <AMOUNT>-${decimal(amounts.total)}</AMOUNT>
              </BILLALLOCATIONS.LIST>
            </ALLLEDGERENTRIES.LIST>
${credits}
          </VOUCHER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

function documentShell(title: string, reference: string, date: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${html(title)} · ${html(reference)} · SourceDesk</title><style>
*{box-sizing:border-box}body{margin:0;background:#eef0f2;color:#162c35;font:14px/1.6 Arial,Helvetica,sans-serif}.page{max-width:850px;margin:32px auto;padding:52px;background:white;border-top:6px solid #db653c}header{display:flex;justify-content:space-between;gap:30px;border-bottom:1px solid #dce2e4;padding-bottom:24px;margin-bottom:28px}.brand{font-size:25px;letter-spacing:-1px;font-weight:bold}.brand span{color:#db653c}.eyebrow{font-size:10px;font-weight:bold;letter-spacing:1.7px;text-transform:uppercase;color:#6c7b80}h1{font-size:26px;line-height:1.2;margin:8px 0}h2{font-size:13px;margin:26px 0 10px;text-transform:uppercase;letter-spacing:1px}p{margin:5px 0}small,.muted{color:#6c7b80;font-size:12px}.meta{text-align:right}.grid{display:grid;grid-template-columns:1fr 1fr;gap:28px}.address{white-space:pre-line}table{width:100%;border-collapse:collapse;margin:22px 0}th{text-align:left;background:#f3f5f5;color:#64757b;font-size:10px;text-transform:uppercase;letter-spacing:1px}th,td{padding:12px 10px;border-bottom:1px solid #e4e9eb;vertical-align:top}.num{text-align:right;white-space:nowrap}.totals{width:320px;margin:0 0 0 auto}.totals td{padding:8px 10px}.total{font-weight:bold;background:#edf3f1;font-size:18px}.notice{background:#fff4e9;border-left:3px solid #db653c;padding:12px 16px;font-size:12px;margin:22px 0}.tag{display:inline-block;background:#eef3f1;padding:2px 9px;border-radius:4px;font-size:11px;font-weight:bold}ul{padding-left:19px}footer{margin-top:36px;padding-top:16px;border-top:1px solid #dce2e4;color:#6c7b80;font-size:11px}.serial{font-family:monospace} @page{size:A4;margin:15mm}@media print{body{background:white;font-size:13px;line-height:1.4}.page{margin:0;padding:0;border-top:4px solid #db653c;max-width:none}header{padding:16px 0;margin-bottom:20px}h2{margin:20px 0 8px}table{margin:16px 0}th,td{padding:8px 10px}.notice{margin:16px 0;padding:10px 14px}footer{margin-top:20px;padding-top:12px}tr,.notice,.grid,.totals,footer{break-inside:avoid}}
</style></head><body><main class="page"><header><div><div class="brand">Source<span>Desk</span></div><div class="eyebrow">Laptop sales workspace · Sample data</div></div><div class="meta"><div class="eyebrow">${html(title)}</div><h1>${html(reference)}</h1><p class="muted">${html(dateLabel(date))}</p></div></header>${body}<footer>Prepared in SourceDesk · Sample-data MVP · All amounts in INR. Prices and customer details are preserved from the quotation snapshot.</footer></main></body></html>`;
}

function buyerBlock(quote: Quotation, shipTo?: string) {
  const buyer = quote.buyerSnapshot;
  return `<div class="grid"><section><div class="eyebrow">Prepared for</div><p><strong>${html(buyer.company)}</strong></p><p>${html(buyer.contact)}</p><p class="muted">${html(buyer.email)}${buyer.phone ? ` · ${html(buyer.phone)}` : ""}</p><p class="address">${html(buyer.address || "Address not supplied")}</p></section><section><div class="eyebrow">${shipTo !== undefined ? "Ship to" : "Quotation status"}</div>${shipTo !== undefined ? `<p class="address">${html(shipTo || "Address not supplied")}</p>` : `<p><span class="tag">${html(quote.status.toUpperCase())}</span></p><p class="muted">Customer acceptance and availability confirmation are required before fulfilment.</p>`}</section></div>`;
}

function quoteLine(quote: Quotation) {
  totals(quote);
  const s = quote.snapshot;
  const storage = s.ssdGb >= 1000 && s.ssdGb % 1000 === 0 ? `${s.ssdGb / 1000} TB` : `${s.ssdGb} GB`;
  return `<table><thead><tr><th>Device &amp; configuration</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Amount</th></tr></thead><tbody><tr><td><strong>${html(s.model)}</strong><p class="muted">${html(s.cpuModel)} · ${html(s.ramGb)} GB RAM · ${html(storage)} SSD</p><p class="muted">${html(s.condition)} · ${html(s.warrantyMonths)}-month warranty</p></td><td class="num">${html(s.quantity)}</td><td class="num">${html(money(s.salePrice))}</td><td class="num">${html(money(s.subtotal))}</td></tr></tbody></table><table class="totals"><tbody><tr><td>Subtotal</td><td class="num">${html(money(s.subtotal))}</td></tr><tr><td>GST (${html(s.gstRate)}%)</td><td class="num">${html(money(s.gst))}</td></tr><tr class="total"><td>Total</td><td class="num">${html(money(s.total))}</td></tr></tbody></table>`;
}

export function quoteHtml(state: SalesState, candidate: Quotation): string {
  const quote = currentQuote(state, candidate);
  return documentShell("Customer quotation", quote.id, quote.createdAt, `${buyerBlock(quote)}${quoteLine(quote)}${quote.varianceApproved ? `<div class="notice"><strong>Approved specification differences</strong><p>${html(quote.varianceNote || "The sales team recorded approval of the selected alternative.")}</p></div>` : ""}<h2>Commercial terms</h2><p>Price includes delivery; GST is shown separately. Stock and distributor availability must be reconfirmed on acceptance.</p><p>Payment terms and delivery commitment must be agreed with the sales team before placing the order.</p><p class="muted">This quotation is not a tax invoice. Sample transaction for product demonstration.</p>`);
}

export function invoiceHtml(state: SalesState, candidate: Order): string {
  const { order, quote } = orderContext(state, candidate);
  return documentShell("Invoice draft", order.invoiceRef || order.id, order.createdAt, `<div class="notice"><strong>DRAFT · NOT A TAX INVOICE</strong><p>For accounts review and Tally preparation. Issue the final tax invoice from Tally after validating company details, tax treatment and voucher numbering.</p></div>${buyerBlock(quote, order.address)}${quoteLine(quote)}<h2>Order references</h2><p>Order ${html(order.id)} · Accepted quotation ${html(quote.id)}</p><p>Invoice reference: ${html(order.invoiceRef || "Not assigned")}</p><p class="muted">Tally export status: ${order.tallyExportedAt ? "XML prepared; import has not been confirmed." : "Not exported."}</p>`);
}

export function dispatchHtml(state: SalesState, candidate: Order): string {
  const { order, quote } = orderContext(state, candidate);
  const checks = [["Device specifications checked", order.checklist.specs], ["Charger and accessories packed", order.checklist.accessories], ["Final invoice enclosed", order.checklist.invoice], ["Delivery address confirmed", order.checklist.address]] as const;
  const serials = order.serials.map((serial, index) => `<tr><td>${index + 1}</td><td>${html(quote.snapshot.model)}</td><td class="serial">${html(serial)}</td></tr>`).join("");
  return documentShell("Dispatch checklist", order.id, order.createdAt, `${buyerBlock(quote, order.address)}<h2>Shipment</h2><div class="grid"><section><p>Status: <strong>${html(order.status)}</strong></p><p>Required devices: ${html(quote.snapshot.quantity)}</p><p>Invoice reference: ${html(order.invoiceRef || "Not assigned")}</p></section><section><p>Courier: ${html(order.courier || "Not assigned")}</p><p>Tracking: ${html(order.tracking || "Not assigned")}</p><p>Goods received: ${order.receiptConfirmed ? "Confirmed" : "Pending"}</p></section></div><table><thead><tr><th>Unit</th><th>Device</th><th>Serial number</th></tr></thead><tbody>${serials || '<tr><td colspan="3">No serial numbers assigned.</td></tr>'}</tbody></table><h2>Packing checks</h2><table><tbody>${checks.map(([label, done]) => `<tr><td>${html(label)}</td><td class="num">${done ? "Complete" : "Pending"}</td></tr>`).join("")}</tbody></table><p class="muted">Shipment is complete only after all required checks pass and a courier/tracking reference is recorded in the workspace. This checklist does not confirm carrier handover.</p>`);
}
