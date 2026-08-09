import { expect, test } from "@playwright/test";

test("operator must confirm the real-layout graph before live simulation", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /See the surge/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /IPL Stadium/i })).toBeVisible();

  const presetImages = page.locator(".preset-card img");
  await expect(presetImages).toHaveCount(7);
  await expect.poll(async () => presetImages.evaluateAll((images) =>
    images.every((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0),
  )).toBe(true);

  await page.getByRole("button", { name: /EXTRACT & REVIEW/i }).click();
  await expect(page.getByRole("heading", { name: /Review the extracted network/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /START LIVE SIMULATION/i })).toBeDisabled();

  await page.getByRole("button", { name: /CONFIRM THIS GRAPH/i }).click();
  await expect(page.getByRole("button", { name: /GRAPH CONFIRMED/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /START LIVE SIMULATION/i })).toBeEnabled();

  await page.getByRole("button", { name: /START LIVE SIMULATION/i }).click();
  await expect(page.getByText("LIVE SIMULATION", { exact: false }).first()).toBeVisible();
  await expect(page.getByText(/Live telemetry connected|Simulation connected/i)).toBeVisible();
  await expect(page.locator(".venue-background")).toHaveAttribute("src", /stadio-benito-stirpe\.png/);
  await page.close();
});

test("API rejects an unconfirmed session", async ({ request }) => {
  const presets = await request.get("/api/presets");
  expect(presets.ok()).toBeTruthy();
  const payload = await presets.json();
  const preset = payload.presets.find((item: { id: string }) => item.id === "concert-arena");

  const created = await request.post("/api/sessions", {
    data: {
      presetId: preset.id,
      crowdSize: preset.crowdSize,
      schedule: preset.schedule,
    },
  });
  expect(created.status()).toBe(201);
  const session = await created.json();

  const start = await request.post(`/api/sessions/${session.sessionId}/sim/start`, { data: {} });
  expect(start.status()).toBe(409);
  expect((await start.json()).code).toBe("CONFIRMATION_REQUIRED");
});
