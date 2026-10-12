/**
 * Compares a zod schema with an OpenAPI component of apps/backend/openapi.json.
 *
 * Both sides become JSON Schema (zod 4's `z.toJSONSchema`, input side: what the
 * schema accepts when it parses a response) and then a small `Shape` per node:
 * the JSON types, whether null is allowed, the properties with their required
 * flag, and the array items. Shapes are compared field by field, nested objects
 * and array items included. A difference is one of:
 *
 * - `missing-in-zod`: the server sends the field, zod drops it (a
 *   `z.looseObject` keeps unknown keys, so it is not reported there).
 * - `missing-in-schema`: zod reads a field the server does not describe.
 * - `required-in-zod`: zod requires a field the server may leave out.
 * - `null-in-schema-only`: the server may send null, zod rejects it.
 * - `null-in-zod-only`: zod accepts a null the server never sends (a client's
 *   null check that never fires, e.g. "" sent for "no thumbnail").
 * - `type`: the JSON types differ (string vs number, one type vs a union).
 *
 * zod marking a field optional that the server always sends is not reported:
 * that is how the clients stay compatible with older servers. A side without a
 * type (`z.unknown()`, an untyped `JSONField` or method field) is not compared.
 */
import { z } from "zod";

export interface SchemaNode {
  type?: string | string[];
  nullable?: boolean;
  enum?: unknown[];
  const?: unknown;
  properties?: Record<string, SchemaNode>;
  required?: string[];
  items?: SchemaNode;
  prefixItems?: SchemaNode[];
  additionalProperties?: boolean | SchemaNode;
  allOf?: SchemaNode[];
  anyOf?: SchemaNode[];
  oneOf?: SchemaNode[];
  $ref?: string;
  "x-zod"?: string;
}

export const SchemaNode: z.ZodType<SchemaNode> = z.lazy(() =>
  z.object({
    type: z.union([z.string(), z.string().array()]).optional(),
    nullable: z.boolean().optional(),
    enum: z.unknown().array().optional(),
    const: z.unknown().optional(),
    properties: z.record(z.string(), SchemaNode).optional(),
    required: z.string().array().optional(),
    items: SchemaNode.optional(),
    prefixItems: SchemaNode.array().optional(),
    additionalProperties: z.union([z.boolean(), SchemaNode]).optional(),
    allOf: SchemaNode.array().optional(),
    anyOf: SchemaNode.array().optional(),
    oneOf: SchemaNode.array().optional(),
    $ref: z.string().optional(),
    "x-zod": z.string().optional(),
  })
);

export const OpenApiDocument = z.object({
  components: z.object({ schemas: z.record(z.string(), SchemaNode) }),
});
export type OpenApiDocument = z.infer<typeof OpenApiDocument>;

type JsonType = "string" | "number" | "boolean" | "object" | "array";

interface Shape {
  /** Non-null JSON types; empty means "anything" (not compared). */
  types: Set<JsonType>;
  nullable: boolean;
  /** Undefined for a free-form object (a record, a `dict` field). */
  properties?: Map<string, { shape: Shape; required: boolean }>;
  /** Keeps keys it does not list (`z.looseObject`, `additionalProperties`). */
  open: boolean;
  items?: Shape;
  /** The OpenAPI component this node points at. */
  ref?: string;
  /** The exported zod schema this node was made from. */
  zodName?: string;
}

export type DifferenceKind =
  "missing-in-zod" | "missing-in-schema" | "required-in-zod" | "null-in-schema-only" | "null-in-zod-only" | "type";

export interface Difference {
  /** `<zod export>/<component> <path>: <kind>`, the key of contract-baseline.json. */
  key: string;
  detail: string;
}

const REF_PREFIX = "#/components/schemas/";

function jsonType(name: string): JsonType | "null" | undefined {
  switch (name) {
    case "integer":
    case "number":
      return "number";
    case "string":
    case "boolean":
    case "object":
    case "array":
    case "null":
      return name;
    default:
      return undefined;
  }
}

