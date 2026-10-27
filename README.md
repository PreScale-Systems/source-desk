# SourceDesk

A laptop sales workspace for a small IT reseller: capture an enquiry, check stock, compare distributor offers, prepare a quotation, hand approved amounts to accounts, and track dispatch.

This MVP uses fictional sample data and browser-local storage. It is a single-user demo, not a shared production ERP.

## Run locally

Use **Node.js 24 LTS** and npm. From this directory:

```sh
npm ci
npm run dev
```

Open the loopback URL printed in the terminal, normally **http://localhost:5173**. Keep the server running while using the app. If the port is occupied, use `npm run dev -- --port 5174`.

The project uses React and TypeScript on Vinext/Vite. When working through the Sites plugin, its maintained locked installer is also available as `npm run install:ci`. Do not run two installers at once. A clean clone uses the portable execution profile; ignored `.sites-runtime/` state is not required.

To build and preview locally:

```sh
npm run build
npm start
```

`npm start` previews the built Worker locally; it does not deploy it. Use the URL printed by that server.

## Included workflow

- Create leads with customer details, quantities, confirmed specifications and delivery deadlines.
- Match stock against processor family, RAM, SSD, condition, warranty and available quantity. Alternatives require explicit approval.
- Compare distributor offers with original message text, specification differences, landed costs, delivery timing, available quantity and expiry.
- Create printable quotations with frozen buyer, product and price snapshots; mark them sent and record acceptance.
- Reserve owned stock or supplier quantity. Confirm supplier receipt and allocate serial numbers before packing.
- Prepare a Tally accounting-voucher XML export and a clearly labelled invoice draft.
- Record final invoice references, packing checks, delivery address, courier and tracking; then dispatch.

Messages are entered or pasted manually. There are no live WhatsApp, email, Tally, purchasing or courier connections. Records stay in the current browser; resetting the demo restores the fictional starting state.

## Demo journey

1. Open **Studio North**: two new AMD Ryzen 9 laptops, 32 GB RAM, 2 TB SSD, 12-month warranty, delivery within five days. You can also create a lead manually or from pasted call notes.
2. Check inventory. The sample stock has near matches with explicit processor or storage differences, and no suitable exact match for this enquiry.
3. Compare distributor offers. The cheapest has insufficient RAM/SSD; another exact configuration needs nine days. **OFR-003**, from **Redwood IT Partners**, meets the requirements: ₹123,000 per laptop plus ₹1,000 freight for the shipment, delivery in three days.
4. Create a quotation, for example at **₹139,000 per laptop before GST**. The subtotal is ₹278,000; at the sample 18% GST rate the total is ₹328,040. Freight is an internal cost in the margin calculation, not a second customer charge.
5. Download/print the quotation, mark it sent, and record acceptance. This reserves supplier availability; it does not create owned stock.
6. Confirm physical supplier receipt with two unique sample serials, such as `DEMO-SN-001` and `DEMO-SN-002`.
7. Prepare the Tally handoff: enter an accounts-approved draft invoice reference, confirm company and exact ledger names, select tax treatment, and download XML. The demonstration reference is not a real invoice.
8. After accounts issues the actual invoice in its separate workflow, manually record the final reference. Complete specifications, accessories, invoice and address checks. Pack, enter courier/tracking details, and dispatch.

The demo works without Tally using a clearly identified sample invoice reference and fictional shipment details. An XML download does not confirm import or issue an invoice.

Reference files: [`public/sample-inventory.csv`](public/sample-inventory.csv) and [`public/sample-distributor-replies.txt`](public/sample-distributor-replies.txt). CSV is download/reference only; import is not implemented. SSD capacities use decimal GB: 1 TB = 1000 GB. CSV serial numbers are separated by `|`.

## Optional Nemotron extraction on Nebius

Manual entry and the labelled **sample parser** work without a key. The sample parser uses deterministic rules, not AI inference.

Copy `.env.example` to an ignored `.env.local` file and set:

```dotenv
NEBIUS_API_KEY=your_token_factory_key
NEBIUS_MODEL=nvidia/Nemotron-3_5-Lightning
```

Restart the server after environment changes. Select a Nemotron model available in your Token Factory account if necessary. The server route calls `https://api.tokenfactory.nebius.com/v1/chat/completions`. Keep the key on the server; never put it in a `NEXT_PUBLIC_` variable, browser storage or source control.

Extraction returns validated draft fields and clarification questions. Staff review the result before saving. “AMD 9” stays ambiguous; the model cannot approve substitutions, invent stock or set prices. Code performs matching, arithmetic, reservations and dispatch checks.

**Hackathon status:** keyless sample mode does not establish compliance with the Nemotron-on-Nebius requirement. Complete and demonstrate a genuine inference call before claiming the integration works or the submission meets that requirement. Automated tests do not claim a live inference call.

Keep this demo local. Real team use needs authentication, permissions, request quotas, shared storage, backups and operational integrations.

## Tally handoff

The XML is an **accounting-only Sales voucher**, not an inventory voucher or a validated GST tax invoice. It does not create company or ledger masters. Enter the exact existing company, customer, sales and applicable output-tax ledger names.

Accounts must select **CGST + SGST** or **IGST**. The app does not infer jurisdiction from addresses, invent GSTINs or validate GST filing compliance. Entries debit the customer for the total and credit sales/output taxes; amounts are balanced in paise.

Review tax treatment and voucher numbering with an accountant in a **Tally test company** before real accounting use. No real Tally import has been performed or validated for this MVP. An export timestamp means only that XML was prepared.

A stable order-based `REMOTEID` and reference assist reconciliation. **They do not guarantee deduplication. Repeated imports may create duplicate vouchers.** Check existing references and import results before retrying. Final invoice creation and confirmation remain in Tally. The format follows [TallyHelp's XML samples](https://help.tallysolutions.com/sample-xml/).

## Verify

```sh
node --experimental-strip-types --test tests/*.test.ts
npm run lint
npm run build
```

Tests cover matching, quotation snapshots, reservations, receipt/dispatch gates, extraction validation, XML escaping, ledger checks and balanced accounting entries. The 30–50% administrative-cost reduction is a target to validate with a reseller, not a measured result. Measure complete enquiries including review/corrections, and distinguish released capacity from cash savings.

## Source map

- `app/`: interface, styles and server-side AI extraction route.
- `lib/sales.ts`: domain records, sample data, matching, totals and transitions.
- `lib/intake.ts`: extraction contracts and limited sample parsers.
- `lib/documents.ts`: quotations, invoice drafts, dispatch sheets and Tally XML.
- `tests/`: domain, extraction and document checks.
- `public/`: sample reference files and static assets.
- `scripts/`: maintained build and Sites runtime helpers.

SourceDesk's authored code is MIT licensed. Dependencies and vendored files retain their respective licenses.
