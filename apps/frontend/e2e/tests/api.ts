import { APIRequestContext, expect } from "@playwright/test";

/** Thin helpers over the REST API, used for seeding only; the specs check the UI. */

export async function obtainToken(request: APIRequestContext, username: string, password: string): Promise<string> {
  const response = await request.post("/api/auth/token/obtain/", { data: { username, password } });
  expect(response.ok(), `login as ${username} failed: ${response.status()} ${await response.text()}`).toBeTruthy();
  const { access } = (await response.json()) as { access: string };
  return access;
}

function userIdFromToken(token: string): number {
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")) as { user_id: number };
  return payload.user_id;
}

export type SelfDetails = { id: number; scan_directory: string | null; photo_count: number };

export async function getSelf(request: APIRequestContext, token: string): Promise<SelfDetails> {
  const response = await request.get(`/api/user/${userIdFromToken(token)}/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok(), `GET /api/user/<id>/ failed: ${response.status()}`).toBeTruthy();
  return (await response.json()) as SelfDetails;
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
  const body = (await response.json()) as { status: boolean; message?: string };
  expect(body.status, `scan did not start: ${body.message ?? response.status()}`).toBeTruthy();
}
