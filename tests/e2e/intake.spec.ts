import { test, expect } from "@playwright/test";
import { openFresh, openLead, toast } from "./helpers";

test("new lead requires confirmed fields and sample rules fill them", async ({ page }) => {
  await openFresh(page);
  await page.getByRole("button", { name: "New lead" }).click();
  await page.getByLabel("Customer enquiry").fill("Need 2 laptops with AMD 9, 32GB RAM, 2TB SSD");
  await page.getByRole("button", { name: "Sample rules" }).click();
  await expect(page.getByText("Extracted with sample rules")).toBeVisible();
  await expect(page.getByRole("status")).toContainText("AMD 9");
  await expect(page.getByLabel("Processor family")).toHaveValue("");
  await page.getByLabel("Customer company").fill("Edge Co");
  await page.getByLabel("Contact name").fill("Tester");
  await page.getByLabel("Device condition").selectOption("New");
  await page.getByLabel("Laptop quantity").fill("2");
  await page.getByLabel("Warranty (months · 0 = none)").fill("12");
  await page.getByLabel(/Budget per laptop/).fill("100000");
  await page.getByLabel("Delivery within (days)").fill("5");
  await page.getByRole("button", { name: "Create lead" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Edge Co" })).not.toBeVisible();
  await page.getByLabel("Processor family").fill("AMD Ryzen 9");
  await page.getByRole("button", { name: "Create lead" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Edge Co" })).toBeVisible();
  await expect(toast(page)).toContainText("Lead created");
});

test("Nemotron button surfaces a server error without a key and keeps manual entry usable", async ({ page }) => {
  await page.route("**/api/ai", (route) => route.fulfill({ status: 503, json: { error: "Nemotron is not configured. Use manual entry or the clearly labelled sample parser." } }));
  await openFresh(page);
  await page.getByRole("button", { name: "New lead" }).click();
  await page.getByRole("button", { name: "Use Nemotron" }).click();
  await expect(page.getByRole("alert")).toContainText("Nemotron is not configured");
  await page.getByRole("button", { name: "Sample rules" }).click();
  await expect(page.getByLabel("Customer company")).toHaveValue("Meridian Design Studio");
});

test("Nemotron extraction fills the form and labels the mode", async ({ page }) => {
  await page.route("**/api/ai", (route) => route.fulfill({ status: 200, json: { mode: "nemotron", clarifications: ["Confirm delivery address."], data: { company: "Mock Labs", contact: "Mia", email: "", phone: "", quantity: 3, requirements: { cpuFamily: "Intel Core i7", ramGb: 16, ssdGb: 1000, condition: "new", warrantyMonths: 12 }, budget: 80000, maxDeliveryDays: 4, address: "" } } }));
  await openFresh(page);
  await page.getByRole("button", { name: "New lead" }).click();
  await page.getByRole("button", { name: "Use Nemotron" }).click();
  await expect(page.getByText("Extracted with Nemotron on Nebius Token Factory")).toBeVisible();
  await expect(page.getByLabel("Customer company")).toHaveValue("Mock Labs");
  await expect(page.getByLabel("SSD (GB · 2 TB = 2000 GB)")).toHaveValue("1000");
  await expect(page.getByRole("status")).toContainText("Confirm delivery address.");
});

test("supplier offer needs review, a future validity date, and then appears in the comparison", async ({ page }) => {
  await openFresh(page);
  await openLead(page, "Orbit Analytics");
  await page.locator(".tabs").getByRole("button", { name: /^Distributor offers/ }).click();
  await expect(page.getByText("No distributor replies yet")).toBeVisible();
  await page.getByRole("button", { name: "Add reply" }).click();
  await page.getByRole("button", { name: "Sample rules" }).click();
  await expect(page.getByLabel("Unit cost excluding GST (INR)")).toHaveValue("89500");
  await expect(page.getByText("Supplier price explicitly excludes GST")).toBeVisible();
  await page.getByLabel(/^Distributor/).selectOption("DIST-001");
  await page.getByLabel("Reply received through").selectOption("WhatsApp");
  await expect(page.getByRole("button", { name: "Save supplier offer" })).toBeDisabled();
  // Editing any field clears the review confirmation, so set the date before confirming.
  await page.getByLabel(/Offer valid until/).fill("2020-01-01T10:00");
  await page.getByLabel(/I checked the original reply/).check();
  await page.getByRole("button", { name: "Save supplier offer" }).click();
  await expect(page.getByRole("alert")).toContainText("validity date in the future");
  await page.getByLabel(/Offer valid until/).fill("2030-01-01T10:00");
  await page.getByLabel(/I checked the original reply/).check();
  await page.getByRole("button", { name: "Save supplier offer" }).click();
  await expect(toast(page)).toContainText("Distributor offer recorded.");
  const offer = page.locator(".offer", { hasText: "Vertex Distribution" });
  await expect(offer.getByText("Needs review")).toBeVisible();
  await expect(offer).toContainText("ASUS Vivobook Pro 15");
});
