import { expect, test } from "@playwright/test";

async function mockPublicApi(page) {
  await page.route("**/api.mapbox.com/**", (route) => route.abort());
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;

    if (pathname === "/api/settings") {
      await route.fulfill({
        json: {
          organizationName: "GeoHealth Insights",
          defaultRegion: "Madison, WI",
          surveillanceScope: "Disease surveillance and geospatial reporting",
        },
      });
      return;
    }

    if (pathname === "/api/health-data") {
      await route.fulfill({ json: [] });
      return;
    }

    if (pathname === "/api/health/ready") {
      await route.fulfill({
        json: {
          status: "ready",
          checks: { api: { status: "ready" }, database: { status: "ready" } },
        },
      });
      return;
    }

    if (pathname === "/api/auth/session") {
      await route.fulfill({ status: 401, json: { error: "Authentication required." } });
      return;
    }

    if (pathname === "/api/auth/user-login") {
      await route.fulfill({
        json: {
          token: "browser-test-token",
          user: {
            name: "Test Field Reporter",
            role: "Field Reporter",
            canAdmin: false,
            canView: true,
            canReview: false,
            canImport: false,
            expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          },
        },
      });
      return;
    }

    await route.fulfill({ status: 404, json: { error: "Not available in browser tests." } });
  });
}

test.beforeEach(async ({ page }) => {
  await mockPublicApi(page);
});

test("public surveillance dashboard renders without staff access", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Situation Overview" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Geographic Risk Map" })).toBeVisible();
  await expect(page.getByText("Live Surveillance")).toBeVisible();
});

test("direct registry access remains protected and leads to sign-in", async ({ page }) => {
  await page.goto("/cases");

  await expect(page.getByRole("heading", { name: "Staff Sign-In Required" })).toBeVisible();
  await expect(page.getByText("The detailed case registry is restricted")).toBeVisible();

  await page.getByRole("link", { name: "Go to Sign In" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Secure staff access" })).toBeVisible();
});

test("admin route exposes only the protected sign-in gateway", async ({ page }) => {
  await page.goto("/admin");

  await expect(page.getByRole("heading", { name: "Secure staff access" })).toBeVisible();
  await expect(page.getByText("Sign in to your workspace")).toBeVisible();
  await expect(page.getByText("GeoHealth Insights Admin Console")).toHaveCount(0);
});

test("organization-user mode requests email and access code", async ({ page }) => {
  await page.goto("/admin");

  await page.getByLabel("Sign In Type").click();
  await page.getByRole("option", { name: "Organization user" }).click();

  const email = page.getByLabel("Email");
  const accessCode = page.getByLabel("User Access Code");
  const signIn = page.getByRole("button", { name: "Sign In" });

  await expect(email).toBeVisible();
  await expect(accessCode).toBeVisible();
  await expect(signIn).toBeDisabled();

  await email.fill("browser-test@example.org");
  await accessCode.fill("not-a-real-code");
  await expect(signIn).toBeEnabled();
});

test("non-admin users receive a focused staff workspace", async ({ page }) => {
  await page.goto("/admin");

  await page.getByLabel("Sign In Type").click();
  await page.getByRole("option", { name: "Organization user" }).click();
  await page.getByLabel("Email").fill("browser-test@example.org");
  await page.getByLabel("User Access Code").fill("not-a-real-code");
  await page.getByRole("button", { name: "Sign In" }).click();

  await expect(page.getByRole("heading", { name: "Staff Workspace" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Dashboard" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Cases" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign Out" })).toBeVisible();

  for (const restrictedPanel of [
    "GeoHealth Insights Admin Console",
    "Organization Users",
    "Organization Settings",
    "Audit Logs",
    "Production Readiness",
    "Backup & Recovery Readiness",
  ]) {
    await expect(page.getByText(restrictedPanel, { exact: true })).toHaveCount(0);
  }
});
