import { test, expect } from "@playwright/test";
import { openFresh, nav, openLead, toast } from "./helpers";

test("sample workspace loads with seeded counts and navigation", async ({ page }) => {
  await openFresh(page);
  await expect(nav(page, "Leads & enquiries")).toContainText("6");
  await expect(nav(page, "Distributor offers")).toContainText("4");
  for (const [label, heading] of [["Inventory", "Inventory"], ["Distributor offers", "Distributor offers"], ["Quotations", "Customer quotations"], ["Orders & dispatch", "Orders & dispatch"], ["Workspace settings", "Workspace settings"]] as const) {
    await nav(page, label).click();
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  }
});

test("lead search and stage filter narrow the table and show an empty state", async ({ page }) => {
  await openFresh(page);
  await page.getByLabel("Search leads").fill("studio");
  await expect(page.getByRole("row")).toHaveCount(2);
  await page.getByLabel("Search leads").fill("no such customer");
  await expect(page.getByText("No enquiries found")).toBeVisible();
  await page.getByLabel("Search leads").fill("");
  await page.getByLabel("Filter lead stage").selectOption("dispatched");
  await expect(page.getByRole("row")).toHaveCount(2);
  await expect(page.getByText("Bloom Commerce")).toBeVisible();
});

test("inventory search matches serials", async ({ page }) => {
  await openFresh(page);
  await nav(page, "Inventory").click();
  await page.getByLabel("Search inventory").fill("HP-840-4002");
  await expect(page.getByRole("row")).toHaveCount(2);
  await expect(page.getByText("EliteBook 840 G8")).toBeVisible();
});

test("changes persist across reload and reset restores the sample", async ({ page }) => {
  await openFresh(page);
  await page.getByRole("button", { name: "New lead" }).click();
  await page.getByRole("button", { name: "Sample rules" }).click();
  await page.getByRole("button", { name: "Create lead" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Meridian Design Studio" })).toBeVisible();
  await page.reload();
  await expect(nav(page, "Leads & enquiries")).toContainText("7");
  await expect(page.locator("tr", { hasText: "Meridian Design Studio" })).toBeVisible();

  await nav(page, "Workspace settings").click();
  await page.getByRole("button", { name: "Reset sample" }).click();
  await page.getByRole("button", { name: "Reset now" }).click();
  await expect(toast(page)).toContainText("Fresh sample workspace loaded.");
  await expect(nav(page, "Leads & enquiries")).toContainText("6");
});

test("corrupt saved data opens recovery without overwriting storage", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("sourcedesk.workspace.v1", "{not json"));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Recover your workspace" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("sourcedesk.workspace.v1"))).toBe("{not json");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download saved data" }).click();
  expect((await download).suggestedFilename()).toBe("sourcedesk-recovery.json");
  await page.getByRole("button", { name: "Reset sample" }).click();
  await page.getByRole("button", { name: "Replace saved data" }).click();
  await expect(page.getByRole("heading", { name: "A clearer path to every sale." })).toBeVisible();
});

test("settings backup downloads the workspace JSON", async ({ page }) => {
  await openFresh(page);
  await nav(page, "Workspace settings").click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download backup" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("sourcedesk-sample-backup.json");
  const body = JSON.parse(await (await file.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString()));
  expect(body.version).toBe(1);
  expect(body.leads).toHaveLength(6);
});

test("RFQ draft downloads the lead requirement", async ({ page }) => {
  await openFresh(page);
  await openLead(page, "Studio North");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "RFQ draft" }).click();
  expect((await download).suggestedFilename()).toBe("LD-001-distributor-enquiry.txt");
  await expect(toast(page)).toContainText("No message was sent");
});
