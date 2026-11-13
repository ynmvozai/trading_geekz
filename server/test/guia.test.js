// v4.41 · La guía de los libros se añade al final y el prompt de Yasser no cambia.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { AI_PROMPT } from "../src/prompts.js";
import { GUIA_LIBROS } from "../src/guia.js";

test("AI_PROMPT de Yasser sigue idéntico (no se toca)", () => {
  assert.equal(createHash("sha256").update(AI_PROMPT).digest("hex"), "958c8c47d1f498b578c7daa7dea652825ebdd96f69f8d13ac9fa2b9444ce3499");
});
test("la guía va después del prompt, no da gatillos y cabe sin problema", () => {
  assert.ok(GUIA_LIBROS.startsWith("\n\n# GUÍA DE APOYO"));
  assert.ok(GUIA_LIBROS.length < 2600);
  assert.ok(/nunca lo sustituye/.test(GUIA_LIBROS) && /sin dar gatillos/.test(GUIA_LIBROS));
  assert.ok(!/\bAI\b|\bIA\b/.test(GUIA_LIBROS));
  assert.ok(readFileSync(new URL("../src/tito.js", import.meta.url), "utf8").includes("system: AI_PROMPT + SENT_NOTE + GUIA_LIBROS"));
});
