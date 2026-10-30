import { test, expect } from "@playwright/test";
import { openFresh, nav, openLead, acceptStudioNorthQuote, toast } from "./helpers";

test("inventory tab explains mismatches and offers rank by fit", async ({ page }) => {
  await openFresh(page);
  await openLead(page, "Studio North");
  await expect(page.getByText("Meets request")).toHaveCount(0);
  await expect(page.getByText("Review differences").first()).toBeVisible();
  await page.locator(".tabs").getByRole("button", { name: /^Distributor offers/ }).click();
  await expect(page.locator(".offer", { hasText: "Vertex Distribution" }).getByText("Needs review")).toBeVisible();
  await expect(page.locator(".offer", { hasText: "Prime IT Wholesale" }).getByText("Needs review")).toBeVisible();
  await expect(page.locator(".offer", { hasText: "Redwood IT Partners" }).getByText("Fits requirements")).toBeVisible();
  await page.locator(".offer", { hasText: "Vertex Distribution" }).getByText("View original reply").click();
  await expect(page.getByText("32 GB / 2 TB is NOT included")).toBeVisible();
});

test("quoting a non-matching offer requires recorded customer approval", async ({ page }) => {
  await openFresh(page);
  await openLead(page, "Studio North");
  await page.locator(".tabs").getByRole("button", { name: /^Distributor offers/ }).click();
  await page.locator(".offer", { hasText: "Vertex Distribution" }).getByRole("button", { name: "Prepare quote" }).click();
  const composer = page.locator("#quote-composer");
  await expect(composer.getByText("Customer total")).toBeVisible();
  const create = composer.getByRole("button", { name: "Create quotation" });
  await expect(create).toBeDisabled();
  await composer.getByLabel(/customer explicitly approved/).check();
  await expect(create).toBeDisabled();
  await composer.getByLabel(/Approval reference/).fill("Email 29 Oct approving 1 TB");
  await expect(create).toBeEnabled();
  await create.click();
  await expect(page.getByText("Approved differences: Email 29 Oct approving 1 TB")).toBeVisible();
});

test("quote composer shows totals, budget warning and rejects an empty price", async ({ page }) => {
  await openFresh(page);
  await openLead(page, "Studio North");
  await page.locator(".tabs").getByRole("button", { name: /^Distributor offers/ }).click();
  await page.locator(".offer", { hasText: "Redwood IT Partners" }).getByRole("button", { name: "Prepare quote" }).click();
  const composer = page.locator("#quote-composer");
  await composer.getByLabel(/Selling price/).fill("139000");
  await expect(composer).toContainText("₹3,28,040");
  await expect(composer.getByText("exceeds the customer’s stated budget")).toHaveCount(0);
  await composer.getByLabel(/Selling price/).fill("150000");
  await expect(composer.getByText("exceeds the customer’s stated budget")).toBeVisible();
  await composer.getByLabel(/Selling price/).fill("");
  await expect(composer.getByRole("button", { name: "Create quotation" })).toBeDisabled();
});

