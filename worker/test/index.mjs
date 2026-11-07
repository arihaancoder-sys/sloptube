// Lets `node --test tests/` run the whole folder on Node 22, which treats a
// directory argument as a module to load. Imports every *.test.mjs file here.
import { readdirSync } from "node:fs";

const dir = new URL("./", import.meta.url);
for (const file of readdirSync(dir).filter((f) => f.endsWith(".test.mjs")).sort()) {
  await import(new URL(file, dir).href);
}
