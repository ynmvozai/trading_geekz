// Copia AI_PROMPT, ZONES_Q, el inicio de DAILY_Q e INDEX_MAP del panel v2.4 (index.html) sin cambios.
import fs from "node:fs";
import vm from "node:vm";
const html = fs.readFileSync(new URL("../../index.html", import.meta.url), "utf8");
const grab = (re) => { const m = re.exec(html); if (!m) throw new Error("no encontré " + re); return m[1]; };
const ctx = {};
vm.runInNewContext(
  "var ZONES_Q=" + grab(/var ZONES_Q=("(?:[^"\\]|\\.)*");/) + ";" +
  "var AI_PROMPT=" + grab(/var AI_PROMPT=("(?:[^"\\]|\\.)*");/) + ";" +
  "var INDEX_MAP=" + grab(/var INDEX_MAP=(\[.*?\]);\n/) + ";" +
  "var DAILY_HEAD=" + grab(/var DAILY_Q=("(?:[^"\\]|\\.)*")\+ZONES_Q;/) + ";", ctx);
const out = `// Generado por scripts/extract-prompts.mjs desde index.html (panel v2.4). No editar a mano.
export const AI_PROMPT = ${JSON.stringify(ctx.AI_PROMPT)};
export const ZONES_Q = ${JSON.stringify(ctx.ZONES_Q)};
export const DAILY_Q = ${JSON.stringify(ctx.DAILY_HEAD)} + ZONES_Q;
export const INDEX_MAP = ${JSON.stringify(ctx.INDEX_MAP, null, 1)};
`;
fs.writeFileSync(new URL("../src/prompts.js", import.meta.url), out);
console.log("prompts.js:", out.length, "bytes; AI_PROMPT", ctx.AI_PROMPT.length, "chars");