function typeOfValue(value: unknown): JsonType | "null" | undefined {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  const type = typeof value;
  return type === "string" || type === "number" || type === "boolean" || type === "object" ? type : undefined;
}

function emptyShape(): Shape {
  return { types: new Set(), nullable: false, open: false };
}

/** A union of shapes: types add up, null if any branch allows it. */
function merge(shapes: Shape[]): Shape {
  const merged = emptyShape();
  const typed = shapes.filter(shape => shape.types.size > 0);
  // One untyped branch makes the whole union "anything".
  const anything = typed.length < shapes.filter(shape => !isNullOnly(shape)).length;
  for (const shape of shapes) {
    merged.nullable ||= shape.nullable;
    if (!anything) for (const type of shape.types) merged.types.add(type);
    merged.properties ??= shape.properties;
    merged.open ||= shape.open;
    merged.items ??= shape.items;
    merged.ref ??= shape.ref;
    merged.zodName ??= shape.zodName;
  }
  return merged;
}

function isNullOnly(shape: Shape): boolean {
  return shape.nullable && shape.types.size === 0 && shape.ref === undefined;
}

/**
 * Turn a JSON Schema node into a Shape. `$ref`s into `components` are resolved
 * (the shape keeps the component's name); `seen` stops a recursive component.
 */
export function toShape(node: SchemaNode, components: Record<string, SchemaNode>, seen: string[] = []): Shape {
  if (node.$ref !== undefined) {
    const name = node.$ref.startsWith(REF_PREFIX) ? node.$ref.slice(REF_PREFIX.length) : node.$ref;
    const target = components[name];
    if (target === undefined || seen.includes(name)) return { ...emptyShape(), ref: name };
    const shape = toShape(target, components, [...seen, name]);
    return { ...shape, ref: name, nullable: shape.nullable || node.nullable === true };
  }

  const branches = [...(node.allOf ?? []), ...(node.anyOf ?? []), ...(node.oneOf ?? [])];
  if (branches.length > 0) {
    const union = merge(branches.map(branch => toShape(branch, components, seen)));
    return { ...union, nullable: union.nullable || node.nullable === true, zodName: node["x-zod"] ?? union.zodName };
  }

  const shape = emptyShape();
  shape.nullable = node.nullable === true;
  if (node["x-zod"] !== undefined) shape.zodName = node["x-zod"];

  const declared = node.type === undefined ? [] : Array.isArray(node.type) ? node.type : [node.type];
  const values = node.enum ?? (node.const !== undefined ? [node.const] : []);
  for (const type of [...declared.map(jsonType), ...values.map(typeOfValue)]) {
    if (type === "null") shape.nullable = true;
    else if (type !== undefined) shape.types.add(type);
  }

  if (node.properties !== undefined) {
    shape.types.add("object");
    const required = new Set(node.required ?? []);
    shape.properties = new Map(
      Object.entries(node.properties).map(([name, child]) => [
        name,
        { shape: toShape(child, components, seen), required: required.has(name) },
      ])
    );
  }
  if (node.additionalProperties !== undefined && node.additionalProperties !== false) {
    shape.types.add("object");
    shape.open = true;
  }
  if (node.items !== undefined) {
    shape.types.add("array");
    shape.items = toShape(node.items, components, seen);
  } else if (node.prefixItems !== undefined) {
    shape.types.add("array");
  }
  return shape;
}

/** zod's JSON Schema (input side), each exported schema tagged with its name. */
export function zodToNode(schema: z.ZodType, names: ReadonlyMap<object, string>): SchemaNode {
  const json = z.toJSONSchema(schema, {
    io: "input",
    unrepresentable: "any",
    override: ctx => {
      const name = names.get(ctx.zodSchema);
      if (name !== undefined) ctx.jsonSchema["x-zod"] = name;
    },
  });
  return SchemaNode.parse(json);
}

