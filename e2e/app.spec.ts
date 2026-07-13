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
  const storedValues = JSON.stringify(
    await page.evaluate(() => ({ ...localStorage })),
  );
  expect(storedValues).not.toContain("ephemeral-key");
  expect((await page.context().cookies()).length).toBe(0);
});

test("reuses custom HTTP endpoint settings without persisting the API key", async ({
  page,
}) => {
  let capturedKey = "";
  await page.route(
    "http://127.0.0.1:3000/local-model/v1/chat/completions",
    async (route) => {
      capturedKey = route.request().headers().authorization ?? "";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({
          choices: [{ message: { content: JSON.stringify(validExplanation) } }],
        }),
      });
    },
  );

  await page.goto("/");
  await page.getByLabel("描述你想了解的情況").fill("房東不退押金");
  await page.getByRole("button", { name: "搜尋相關判決" }).click();
  await page.getByRole("button", { name: "AI 白話整理" }).click();
  await page.getByRole("radio", { name: /自訂相容端點/ }).check();
  await page
    .getByLabel("OpenAI-compatible Base URL")
    .fill("http://127.0.0.1:3000/local-model/v1");
  await page.getByLabel("模型 ID").fill("local-model");
  await page.getByLabel("API 金鑰").fill("memory-only-key");
  await page.getByText(/我了解問題與判決節錄/).click();
  await page.getByRole("button", { name: "同意並開始整理" }).click();

  await expect(page.getByRole("heading", { name: "AI 白話整理" })).toBeVisible();
  expect(capturedKey).toBe("Bearer memory-only-key");
  const storedValues = JSON.stringify(
    await page.evaluate(() => ({ ...localStorage })),
  );
  expect(storedValues).toContain("http://127.0.0.1:3000/local-model/v1");
  expect(storedValues).toContain("local-model");
  expect(storedValues).not.toContain("memory-only-key");

  await page.getByRole("button", { name: "搜尋相關判決" }).click();
  await page.getByRole("button", { name: "AI 白話整理" }).click();
  await expect(page.getByLabel("API 金鑰")).toHaveValue("memory-only-key");
  await page.getByRole("button", { name: "關閉" }).click();

  await page.reload();
  await page.getByLabel("描述你想了解的情況").fill("房東不退押金");
  await page.getByRole("button", { name: "搜尋相關判決" }).click();
  await page.getByRole("button", { name: "AI 白話整理" }).click();
  await expect(page.getByRole("radio", { name: /自訂相容端點/ })).toBeChecked();
  await expect(page.getByLabel("OpenAI-compatible Base URL")).toHaveValue(
    "http://127.0.0.1:3000/local-model/v1",
  );
  await expect(page.getByLabel("模型 ID")).toHaveValue("local-model");
  await expect(page.getByLabel("API 金鑰")).toHaveValue("");
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
