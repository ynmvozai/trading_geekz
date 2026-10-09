// Revisión anti-estafa de tokens (datos reales de DexScreener + RugCheck). Portado del panel v2.4.
function fmtUsd(n) { if (n == null || isNaN(n)) return "—"; n = +n; return n >= 1e9 ? "$" + (n / 1e9).toFixed(2) + "B" : n >= 1e6 ? "$" + (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? "$" + (n / 1e3).toFixed(1) + "K" : "$" + n.toFixed(2); }

export async function tokenCheck(addr) {
  const r0 = await fetch("https://api.dexscreener.com/latest/dex/tokens/" + addr, { signal: AbortSignal.timeout(15000) });
  if (!r0.ok) throw new Error("DexScreener HTTP " + r0.status);
  const j = await r0.json();
  let ps = (j.pairs || []).filter((p) => p && p.baseToken && p.baseToken.address && p.baseToken.address.toLowerCase() === addr.toLowerCase());
  if (!ps.length) ps = j.pairs || [];
  if (!ps.length) return "🔎 **Revisión de token**\nNo encontré ese token en ningún DEX (DexScreener). 🚩 Un token sin mercado real o con dirección equivocada es la señal de alerta número uno: verifica la dirección en el sitio oficial del proyecto.";
  ps.sort((a, b) => ((b.liquidity && b.liquidity.usd) || 0) - ((a.liquidity && a.liquidity.usd) || 0));
  const p = ps[0], liq = (p.liquidity && p.liquidity.usd) || 0, mc = p.marketCap || p.fdv || 0, vol = (p.volume && p.volume.h24) || 0,
    tx = (p.txns && p.txns.h24) || { buys: 0, sells: 0 }, ageD = p.pairCreatedAt ? (Date.now() - p.pairCreatedAt) / 864e5 : null,
    info = p.info || {}, hasSite = (info.websites || []).length > 0, hasSoc = (info.socials || []).length > 0, flags = [], warn = [];
  if (ageD != null && ageD < 7) flags.push("Muy nuevo: " + ageD.toFixed(1) + " días de mercado"); else if (ageD != null && ageD < 30) warn.push("Joven: " + Math.round(ageD) + " días de mercado");
  if (liq < 50000) flags.push("Liquidez baja: " + fmtUsd(liq) + " (fácil de manipular o de retirar = rug pull)");
  if (mc > 0 && liq / mc < 0.02) flags.push("Liquidez muy pequeña frente al valor de mercado (" + (liq / mc * 100).toFixed(2) + "%)");
  if (liq > 0 && vol > liq * 5) warn.push("Volumen 24h " + (vol / liq).toFixed(1) + "x la liquidez: posible volumen inflado");
  if (tx.buys > 20 && tx.sells < tx.buys * 0.1) flags.push("Casi nadie vende (" + tx.sells + " ventas vs " + tx.buys + " compras): posible honeypot");
  if (!hasSite && !hasSoc) warn.push("Sin sitio web ni redes registradas");
  let head = "🔎 **Revisión de token · " + (p.baseToken.name || "") + " (" + (p.baseToken.symbol || "") + ")**\nRed: " + p.chainId + " · DEX: " + p.dexId +
    "\nPrecio " + (p.priceUsd ? "$" + p.priceUsd : "—") + " · Valor de mercado " + fmtUsd(mc) + " · Liquidez " + fmtUsd(liq) +
    "\nVolumen 24h " + fmtUsd(vol) + " · Compras/ventas 24h " + tx.buys + "/" + tx.sells + (ageD != null ? " · Edad " + (ageD < 1 ? (ageD * 24).toFixed(1) + " h" : Math.round(ageD) + " días") : "") +
    "\nSitio: " + (hasSite ? "sí" : "no") + " · Redes: " + (hasSoc ? "sí" : "no");
  const r = p.chainId === "solana"
    ? await fetch("https://api.rugcheck.xyz/v1/tokens/" + addr + "/report/summary", { signal: AbortSignal.timeout(15000) }).then((x) => (x.ok ? x.json() : null)).catch(() => null)
    : null;
  if (r) {
    const risks = (r.risks || []).map((x) => x.name + (x.level ? " (" + x.level + ")" : ""));
    head += "\nRugCheck: puntaje " + (r.score_normalised != null ? r.score_normalised : r.score) + (risks.length ? " · riesgos: " + risks.slice(0, 5).join(", ") : " · sin riesgos marcados");
    if ((r.risks || []).some((x) => /danger/i.test(x.level || ""))) flags.push("RugCheck marca riesgos de nivel peligro");
  }
  const v = flags.length >= 2 ? "🔴 **ALTO RIESGO**" : flags.length === 1 ? "🟠 **PRECAUCIÓN**" : warn.length ? "🟡 **Revisar con cuidado**" : "🟢 **Sin banderas rojas evidentes**";
  return head + "\n\n" + v + (flags.length ? "\n" + flags.map((f) => "🚩 " + f).join("\n") : "") + (warn.length ? "\n" + warn.map((f) => "⚠️ " + f).join("\n") : "") +
    "\n\nRevisa también: equipo público, auditoría (CertiK, Quantstamp) y la dirección oficial en el sitio del proyecto. Nunca compartas tu frase semilla.\nDatos en vivo de DexScreener" + (r ? " y RugCheck" : "") + ". La decisión final siempre es tuya.";
}
