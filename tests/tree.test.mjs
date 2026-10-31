import assert from "node:assert/strict";
import { test } from "node:test";
import { computeLayout, socialUrl } from "../public/js/tree.js";

test("generations and spouse grouping", () => {
  const people = [
    { id: "me", parentIds: ["dad", "mom"], spouseIds: ["wife"] },
    { id: "dad", parentIds: [], spouseIds: ["mom"] },
    { id: "mom", parentIds: [], spouseIds: ["dad"] },
    { id: "wife", parentIds: [], spouseIds: ["me"] },
    { id: "kid", parentIds: ["me", "wife"], spouseIds: [] },
    { id: "sis", parentIds: ["dad", "mom"], spouseIds: [] },
    { id: "grandpa", parentIds: [], spouseIds: [] },
  ];
  people[1].parentIds = ["grandpa"];
  const { level, rows } = computeLayout(people);
  assert.equal(level.get("grandpa"), 0);
  assert.equal(level.get("dad"), 1);
  assert.equal(level.get("mom"), 1);
  assert.equal(level.get("me"), 2);
  assert.equal(level.get("wife"), 2);
  assert.equal(level.get("kid"), 3);
  const row2 = rows[2];
  assert.equal(Math.abs(row2.indexOf("me") - row2.indexOf("wife")), 1);
});

test("cycles do not hang", () => {
  const { rows } = computeLayout([
    { id: "a", parentIds: ["b"], spouseIds: [] },
    { id: "b", parentIds: ["a"], spouseIds: [] },
  ]);
  assert.equal(rows.flat().length, 2);
});

test("social urls", () => {
  assert.equal(socialUrl("instagram", "@jane.doe"), "https://www.instagram.com/jane.doe");
  assert.equal(socialUrl("x", "https://x.com/jane"), "https://x.com/jane");
  assert.equal(socialUrl("facebook", "javascript:alert(1)"), null);
  assert.equal(socialUrl("tiktok", "bad handle<>"), null);
});
