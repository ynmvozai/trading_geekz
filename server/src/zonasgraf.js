// v4.32 · Zonas que el servidor vigila, en el formato de la gráfica: { lo, hi, side, label }.
import { Z, isBroken } from "./zones.js";
import { idxZones } from "./sesionny.js";
import { vgZones } from "./vgquant.js";
import { mkOf } from "./chart.js";

export function zonesFor(mercado) {
  const mk = mkOf(mercado); if (!mk) return [];
  const out = [];
  if (["BTC", "SOL", "XAU"].includes(mk)) for (const z of Z.list) if (z.sym === mk && !isBroken(z)) out.push({ lo: Math.min(z.lo, z.hi), hi: Math.max(z.lo, z.hi), side: z.side, label: (z.name || "ZONA") + (z.grade ? " " + z.grade : "") });
  if (mk === "YM" || mk === "NQ") for (const z of idxZones()) if (z.sym === (mk === "YM" ? "US30" : "NQ")) out.push({ lo: z.lo, hi: z.hi, side: z.side, label: "PLAN NY " + (z.name || "") });
  if (["YM", "NQ", "BTC", "SOL", "XAU"].includes(mk)) out.push(...vgZones(mk));
  return out;
}
