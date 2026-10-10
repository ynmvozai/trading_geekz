// Base de datos SQLite (node:sqlite, sin dependencias nativas). En Railway vive en el volumen /data.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ENV } from "./config.js";

let db;

export function openStore(file) {
  const f = file || path.join(ENV.dataDir, "hotzone.db");
  if (f !== ":memory:") fs.mkdirSync(path.dirname(f), { recursive: true });
  db = new DatabaseSync(f);
  db.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
    CREATE TABLE IF NOT EXISTS feed (t INTEGER, sym TEXT, side TEXT, usd REAL, price REAL, zn TEXT, alert TEXT);
    CREATE INDEX IF NOT EXISTS feed_t ON feed(t);
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      t INTEGER, sym TEXT, kind TEXT, zone_name TEXT, grade TEXT, side TEXT, order_side TEXT,
      entry REAL, prox REAL, usd REAL, sl REAL, tp1 REAL, tp2 REAL, zkey TEXT,
      track INTEGER, status TEXT, tp1_t INTEGER, end_t INTEGER, r REAL);
    CREATE INDEX IF NOT EXISTS alerts_status ON alerts(status);
  `);
  // v3.1: sentimiento (Fear & Greed) al momento de la alerta
  for (const c of ["fg INTEGER", "fg_read TEXT"]) { try { db.exec("ALTER TABLE alerts ADD COLUMN " + c); } catch {} }
  return db;
}

export function kvGet(k, def = null) {
  const row = db.prepare("SELECT v FROM kv WHERE k=?").get(k);
  if (!row) return def;
  try { return JSON.parse(row.v); } catch { return def; }
}
export function kvSet(k, v) {
  db.prepare("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(k, JSON.stringify(v));
}

export function feedInsert(o) {
  db.prepare("INSERT INTO feed(t,sym,side,usd,price,zn,alert) VALUES(?,?,?,?,?,?,?)").run(o.t, o.sym, o.side, o.usd, o.price, o.zn || "", o.alert || "");
}
export function feedSetAlert(o) {
  db.prepare("UPDATE feed SET alert=? WHERE t=? AND sym=? AND side=?").run(o.alert || "", o.t, o.sym, o.side);
}
export function feedLoad(since) {
  return db.prepare("SELECT * FROM feed WHERE t>=? ORDER BY t DESC LIMIT 6000").all(since);
}
export function feedPrune(before) {
  db.prepare("DELETE FROM feed WHERE t<?").run(before);
}

export function alertInsert(a) {
  const r = db.prepare(`INSERT INTO alerts(t,sym,kind,zone_name,grade,side,order_side,entry,prox,usd,sl,tp1,tp2,zkey,track,status,fg,fg_read)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(a.t, a.sym, a.kind, a.zone_name, a.grade || "", a.side, a.order_side || "",
    a.entry, a.prox ?? null, a.usd ?? null, a.sl || 0, a.tp1 || 0, a.tp2 || 0, a.zkey, a.track ? 1 : 0, a.status, a.fg ?? null, a.fg_read || null);
  return Number(r.lastInsertRowid);
}
export function alertsOpen() {
  return db.prepare("SELECT * FROM alerts WHERE track=1 AND status IN ('abierta','tp1')").all();
}
export function alertUpdate(id, f) {
  db.prepare("UPDATE alerts SET status=?, tp1_t=?, end_t=?, r=? WHERE id=?").run(f.status, f.tp1_t ?? null, f.end_t ?? null, f.r ?? null, id);
}
export function alertsSince(since) {
  return db.prepare("SELECT * FROM alerts WHERE t>=? ORDER BY t DESC").all(since);
}
export function lastAlert() {
  return db.prepare("SELECT * FROM alerts ORDER BY t DESC LIMIT 1").get();
}