test("full Studio North journey: quote, share, accept, receive, pack, dispatch", async ({ page }) => {
  await openFresh(page);
  await acceptStudioNorthQuote(page);
  await expect(toast(page)).toContainText("reserved");

  // Packing is blocked until physical receipt; receipt validates serial count and uniqueness.
  await expect(page.getByText("Awaiting physical receipt")).toBeVisible();
  await expect(page.getByLabel("Device configuration and serial numbers verified")).toBeDisabled();
  const serials = page.getByLabel(/Device serial numbers/);
  const confirm = page.getByRole("button", { name: "Confirm receipt" });
  await serials.fill("DEMO-SN-001");
  await page.getByLabel(/physically received and checked/).check();
  await confirm.click();
  await expect(toast(page)).toContainText("2");
  await serials.fill("DEMO-SN-001\ndemo-sn-001");
  await confirm.click();
  await expect(toast(page)).toHaveClass(/error/);
  await serials.fill("DEMO-SN-001\nDEMO-SN-002");
  await confirm.click();
  await expect(toast(page)).toContainText("Physical receipt recorded");
  await expect(page.locator(".serial-list")).toContainText("DEMO-SN-002");

  // Tally export needs an invoice reference; packing needs checks, reference and address.
  await expect(page.getByRole("button", { name: "Tally XML" })).toBeDisabled();
  const packed = page.getByRole("button", { name: "Mark packed" });
  await expect(packed).toBeDisabled();
  await page.getByLabel(/Invoice \/ proposed Tally voucher reference/).fill("SAMPLE/26-27/1043");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Tally XML" }).click();
  expect((await download).suggestedFilename()).toMatch(/^SO-\d+-tally-DRAFT\.xml$/);
  await expect(page.getByText(/XML exported/)).toBeVisible();
  for (const label of ["Device configuration and serial numbers verified", "Charger and agreed accessories packed", "Invoice verified in Tally and included with parcel", "Customer delivery address verified"]) {
    await page.getByLabel(label).check();
  }
  await expect(packed).toBeEnabled();
  await packed.click();
  await expect(toast(page)).toContainText("Packing verified");

  // Dispatch needs courier and tracking, then locks the order.
  const dispatch = page.getByRole("button", { name: "Confirm dispatch" });
  await expect(dispatch).toBeDisabled();
  await expect(page.getByLabel(/Invoice \/ proposed Tally voucher reference/)).toBeDisabled();
  await page.getByLabel("Courier").fill("BlueDart");
  await page.getByLabel(/Tracking/).fill("AWB123");
  await dispatch.click();
  await expect(page.getByText("Dispatched with BlueDart. Tracking: AWB123.")).toBeVisible();
  await expect(page.getByLabel("Courier")).toBeDisabled();

  // Status propagates to lists.
  await nav(page, "Orders & dispatch").click();
  await expect(page.locator("tr", { hasText: "Studio North" })).toContainText("Dispatched");
  await nav(page, "Leads & enquiries").click();
  await expect(page.locator("tr", { hasText: "Studio North" })).toContainText("Dispatched");
  await expect(nav(page, "Quotations")).toContainText("1");
});

test("a second quote for the same lead is blocked once an order exists", async ({ page }) => {
  await openFresh(page);
  await acceptStudioNorthQuote(page);
  await openLead(page, "Studio North");
  await expect(page.getByRole("button", { name: "Open fulfilment order" })).toBeVisible();
  await page.locator(".tabs").getByRole("button", { name: /^Distributor offers/ }).click();
  for (const button of await page.getByRole("button", { name: "Prepare quote" }).all()) await expect(button).toBeDisabled();
});

test("inventory-backed acceptance reserves stock", async ({ page }) => {
  await openFresh(page);
  await openLead(page, "Orbit Analytics");
  const thinkpad = page.locator(".offer", { hasText: "ThinkPad E14" });
  await expect(thinkpad.getByText("Meets request")).toBeVisible();
  await thinkpad.getByRole("button", { name: "Prepare quote" }).click();
  await page.locator("#quote-composer").getByRole("button", { name: "Create quotation" }).click();
  await page.getByRole("button", { name: "Mark as shared" }).click();
  await page.getByLabel(/I have the customer/).check();
  await page.getByRole("button", { name: "Record acceptance" }).click();
  await expect(page.getByRole("heading", { name: "1. Invoice & delivery details" })).toBeVisible();
  await expect(page.locator(".serial-list")).toContainText("LN-E14-5001");
  await nav(page, "Inventory").click();
  await expect(page.locator("tr", { hasText: "ThinkPad E14" })).toContainText("0 units");
});

test("printable documents open in a new tab", async ({ page, context }) => {
  await openFresh(page);
  await nav(page, "Quotations").click();
  await page.getByRole("button", { name: "Open QT-001" }).click();
  const popup = context.waitForEvent("page");
  await page.getByRole("button", { name: "Print / save PDF" }).click();
  const printed = await popup;
  await expect(printed.locator("body")).toContainText("QT-001");
});
