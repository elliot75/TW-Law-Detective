import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { validBundle, validExplanation } from "../tests/fixtures";

test.beforeEach(async ({ page }) => {
  await page.route("https://tlr.dr-lawbot.com/v1/pack", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(validBundle),
    });
  });
});

test("searches, presents judgments, and downloads a verifiable bundle", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("描述你想了解的情況").fill("房東不退押金");
  await page.getByRole("button", { name: "搜尋相關判決" }).click();

  await expect(page.getByRole("heading", { name: "與你的問題相關的判決" })).toBeVisible();
  await expect(page.locator("#judgment-J1")).toContainText("可引用");
  await expect(page.locator("#judgment-J2")).toContainText("廢棄");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "下載 JSON" }).click();
  expect((await download).suggestedFilename()).toBe("twlegalrag-bundle.json");
});

test("uses a transient BYOK request and renders only cited AI findings", async ({
  page,
}) => {
  let capturedBody = "";
  let capturedKey = "";
  await page.route("**/api/explain", async (route) => {
    capturedBody = route.request().postData() ?? "";
    capturedKey = route.request().headers()["x-provider-api-key"] ?? "";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(validExplanation),
    });
  });

  await page.goto("/");
  await page.getByLabel("描述你想了解的情況").fill("房東不退押金");
  await page.getByRole("button", { name: "搜尋相關判決" }).click();
  await page.getByRole("button", { name: "AI 白話整理" }).click();
  await page.getByLabel("API 金鑰").fill("ephemeral-key");
  await page.getByText(/我了解問題與判決節錄/).click();
  await page.getByRole("button", { name: "同意並開始整理" }).click();

  await expect(page.getByRole("heading", { name: "AI 白話整理" })).toBeVisible();
  await expect(page.locator(".summary-block .citation-pill")).toHaveCount(2);
  expect(capturedKey).toBe("ephemeral-key");
  expect(capturedBody).not.toContain("ephemeral-key");
  expect(await page.evaluate(() => ({ ...localStorage }))).toEqual({});
  expect((await page.context().cookies()).length).toBe(0);
});

test("clears the legal query after reload and meets basic accessibility checks", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("描述你想了解的情況").fill("只存在記憶體的問題");
  await page.reload();
  await expect(page.getByLabel("描述你想了解的情況")).toHaveValue("");

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});
