import {test} from "node:test";
import assert from "node:assert/strict";
import {parseTitle} from "./parse-title.mjs";

const now = new Date(2026, 9, 5, 9, 0);

test("Italian weekday and time use the next Thursday", () => {
  const result = parseTitle("giovedì alle 11 taglio capelli con marco", now);
  assert.equal(result.title, "taglio capelli");
  assert.equal(result.person, "marco");
  assert.equal(result.start.toString().includes("Oct 08 2026"), true);
  assert.equal(result.start.getHours(), 11);
  assert.equal(result.end.getHours(), 12);
});

test("explicit date and duration", () => {
  const result = parseTitle("Revisione 8 ottobre 2026 dalle 11:30 alle 12:15", now);
  assert.equal(result.title, "Revisione");
  assert.equal(result.start.getMinutes(), 30);
  assert.equal(result.end.getMinutes(), 15);
});

test("relative day, selected day and ambiguous values", () => {
  assert.equal(parseTitle("Dentista domani alle 9", now).start.getDate(), 6);
  assert.equal(parseTitle("Dentista alle 9", now, new Date(2026, 9, 8)).start.getDate(), 8);
  assert.equal(parseTitle("venerdì 8 ottobre alle 11 taglio", now), null);
  assert.equal(parseTitle("riunione alle 25", now), null);
  assert.equal(parseTitle("riunione", now), null);
});

test("explicit years stay explicit and a leap day rolls only without year", () => {
  assert.equal(parseTitle("Anniversario 3 ottobre 2025 alle 10", now).start.getFullYear(), 2025);
  assert.equal(parseTitle("Anniversario 29 febbraio alle 10", now).start.getFullYear(), 2028);
  assert.equal(parseTitle("Anniversario 29 febbraio 2027 alle 10", now), null);
});

test("never silently schedule an already passed hour today", () => {
  assert.equal(parseTitle("Riunione oggi alle 8", now), null);
  assert.equal(parseTitle("Riunione domani alle 8", now).start.getDate(), 6);
});
