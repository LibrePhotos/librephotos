import { describe, expect, it } from "vitest";
import { z } from "zod";
import { email, newName, optionalEmail, uniqueName, withMatchingPasswords, withNewPassword } from "./formSchemas";

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

describe("uniqueName", () => {
  const schema = uniqueName(["Alice", " Bob "], "taken");

  it("rejects a taken name, trimmed and in any case", () => {
    expect(messages(schema.safeParse("alice"))).toEqual(["taken"]);
    expect(messages(schema.safeParse("  ALICE "))).toEqual(["taken"]);
    expect(messages(schema.safeParse("bob"))).toEqual(["taken"]);
  });

  it("accepts a new name", () => {
    expect(schema.safeParse("Alicia").success).toBe(true);
  });

  it("builds the message from the trimmed name it refuses", () => {
    const named = uniqueName(["Alice"], name => `${name} is taken`);

    expect(messages(named.safeParse("  ALICE "))).toEqual(["ALICE is taken"]);
  });
});

describe("newName", () => {
  const schema = newName(["Alice"], { blank: "blank", taken: name => `${name} taken` });

  it("refuses a blank name, and only says so", () => {
    expect(messages(schema.safeParse("   "))).toEqual(["blank"]);
  });

  it("refuses a taken name", () => {
    expect(messages(schema.safeParse(" alice "))).toEqual(["alice taken"]);
  });

  it("hands a new name on trimmed", () => {
    expect(schema.parse("  Alicia ")).toBe("Alicia");
  });
});

describe("withMatchingPasswords", () => {
  const schema = withMatchingPasswords(
    z.object({ email: email("invalid"), password: z.string(), passwordConfirm: z.string() }),
    "must match"
  );

  it("puts a mismatch on passwordConfirm, next to the other fields' errors", () => {
    const result = schema.safeParse({ email: "a@", password: "one", passwordConfirm: "two" });

    expect(result.error?.issues.map(issue => [issue.path.join("."), issue.message])).toEqual([
      ["email", "invalid"],
      ["passwordConfirm", "must match"],
    ]);
  });

  it("accepts the same password twice", () => {
    expect(schema.safeParse({ email: "a@b.co", password: "one", passwordConfirm: "one" }).success).toBe(true);
  });
});

describe("withNewPassword", () => {
  const schema = (required = false) =>
    withNewPassword(
      z.object({
        email: email("invalid"),
        password: z.string(),
        passwordConfirm: z.string(),
        changePassword: z.boolean(),
      }),
      { blank: "blank", retype: "retype", mismatch: "mismatch" },
      { required }
    );
  const errors = (result: z.ZodSafeParseResult<unknown>) =>
    result.error?.issues.map(issue => [issue.path.join("."), issue.message]) ?? [];
  const values = (password: string, passwordConfirm: string, changePassword = true) => ({
    email: "a@b.co",
    password,
    passwordConfirm,
    changePassword,
  });

  it("does not check locked fields", () => {
    expect(schema().safeParse(values("", "", false)).success).toBe(true);
  });

  it("wants a password while the fields are unlocked, or one is required", () => {
    expect(errors(schema().safeParse(values("", "")))).toEqual([["password", "blank"]]);
    expect(errors(schema(true).safeParse(values("", "", false)))).toEqual([["password", "blank"]]);
  });

  it("wants the password typed twice, alike", () => {
    expect(errors(schema().safeParse(values("one", "")))).toEqual([["passwordConfirm", "retype"]]);
    expect(errors(schema().safeParse(values("one", "two")))).toEqual([["passwordConfirm", "mismatch"]]);
    expect(errors(schema().safeParse(values("", "two")))).toEqual([["passwordConfirm", "mismatch"]]);
    expect(schema().safeParse(values("one", "one")).success).toBe(true);
  });

  it("reports the password next to the other fields' errors", () => {
    expect(errors(schema().safeParse({ ...values("one", "two"), email: "a@" }))).toEqual([
      ["email", "invalid"],
      ["passwordConfirm", "mismatch"],
    ]);
  });
});
