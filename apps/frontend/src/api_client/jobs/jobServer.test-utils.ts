import type { Job } from "@librephotos/api-client";
import { vi } from "vitest";

type Handler = (url: URL, init: RequestInit | undefined) => Response | undefined;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/**
 * A fake `/api/jobs/` for the job follower: the user's jobs, newest first, served as the list (one
 * page of `page_size`) and one by one (`/api/jobs/{id}/`, 404 once removed). `other` answers any
 * other request (a job trigger).
 */
export function fakeJobServer(other: Handler = () => undefined) {
  let jobs: Job[] = [];
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://x");
    const detail = /^\/api\/jobs\/(\d+)\/$/.exec(url.pathname);
    if (detail) {
      const job = jobs.find(candidate => String(candidate.id) === detail[1]);
      return job ? json(200, job) : json(404, { errors: [{ code: "not_found", message: "Not found." }] });
    }
    if (url.pathname === "/api/jobs/") {
      const size = Number(url.searchParams.get("page_size") ?? "10");
      const results = jobs.slice(0, size);
      const next = jobs.length > size ? "http://x/api/jobs/?page=2" : null;
      return json(200, { count: jobs.length, next, previous: null, results });
    }
    return other(url, init) ?? json(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    fetchMock,
    /** Sets the user's jobs, newest first. */
    setJobs: (next: Job[]) => {
      jobs = next;
    },
  };
}
