import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accountErrorText,
  ageOn,
  avatarFileProblem,
  birthdateProblem,
  parseDate,
} from "../lib/accounts/validation.ts";

const on = { year: 2026, month: 11, day: 4 };

test("13th birthday today is allowed, one day short is not", () => {
  assert.equal(birthdateProblem("2013-11-04", on), null);
  assert.equal(birthdateProblem("2013-11-05", on), "too_young");
});

test("adults pass, children are refused", () => {
  assert.equal(birthdateProblem("1990-06-15", on), null);
  assert.equal(birthdateProblem("2020-01-01", on), "too_young");
});

test("a birthdate is required and must be a real, past date", () => {
  assert.equal(birthdateProblem("", on), "birthdate_required");
  assert.equal(birthdateProblem("2001-02-30", on), "invalid_birthdate");
  assert.equal(birthdateProblem("15/06/1990", on), "invalid_birthdate");
  assert.equal(birthdateProblem("1850-01-01", on), "invalid_birthdate");
  assert.equal(birthdateProblem("2030-01-01", on), "invalid_birthdate");
});

test("ages count whole years, leap day birthdays turn on 1 March", () => {
  const leap = parseDate("2012-02-29");
  assert.equal(ageOn(leap, { year: 2025, month: 2, day: 28 }), 12);
  assert.equal(ageOn(leap, { year: 2025, month: 3, day: 1 }), 13);
});

test("the too_young error has a friendly message", () => {
  assert.match(accountErrorText("too_young"), /13 or older/);
});

test("avatar files: PNG, JPG or WebP up to 2 MB", () => {
  assert.equal(avatarFileProblem({ type: "image/png", size: 1000 }), null);
  assert.match(avatarFileProblem({ type: "image/gif", size: 1000 }), /PNG, JPG or WebP/);
  assert.match(avatarFileProblem({ type: "image/jpeg", size: 3 * 1024 * 1024 }), /2 MB/);
});
