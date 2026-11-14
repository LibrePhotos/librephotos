import type { ZodTypeAny, z } from "zod";

/**
 * Parse `body` with one of the frontend's zod schemas and return the parsed
 * value. A failure is what the frontend would turn into an error toast, so it
 * fails the test with the zod issue paths.
 */
export function expectSchema<S extends ZodTypeAny>(schema: S, body: unknown, label = "response"): z.infer<S> {
  const result = schema.safeParse(body);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 20)
      .map(i => `  ${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("\n");
    throw new Error(`${label} does not satisfy the frontend schema:\n${issues}`);
  }
  return result.data;
}
