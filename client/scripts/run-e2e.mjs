import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const viteCli = path.join(clientRoot, "node_modules", "vite", "bin", "vite.js");
const playwrightCli = path.join(clientRoot, "node_modules", "@playwright", "test", "cli.js");
const baseUrl = "http://127.0.0.1:4173";

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: clientRoot,
      stdio: "inherit",
      windowsHide: true,
      ...options,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function waitForServer(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The preview process may still be binding its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Vite preview did not become ready at ${url}.`);
}

const build = await run(process.execPath, [viteCli, "build"]);
if (build.code !== 0) process.exit(build.code || 1);

const preview = spawn(process.execPath, [viteCli, "preview", "--host", "127.0.0.1"], {
  cwd: clientRoot,
  stdio: "inherit",
  windowsHide: true,
});

const stopPreview = () => {
  if (!preview.killed) preview.kill("SIGTERM");
};

process.once("SIGINT", stopPreview);
process.once("SIGTERM", stopPreview);

try {
  await waitForServer(baseUrl);
  const tests = await run(process.execPath, [playwrightCli, "test", ...process.argv.slice(2)], {
    env: { ...process.env, PLAYWRIGHT_BASE_URL: baseUrl },
  });
  process.exitCode = tests.code || (tests.signal ? 1 : 0);
} finally {
  stopPreview();
}
