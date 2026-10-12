import { ApiError as SharedApiError } from "@librephotos/api-client";

/**
 * A failed response, carrying its status so callers can react to it. See issue #492.
 *
 * `serverMessage` is only set when the backend actually sent a human readable
 * error; `message` falls back to an internal English string that must never be
 * shown to a user.
 *
 * Every request made through `apiClient` rejects with this class
 * (a subclass of the shared client's ApiError, so `instanceof` against either
 * works); this constructor keeps the web's argument order.
 */
export class ApiError extends SharedApiError {
  constructor(message: string, status: number, serverMessage: string | null = null, endpoint = "", body?: unknown) {
    super(status, endpoint, message, body, serverMessage);
  }
}
