import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildRoot = path.join(clientRoot, "build");
const manifestPath = path.join(buildRoot, ".vite", "manifest.json");

async function requireFile(filePath) {
  await access(filePath);
  const details = await stat(filePath);
  if (!details.isFile() || details.size === 0) {
    throw new Error(`Expected a non-empty build file: ${path.relative(clientRoot, filePath)}`);
  }
}

await requireFile(path.join(buildRoot, "index.html"));
await requireFile(manifestPath);

const indexHtml = await readFile(path.join(buildRoot, "index.html"), "utf8");
if (!indexHtml.includes('type="module"')) {
  throw new Error("Production index.html does not contain a module entry script.");
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const chunks = Object.values(manifest);
const requiredSources = ["src/AdminConsole.jsx", "src/CasesTable.jsx"];

for (const source of requiredSources) {
  const chunk = chunks.find((item) => item.src === source);
  if (!chunk?.isDynamicEntry) {
    throw new Error(`${source} was not emitted as a lazy production chunk.`);
  }
}

const emittedFiles = new Set();
for (const chunk of chunks) {
  if (chunk.file) emittedFiles.add(chunk.file);
  for (const cssFile of chunk.css || []) emittedFiles.add(cssFile);
  for (const assetFile of chunk.assets || []) emittedFiles.add(assetFile);
}

for (const file of emittedFiles) {
  await requireFile(path.join(buildRoot, file));
}

console.log(`Build smoke test passed: ${chunks.length} manifest entries and ${emittedFiles.size} emitted files verified.`);
