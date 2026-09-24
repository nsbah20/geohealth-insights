const appUrl = (process.env.SMOKE_APP_URL || process.argv[2] || "").replace(/\/$/, "");
const apiUrl = (process.env.SMOKE_API_URL || process.argv[3] || "").replace(/\/$/, "");

if (!appUrl || !apiUrl) {
  throw new Error(
    "Provide the staging URLs: npm run smoke:staging -- https://your-staging-app.example https://your-staging-api.example"
  );
}

async function fetchChecked(url, label, validate) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "follow" });
    const body = await response.text();
    if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}.`);
    validate(body);
    console.log(`${label} passed (${response.status}).`);
  } finally {
    clearTimeout(timeout);
  }
}

await fetchChecked(appUrl, "Staging web app", (body) => {
  if (!body.includes('<div id="root"></div>')) {
    throw new Error("Staging web response is missing the React root element.");
  }
});

for (const [path, expectedStatus, label] of [
  ["/api/health/live", "live", "Staging API liveness"],
  ["/api/health/ready", "ready", "Staging API readiness"],
]) {
  await fetchChecked(`${apiUrl}${path}`, label, (body) => {
    const payload = JSON.parse(body);
    if (payload.status !== expectedStatus) {
      throw new Error(`Unexpected ${label.toLowerCase()} status: ${payload.status}`);
    }
    if (payload.environment !== "staging") {
      throw new Error(`Expected staging environment, received: ${payload.environment || "unreported"}`);
    }
  });
}

console.log("Staging isolation smoke test passed.");
