import { expect, test } from "@playwright/test";

const futureExpiry = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

function userForToken(token) {
  if (token === "reviewer-token") {
    return {
      name: "Test Epidemiology Reviewer",
      role: "Epidemiology Reviewer",
      canAdmin: false,
      canView: true,
      canReview: true,
      canReport: true,
      canDelete: false,
      canImport: false,
      expiresAt: futureExpiry(),
    };
  }

  return {
    name: "Test Field Reporter",
    role: "Field Reporter",
    canAdmin: false,
    canView: true,
    canReview: false,
    canReport: true,
    canDelete: false,
    canImport: false,
    expiresAt: futureExpiry(),
  };
}

async function createIsolatedApi(page, initialRecords = []) {
  const state = {
    records: structuredClone(initialRecords),
    submittedCase: null,
    reviewedCase: null,
  };

  await page.route("**/api.mapbox.com/**", (route) => route.abort());
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const token = (request.headers().authorization || "").replace(/^Bearer\s+/i, "");

    if (url.pathname === "/api/settings") {
      await route.fulfill({
        json: {
          organizationName: "GeoHealth Insights Test",
          defaultRegion: "Test Jurisdiction",
          surveillanceScope: "Isolated browser workflow testing",
          diseaseList: ["COVID-19", "Influenza", "Measles", "Malaria"],
          facilityList: ["Test Clinic", "Test Laboratory"],
          reportSourceList: ["Field report", "Clinic report"],
        },
      });
      return;
    }

    if (url.pathname === "/api/auth/session") {
      if (!token) {
        await route.fulfill({ status: 401, json: { error: "Authentication required." } });
        return;
      }
      await route.fulfill({ json: { user: userForToken(token) } });
      return;
    }

    if (url.pathname === "/api/health-data" && request.method() === "GET") {
      await route.fulfill({ json: state.records });
      return;
    }

    if (url.pathname === "/api/cases" && request.method() === "POST") {
      const payload = request.postDataJSON();
      const user = userForToken(token);
      const record = {
        ...payload,
        _id: `test-case-${state.records.length + 1}`,
        lat: payload.latitude,
        lng: payload.longitude,
        submittedBy: user.name,
        submittedByRole: user.role,
        locationVerification: "Needs location review",
        reviewHistory: [],
      };
      state.records.push(record);
      state.submittedCase = record;
      await route.fulfill({ status: 201, json: record });
      return;
    }

    if (url.pathname === "/api/registry-cases" && request.method() === "GET") {
      await route.fulfill({ json: state.records });
      return;
    }

    const caseMatch = url.pathname.match(/^\/api\/cases\/([^/]+)$/);
    if (caseMatch && request.method() === "PATCH") {
      const index = state.records.findIndex((record) => record._id === caseMatch[1]);
      const payload = request.postDataJSON();
      const current = state.records[index];
      const updated = {
        ...current,
        ...payload,
        lat: Number(payload.latitude ?? current.lat),
        lng: Number(payload.longitude ?? current.lng),
        reviewHistory: [
          ...(current.reviewHistory || []),
          {
            reviewedAt: new Date().toISOString(),
            status: payload.status,
            priority: payload.priority,
            notes: payload.notes,
            changedFields: ["status", "priority", "notes"],
          },
        ],
      };
      state.records[index] = updated;
      state.reviewedCase = updated;
      await route.fulfill({ json: updated });
      return;
    }

    await route.fulfill({ status: 404, json: { error: `Unhandled isolated route: ${url.pathname}` } });
  });

  return state;
}

async function chooseOption(root, page, label, option) {
  await root.getByLabel(label).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("field reporter submits a case without touching production", async ({ page, context }) => {
  const state = await createIsolatedApi(page);
  await context.grantPermissions(["geolocation"], { origin: "http://127.0.0.1:4173" });
  await context.setGeolocation({ latitude: 43.0731, longitude: -89.4012 });
  await page.addInitScript(() => localStorage.setItem("geohealth_admin_token", "field-token"));

  await page.goto("/");
  await expect(page.getByText(/Reporting as Test Field Reporter/)).toBeVisible();

  const reportForm = page.locator("form");
  await chooseOption(reportForm, page, "Disease", "Measles");
  await reportForm.getByLabel("Location").fill("Isolated Test City");
  await reportForm.getByLabel("Case Count").fill("3");
  await reportForm.getByLabel("Date").fill("2026-09-23");
  await reportForm.getByLabel("Notes").fill("Automated isolated submission test");
  await reportForm.getByRole("button", { name: "Report Case" }).click();

  await expect(page.getByText("Case reported successfully!")).toBeVisible();
  expect(state.submittedCase).toMatchObject({
    disease: "Measles",
    location: "Isolated Test City",
    cases: 3,
    status: "New",
    submittedByRole: "Field Reporter",
  });
  expect(state.submittedCase.lat).toBeCloseTo(43.0731);
  expect(state.submittedCase.lng).toBeCloseTo(-89.4012);
});

test("epidemiology reviewer updates an isolated case", async ({ page }) => {
  const state = await createIsolatedApi(page, [
    {
      _id: "review-case-1",
      disease: "Malaria",
      location: "Test District",
      enteredLocation: "Test District",
      cases: 2,
      status: "New",
      priority: "Medium",
      ageGroup: "18-49",
      sex: "Female",
      facility: "Test Clinic",
      reportSource: "Field report",
      notes: "Awaiting verification",
      date: "2026-09-22",
      symptomOnsetDate: "2026-09-21",
      lat: 13.45,
      lng: -16.57,
      locationSource: "GPS captured",
      locationVerification: "GPS verified",
      submittedBy: "Test Field Reporter",
      submittedByRole: "Field Reporter",
      reviewHistory: [],
    },
  ]);
  await page.addInitScript(() => localStorage.setItem("geohealth_admin_token", "reviewer-token"));

  await page.goto("/cases");
  await expect(page.getByRole("heading", { name: "GeoHealth Insights Test Case Registry" })).toBeVisible();
  await expect(page.getByText("Malaria", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Review" }).click();

  const dialog = page.getByRole("dialog", { name: "Review Case" });
  await dialog.getByLabel("Status").click();
  await page.getByRole("option", { name: "Confirmed", exact: true }).click();
  await dialog.getByLabel("Priority").click();
  await page.getByRole("option", { name: "High", exact: true }).click();
  await dialog.getByLabel("Review Notes").fill("Confirmed during isolated browser review");
  await dialog.getByRole("button", { name: "Save Review" }).click();

  await expect(dialog.getByText("Case review updated.")).toBeVisible();
  expect(state.reviewedCase).toMatchObject({
    _id: "review-case-1",
    status: "Confirmed",
    priority: "High",
    notes: "Confirmed during isolated browser review",
  });
  expect(state.reviewedCase.reviewHistory).toHaveLength(1);
});
