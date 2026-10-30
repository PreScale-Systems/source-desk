import { expect, type Page } from "@playwright/test";

/** Open the workspace on fresh sample data. */
export async function openFresh(page: Page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByRole("heading", { name: "A clearer path to every sale." })).toBeVisible();
}

export const nav = (page: Page, label: string) => page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: label });

export async function openLead(page: Page, company: string) {
  await nav(page, "Leads & enquiries").click();
  await page.getByRole("button", { name: `Open ${company}` }).click();
  await expect(page.getByRole("heading", { level: 1, name: company })).toBeVisible();
}

/** Studio North (LD-001): quote OFR-003, share, accept. Returns on the order screen. */
export async function acceptStudioNorthQuote(page: Page, salePrice = "139000") {
  await openLead(page, "Studio North");
  await page.locator(".tabs").getByRole("button", { name: /^Distributor offers/ }).click();
  const redwood = page.locator(".offer", { hasText: "Redwood IT Partners" });
  await expect(redwood.getByText("Fits requirements")).toBeVisible();
  await redwood.getByRole("button", { name: "Prepare quote" }).click();
  const composer = page.locator("#quote-composer");
  await composer.getByLabel(/Selling price/).fill(salePrice);
  await composer.getByRole("button", { name: "Create quotation" }).click();
  await expect(page.getByText("CUSTOMER QUOTATION", { exact: false }).first()).toBeVisible();
  await page.getByRole("button", { name: "Mark as shared" }).click();
  await page.getByLabel(/I have the customer/).check();
  await page.getByRole("button", { name: "Record acceptance" }).click();
  await expect(page.getByRole("heading", { name: "1. Receive supplier devices" })).toBeVisible();
}

export const toast = (page: Page) => page.locator(".toast");
