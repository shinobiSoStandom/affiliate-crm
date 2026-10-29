import { readFile, writeFile, mkdir, rm, cp } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const files = ["worker/api.js", "worker/ui.js", "worker/index.js"];
const parts = [];
for (const file of files) {
  let source = await readFile(resolve(root, file), "utf8");
  source = source.replace(/^import .* from ["']\.\/(?:api|ui)\.js["'];?\s*$/gm, "");
  source = source.replace(/^export (?=(?:async )?function |const |let |class )/gm, "");
  parts.push("// " + file + "\n" + source);
}
await rm(resolve(root, "dist"), { recursive: true, force: true });
await mkdir(resolve(root, "dist/server"), { recursive: true });
await mkdir(resolve(root, "dist/.openai"), { recursive: true });
await writeFile(resolve(root, "dist/server/index.js"), parts.join("\n\n"));
await cp(resolve(root, ".openai/hosting.json"), resolve(root, "dist/.openai/hosting.json"));
await cp(resolve(root, "drizzle"), resolve(root, "dist/.openai/drizzle"), { recursive: true });
console.log("Built dependency-free Affiliate CRM Worker with D1 migrations.");
