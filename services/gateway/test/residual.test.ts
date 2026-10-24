/** The residual check on its own (privacy/residual.ts). */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_RESIDUAL, parseResidualChecks, residualHits, residualMessage, type ResidualPolicy } from "../src/privacy/residual.ts";

const kinds = (text: string, p: ResidualPolicy = DEFAULT_RESIDUAL) => residualHits([text], p).map((h) => h.kind);

describe("residualHits", () => {
  it("finds identifier shapes detection can miss", () => {
    assert.deepEqual(kinds("acct 991200345678"), ["digits"]);
    assert.deepEqual(kinds("Account 06-0193-0921569-00"), ["digits"]);
    assert.deepEqual(kinds("Aadhaar 2345 6789 0123"), ["spaced_digits"]);
    assert.deepEqual(kinds("card 4111 1111 1111 1111"), ["spaced_digits"]);
    assert.deepEqual(kinds("call +91 98201 44907"), ["spaced_digits", "intl_phone"]);
    assert.deepEqual(kinds("write to a.b@c.example"), ["email"]);
    assert.deepEqual(kinds("MR TL ZENGENI & MRS L DANGA"), ["titled_name"]);
    assert.deepEqual(kinds("Dr. Grant"), ["titled_name"]);
  });

  it("ignores placeholders, card removals, ISO dates and times, amounts and short numbers", () => {
    for (const t of [
      "MR <PERSON_1> & MRS <C_PERSON_2>, a/c <BANK_ACCOUNT_1>, card [CARD REMOVED]",
      "2024-01-05T12:30:00Z and 2024-01-05 12:30",
      "paid 1,250.00 and 1234567.89 on 05/01/2024, ref 7781, id 12345678",
      "totals 100 200 300",
      "Use MS Excel or MS Word",
    ]) assert.deepEqual(kinds(t), [], t);
  });

  it("does not join a title at a line's end to the next line once a placeholder is removed", () => {
    const note = "Patient Name: <C_PERSON_1>\nMRN <C_MEDICAL_RECORD_1>\nAadhaar <C_IN_AADHAAR_1>\nAttending: Dr. <C_PERSON_2>\n\nDiagnosis: type 2 diabetes, newly started on insulin.";
    assert.deepEqual(kinds(note), [], "the masked discharge note is not refused");
    assert.deepEqual(kinds("Dr. <PERSON_1>\nDischarge medicines:"), []);
    // Still refused: a name on the same line as the title.
    assert.deepEqual(kinds("Dr. <C_PERSON_1> Grant"), ["titled_name"], "a surname left after a removed first name");
    assert.deepEqual(kinds("Dr.\tGrant"), ["titled_name"]);
  });

  it("counts per kind across texts and never returns values", () => {
    const hits = residualHits(["acct 991200345678", "acct 991200345679 and a@b.example"], DEFAULT_RESIDUAL);
    assert.deepEqual(hits, [{ kind: "digits", count: 2 }, { kind: "email", count: 1 }]);
    assert.ok(!JSON.stringify(hits).includes("9912"));
    assert.ok(!residualMessage(hits).includes("9912"));
  });

  it("follows the policy: off, a subset of checks, a digit minimum", () => {
    assert.deepEqual(kinds("acct 991200345678", { ...DEFAULT_RESIDUAL, enabled: false }), []);
    assert.deepEqual(kinds("acct 991200345678 a@b.example", { ...DEFAULT_RESIDUAL, checks: ["email"] }), ["email"]);
    assert.deepEqual(kinds("id 12345678", { ...DEFAULT_RESIDUAL, minDigits: 8 }), ["digits"]);
  });
});

describe("parseResidualChecks", () => {
  it("accepts all or a list, and refuses unknown or empty lists", () => {
    assert.deepEqual(parseResidualChecks("all"), [...DEFAULT_RESIDUAL.checks]);
    assert.deepEqual(parseResidualChecks("digits, email"), ["digits", "email"]);
    assert.throws(() => parseResidualChecks("phone"), /unknown check phone/);
    assert.throws(() => parseResidualChecks(" , "), /at least one/);
  });
});
