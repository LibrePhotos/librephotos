import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { email, optionalEmail } from "./formSchemas";

const messages = (result: z.ZodSafeParseResult<unknown>) => result.error?.issues.map(issue => issue.message) ?? [];

describe("email", () => {
  const schema = email("invalid");

  // #695: the hand-written pattern refused the first three (upper-case TLD, one-letter label,
  // two hyphens in a label), so those users could not sign up or reset their password.
  it.each([
    "John@Example.COM",
    "a@b.co",
    "x@my-long-domain.example.org",
    "email@domain.com",
    "first.last@domain.com",
    "email@subdomain.name.com",
    "firstname+lastname@domain.com",
    "first.name+last.name@domain.com",
    "first-name+last-name@domain.com",
    "first.name+last-name@domain.com",
    "first-name+last.name@domain.com",
    "first-namelast.name@domain.com",
    "first.namelast-name@domain.com",
    "email@domain-one.com",
    "email@domain.name",
    "email@example.domain.name",
    "firstname-lastname@example.com",
    "1234567890@domain.com",
    "_______@example.com",
    "valid.name@aa.bb.cc.dd.ee.ff.gg.hh.jj.com",
    // Ten domain labels: the old pattern's limit of nine was an artefact of how it was written.
    "valid.name@aa.bb.cc.dd.ee.ff.gg.hh.jj.ii.com",
    "a@bcd.ef",
    "first.m.last@domain.com",
  ])("accepts %s", address => {
    expect(schema.safeParse(address).success).toBe(true);
  });

  it.each([
    "a@",
    "@b.co",
    "a b@c.de",
    "",
    " a@b.co",
    "email@123.123.123.123",
    "email@[123.123.123.123]",
    "much.“more unusual”@example.com",
    "very.unusual.“@”.unusual.com@example.com",
    'very.“(),:;<>[]”.VERY.“very@\\ "very”.unusual@strange.example.com',
    "“email”@example.com",
    "plainaddress",
    "#@%^%#$@#$@#.com",
    "@example.com",
    "Joe Smith <email@example.com>",
    "email.example.com",
    "email@example@example.com",
    ".email@example.com",
    "email.@example.com",
    "email..email@example.com",
    "あいうえお@example.com",
    "email@example.com (Joe Smith)",
    "email@example",
    "email@-example.com",
    "email@111.222.333.44444",
    "email@example..com",
    "Abc..123@example.com",
    "“(),:;<>[]@example.com",
    'just"not"right@example.com',
    'this is"really"notallowed@example.com',
  ])("rejects %s with the form's message", address => {
    expect(messages(schema.safeParse(address))).toEqual(["invalid"]);
  });
});

describe("optionalEmail", () => {
  const schema = optionalEmail("invalid");

  it("accepts nothing or an address", () => {
    expect(schema.safeParse("").success).toBe(true);
    expect(schema.safeParse("a@b.co").success).toBe(true);
  });

  it("rejects anything else with the form's message", () => {
    expect(messages(schema.safeParse("a@"))).toEqual(["invalid"]);
  });
});
