const appUrl = (process.env.SMOKE_APP_URL || process.argv[2] || "").replace(/\/$/, "");
const apiUrl = (process.env.SMOKE_API_URL || process.argv[3] || "").replace(/\/$/, "");

if (!appUrl || !apiUrl) {
  throw new Error(
    "Provide the deployed URLs: npm run smoke:production -- https://your-app.example https://your-api.example"
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

await fetchChecked(appUrl, "Web app", (body) => {
  if (!body.includes('<div id="root"></div>')) {
    throw new Error("Web app response is missing the React root element.");
  }
});

await fetchChecked(`${apiUrl}/api/health/live`, "API liveness", (body) => {
  const payload = JSON.parse(body);
  if (payload.status !== "live") throw new Error(`Unexpected liveness status: ${payload.status}`);
});

await fetchChecked(`${apiUrl}/api/health/ready`, "API readiness", (body) => {
  const payload = JSON.parse(body);
  if (payload.status !== "ready") throw new Error(`Unexpected readiness status: ${payload.status}`);
});

console.log("Production smoke test passed.");
