/**
 * The zod schemas against the OpenAPI schema the backend generates
 * (apps/backend/openapi.json, kept current by test-backend.yml). See
 * openapi-contract.ts for what counts as a difference and contract-map.ts for
 * which schema is compared with which component.
 *
 * contract-baseline.json lists the differences that are accepted, each with
 * its reason. It only shrinks: a difference that is not listed fails (fix the
 * zod schema or the serializer), and so does a listed one that is gone (delete
 * the entry).
 */
import { readFileSync } from "node:fs";
import { z } from "zod";
import * as S from "../schemas";
import baselineJson from "./contract-baseline.json";
import { CONTRACT_MAP, UNMAPPED } from "./contract-map";
import { compareShapes, contractDifferences, OpenApiDocument, toShape, zodToNode } from "./openapi-contract";

const document = OpenApiDocument.parse(
  JSON.parse(readFileSync(new URL("../../../../apps/backend/openapi.json", import.meta.url), "utf8"))
);
const baseline = z.record(z.string(), z.string().min(1)).parse(baselineJson);

describe("zod schemas against apps/backend/openapi.json", () => {
  const { differences, unknownComponents } = contractDifferences(document, CONTRACT_MAP);

  it("maps only components that exist", () => {
    expect(unknownComponents).toEqual([]);
  });

  it("has no difference that is not in contract-baseline.json", () => {
    const fresh = differences.filter(difference => !(difference.key in baseline));
    expect(fresh.map(difference => `${difference.key} (${difference.detail})`)).toEqual([]);
  });

  it("has no contract-baseline.json entry that no longer differs", () => {
    const current = new Set(differences.map(difference => difference.key));
    expect(Object.keys(baseline).filter(key => !current.has(key))).toEqual([]);
  });

  it("maps every exported zod object or says why not", () => {
    const objects = Object.entries(S)
      .filter(([, value]) => value instanceof z.ZodObject)
      .map(([name]) => name);
    const unlisted = objects.filter(name => !(name in CONTRACT_MAP) && !(name in UNMAPPED));
    expect(unlisted).toEqual([]);
    const both = Object.keys(UNMAPPED).filter(name => name in CONTRACT_MAP);
    expect(both).toEqual([]);
    const gone = [...Object.keys(CONTRACT_MAP), ...Object.keys(UNMAPPED)].filter(name => !objects.includes(name));
    expect(gone).toEqual([]);
  });
});

describe("the comparison itself", () => {
  const components = {
    Item: {
      type: "object",
      properties: {
        id: { type: "integer" },
        title: { type: "string" },
        note: { type: "string", nullable: true },
        thumb: { type: "string" },
        size: { type: "integer" },
        owner: { $ref: "#/components/schemas/Owner" },
      },
      required: ["id", "note", "thumb", "size", "owner"],
    },
    Owner: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
  };
  const server = toShape({ $ref: "#/components/schemas/Item" }, components);
  const keys = (schema: z.ZodType) =>
    compareShapes("T/Item", { ...toShape(zodToNode(schema, new Map()), {}), zodName: undefined }, server, () => false)
      .map(difference => difference.key)
      .sort();
  const matching = z.object({
    id: z.number(),
    title: z.string().optional(),
    note: z.string().nullable(),
    thumb: z.string(),
    // Optional where the server always sends it: allowed (older servers).
    size: z.number().optional(),
    owner: z.object({ name: z.string() }),
  });

  it("accepts a matching schema", () => {
    expect(keys(matching)).toEqual([]);
  });

  it("fails a field zod requires that the schema marks optional", () => {
    expect(keys(matching.extend({ title: z.string() }))).toEqual(["T/Item title: required-in-zod"]);
  });

  it("fails nullability in either direction", () => {
    expect(keys(matching.extend({ note: z.string(), thumb: z.string().nullable() }))).toEqual([
      "T/Item note: null-in-schema-only",
      "T/Item thumb: null-in-zod-only",
    ]);
  });

  it("fails missing fields, extra fields and type changes, nested ones included", () => {
    expect(
      keys(
        matching
          .omit({ thumb: true })
          .extend({ extra: z.string().optional(), size: z.string(), owner: z.object({ name: z.number() }) })
      )
    ).toEqual([
      "T/Item extra: missing-in-schema",
      "T/Item owner.name: type",
      "T/Item size: type",
      "T/Item thumb: missing-in-zod",
    ]);
  });

  describe("keys sent as strings (issue #389)", () => {
    const keyComponents = {
      Keys: {
        type: "object",
        properties: {
          id: { type: "string" },
          album: { type: "string" },
          title: { type: "string" },
          count: { type: "integer" },
          photo: { type: "object", properties: { id: { type: "string", format: "uuid" } }, required: ["id"] },
        },
        required: ["id", "album", "title", "count", "photo"],
      },
    };
    const keyServer = toShape({ $ref: "#/components/schemas/Keys" }, keyComponents);
    const keyDifferences = (schema: z.ZodType) =>
      compareShapes(
        "T/Keys",
        { ...toShape(zodToNode(schema, new Map()), {}), zodName: undefined },
        keyServer,
        () => false
      )
        .map(difference => difference.key)
        .sort();

    it("compares IntegerId as a number, and flags every key the server sends as a string", () => {
      const schema = z.object({
        id: S.IntegerId,
        album: S.IntegerId,
        title: z.string(),
        count: S.IntegerId.nullable(),
        photo: z.object({ id: z.string() }),
      });
      expect(keyDifferences(schema)).toEqual([
        "T/Keys album: string-id",
        "T/Keys count: null-in-zod-only",
        "T/Keys id: string-id",
      ]);
    });

    it("flags a non-UUID string id even when zod reads it as a string", () => {
      const schema = z.object({
        id: z.string(),
        album: z.string(),
        title: z.string(),
        count: z.number(),
        photo: z.object({ id: z.string() }),
      });
      expect(keyDifferences(schema)).toEqual(["T/Keys id: string-id"]);
    });
  });
});