function describe(shape: Shape): string {
  const types: string[] = [...shape.types].sort();
  if (shape.nullable) types.push("null");
  return types.length > 0 ? types.join(" | ") : "any";
}

/**
 * Compare a zod shape with a server shape. `covered(zodName, component)` says
 * whether that pair is compared on its own (a contract-map entry), in which
 * case a nested occurrence is not walked again.
 */
export function compareShapes(
  prefix: string,
  zod: Shape,
  server: Shape,
  covered: (zodName: string, component: string) => boolean,
  path = ""
): Difference[] {
  const differences: Difference[] = [];
  const add = (kind: DifferenceKind, detail: string) => {
    differences.push({ key: `${prefix} ${path || "(root)"}: ${kind}`, detail });
  };

  // An untyped side ("anything") cannot be compared.
  if (zod.types.size === 0 || server.types.size === 0) return differences;

  const sameTypes = zod.types.size === server.types.size && [...zod.types].every(type => server.types.has(type));
  if (!sameTypes) add("type", `zod ${describe(zod)}, schema ${describe(server)}`);
  if (server.nullable && !zod.nullable) add("null-in-schema-only", `schema ${describe(server)}, zod ${describe(zod)}`);
  if (zod.nullable && !server.nullable) add("null-in-zod-only", `zod ${describe(zod)}, schema ${describe(server)}`);

  if (zod.zodName !== undefined && server.ref !== undefined && covered(zod.zodName, server.ref)) {
    return differences;
  }

  if (zod.properties !== undefined && server.properties !== undefined) {
    for (const [name, field] of server.properties) {
      const fieldPath = path ? `${path}.${name}` : name;
      const mine = zod.properties.get(name);
      if (mine === undefined) {
        if (zod.open) continue;
        differences.push({
          key: `${prefix} ${fieldPath}: missing-in-zod`,
          detail: `schema ${describe(field.shape)}, not in the zod schema (parsing drops it)`,
        });
        continue;
      }
      // z.unknown() accepts a missing key although its JSON Schema lists it as required.
      if (mine.required && !field.required && mine.shape.types.size > 0) {
        differences.push({
          key: `${prefix} ${fieldPath}: required-in-zod`,
          detail: "zod requires it, the schema marks it optional",
        });
      }
      differences.push(...compareShapes(prefix, mine.shape, field.shape, covered, fieldPath));
    }
    for (const name of zod.properties.keys()) {
      if (!server.properties.has(name)) {
        differences.push({
          key: `${prefix} ${path ? `${path}.${name}` : name}: missing-in-schema`,
          detail: "in the zod schema, not in the OpenAPI component",
        });
      }
    }
  }
  if (zod.items !== undefined && server.items !== undefined) {
    differences.push(...compareShapes(prefix, zod.items, server.items, covered, `${path}[]`));
  }
  return differences;
}

export interface ContractEntry {
  schema: z.ZodType;
  components: readonly string[];
}

/** Every difference between the mapped zod schemas and their components. */
export function contractDifferences(
  document: OpenApiDocument,
  map: Readonly<Record<string, ContractEntry>>
): { differences: Difference[]; unknownComponents: string[] } {
  const components = document.components.schemas;
  const names = new Map<z.ZodType, string>(Object.entries(map).map(([name, entry]) => [entry.schema, name]));
  const covered = (zodName: string, component: string) => map[zodName]?.components.includes(component) ?? false;
  const differences: Difference[] = [];
  const unknownComponents: string[] = [];
  for (const [name, entry] of Object.entries(map)) {
    const zodShape = toShape(zodToNode(entry.schema, names), {});
    for (const component of entry.components) {
      const node = components[component];
      if (node === undefined) {
        unknownComponents.push(`${name}/${component}`);
        continue;
      }
      // The root itself is compared by its fields, never skipped as "covered".
      const serverShape = toShape(node, components, [component]);
      const root = { ...zodShape, zodName: undefined };
      differences.push(...compareShapes(`${name}/${component}`, root, serverShape, covered));
    }
  }
  return { differences, unknownComponents };
}
