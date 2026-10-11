import { APIRequestContext, expect } from "@playwright/test";

/** Thin helpers over the REST API, used for seeding only; the specs check the UI. */

/** A property of a parsed JSON value, or undefined when the value is not an object that has it. */
function field(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

export async function obtainToken(request: APIRequestContext, username: string, password: string): Promise<string> {
  const response = await request.post("/api/auth/token/obtain/", { data: { username, password } });
  expect(response.ok(), `login as ${username} failed: ${response.status()} ${await response.text()}`).toBeTruthy();
  const body: unknown = await response.json();
  const access = field(body, "access");
  if (typeof access !== "string") throw new Error(`login as ${username} returned no access token`);
  return access;
}

function userIdFromToken(token: string): number {
  const payload: unknown = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  const userId = field(payload, "user_id");
  if (typeof userId !== "number") throw new Error("access token has no user_id");
  return userId;
}

export type SelfDetails = { id: number; scan_directory: string | null; photo_count: number };

export async function getSelf(request: APIRequestContext, token: string): Promise<SelfDetails> {
  const response = await request.get(`/api/user/${userIdFromToken(token)}/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok(), `GET /api/user/<id>/ failed: ${response.status()}`).toBeTruthy();
  const body: unknown = await response.json();
  const id = field(body, "id");
  const photoCount = field(body, "photo_count");
  const scanDirectory = field(body, "scan_directory");
  if (typeof id !== "number" || typeof photoCount !== "number")
    throw new Error("GET /api/user/<id>/ returned no self details");
  return { id, photo_count: photoCount, scan_directory: typeof scanDirectory === "string" ? scanDirectory : null };
}

export async function setScanDirectory(request: APIRequestContext, token: string, userId: number, path: string) {
  const response = await request.patch(`/api/manage/user/${userId}/`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { scan_directory: path },
  });
  expect(response.ok(), `setting scan directory to ${path} failed: ${await response.text()}`).toBeTruthy();
}

export async function startScan(request: APIRequestContext, token: string) {
  const response = await request.post("/api/scanphotos/", { headers: { Authorization: `Bearer ${token}` }, data: {} });
  const body: unknown = await response.json();
  const message = field(body, "message");
  expect(
    field(body, "status"),
    `scan did not start: ${typeof message === "string" ? message : response.status()}`
  ).toBeTruthy();
}
