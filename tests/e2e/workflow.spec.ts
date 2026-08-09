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
  await expect(page.locator(".step").filter({ hasText: /live/i })).toBeDisabled();

  await page.getByRole("button", { name: /START LIVE SIMULATION/i }).click();
  await expect(page.getByText("LIVE SIMULATION", { exact: false }).first()).toBeVisible();
  await expect(page.getByText(/Live telemetry connected|Simulation connected/i)).toBeVisible();
  await expect(page.locator(".venue-background")).toHaveAttribute("src", /stadio-benito-stirpe\.png/);

  const policy = {
    id: "policy-safe-east",
    label: "Bypass east concourse",
    avoidEdgeIds: ["edge-main"],
    preferEdgeIds: ["edge-east"],
    penaltyMultiplier: 25,
    compliance: 0.8,
  };
  await page.route("**/api/sessions/*/advice", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        summary: "An alternate corridor may reduce pressure.",
        provider: "openai",
        confidence: 0.91,
        actions: [{
          id: "ai-action-1",
          type: "meter_entry",
          priority: 1,
          summary: "Meter the north gate",
          rationale: "Arrival pressure is concentrated at the primary approach.",
          findingIds: ["finding-1"],
          evidenceIds: [],
        }],
        findingBundle: { findings: [{ id: "finding-1", summary: "North concourse: pressure rising", nodeIds: [], edgeIds: [] }] },
        reroutes: [{
          policy,
          metrics: {
            recommended: true,
            peakOccupancyRatioDelta: -0.12,
            congestionExposureDeltaPersonMinutes: -310,
            exitedPeopleDelta: 18,
          },
        }],
      }),
    });
  });

  let appliedPolicyId = "";
  await page.route("**/api/sessions/*/reroute", async (route) => {
    appliedPolicyId = String((await route.request().postDataJSON()).policyId);
    const snapshotResponse = await page.request.get(route.request().url().replace(/\/reroute$/, "/snapshot"));
    const snapshotPayload = await snapshotResponse.json();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ applied: true, evaluation: { policy }, snapshot: snapshotPayload.snapshot }),
    });
  });

  await page.getByRole("button", { name: /PREVIEW ON MAP/i }).click();
  await expect(page.getByRole("heading", { name: "Preview: Bypass east concourse" })).toBeVisible();
  await expect(page.getByText(/AI context:.*Meter the north gate/i)).toBeVisible();
  await page.getByRole("button", { name: /APPLY POLICY/i }).click();
  await expect.poll(() => appliedPolicyId).toBe(policy.id);
  await expect(page.getByRole("heading", { name: "Applied: Bypass east concourse" })).toBeVisible();
  await page.close();
});

test("editing graph or scenario revokes confirmation and exposes complete controls", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByLabel("Phase type").first()).toBeVisible();
  await expect(page.getByLabel("Reroute compliance %").first()).toBeVisible();
  await expect(page.getByLabel(/entry weights$/i).first()).toBeVisible();
  await expect(page.getByLabel(/target weights$/i).first()).toBeVisible();

  await page.getByRole("button", { name: /EXTRACT & REVIEW/i }).click();
  await page.getByRole("button", { name: /CONFIRM THIS GRAPH/i }).click();
  await expect(page.getByRole("button", { name: /START LIVE SIMULATION/i })).toBeEnabled();

  const originalNodes = Number((await page.getByTestId("review-node-count").innerText()).match(/\d+/)?.[0]);
  const originalLinks = Number((await page.getByTestId("review-link-count").innerText()).match(/\d+/)?.[0]);
  await page.locator(".map-toolbar").getByRole("button", { name: "+ NODE", exact: true }).click();
  await expect(page.getByTestId("review-node-count")).toContainText(String(originalNodes + 1));
  await expect(page.getByRole("button", { name: /START LIVE SIMULATION/i })).toBeDisabled();
  await expect(page.getByRole("button", { name: /CONFIRM THIS GRAPH/i })).toBeVisible();

  await page.locator(".map-toolbar").getByRole("button", { name: "+ LINK", exact: true }).click();
  await expect(page.getByTestId("review-link-count")).toContainText(String(originalLinks + 1));
  await page.getByLabel("Link length metres").fill("42.5");
  await page.getByLabel("Link width metres").fill("4.5");
  await page.getByLabel("Link capacity people").fill("240");
  await page.getByLabel("Link flow per minute").fill("96");
  await page.locator(".inspector-actions").getByRole("button", { name: "REMOVE" }).click();
  await expect(page.getByTestId("review-link-count")).toContainText(String(originalLinks));

  await page.getByRole("button", { name: /CONFIRM THIS GRAPH/i }).click();
  await expect(page.getByRole("button", { name: /START LIVE SIMULATION/i })).toBeEnabled();
  await page.getByRole("button", { name: /BACK TO SETUP/i }).click();
  await page.getByRole("spinbutton", { name: "Expected crowd size", exact: true }).fill("65001");
  await expect(page.locator(".step").filter({ hasText: /review/i })).toBeDisabled();
  await expect(page.locator(".step").filter({ hasText: /live/i })).toBeDisabled();
  await expect(page.getByRole("button", { name: /EXTRACT & REVIEW/i })).toBeEnabled();
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
