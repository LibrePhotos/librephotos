import { fireEvent, waitFor } from "@testing-library/react-native";
import { AdminScreen } from "./AdminScreen";
import { renderWithProviders, makeMockClient, jsonResponse } from "@/test/test-utils";
import { useToastStore } from "@/stores/toasts";

const JOB = {
  job_id: "abc",
  queued_at: "2024-01-01T00:00:00Z",
  started_at: "2024-01-01T00:01:00Z",
  finished_at: null,
  finished: false,
  failed: false,
  cancelled: false,
  job_type: 1,
  job_type_str: "Scan Photos",
  started_by: { id: 1, username: "admin", first_name: "A", last_name: "D" },
  progress_current: 5,
  progress_target: 10,
  id: 99,
};

function client(onScan?: () => void) {
  return makeMockClient(async (url) => {
    if (url.includes("/jobs/")) return jsonResponse({ count: 1, next: null, previous: null, results: [JOB] });
    if (url.includes("/rqavailable/")) return jsonResponse({ status: true, queue_can_accept_job: true });
    if (url.includes("/scanphotos/")) {
      onScan?.();
      return jsonResponse({ status: true, job_id: "new" });
    }
    return jsonResponse({}, 404);
  });
}

describe("AdminScreen", () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
    (globalThis as { __mockNetworkConnected?: boolean }).__mockNetworkConnected = true;
  });

  it("renders the worker indicator and the job list", async () => {
    const { getByTestId } = renderWithProviders(<AdminScreen />, client());
    await waitFor(() => {
      expect(getByTestId("worker-indicator")).toBeTruthy();
      expect(getByTestId("job-99")).toBeTruthy();
    });
  });

  it("triggers a library scan", async () => {
    let scanned = false;
    const { getByTestId } = renderWithProviders(<AdminScreen />, client(() => (scanned = true)));
    fireEvent.press(getByTestId("admin-scan"));
    await waitFor(() => expect(scanned).toBe(true));
  });
});
