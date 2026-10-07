// The DRF error envelope (api/views/exception_handler.py):
// {"errors": [{"field": ..., "message": ...}]}. The UI shows the first
// message; auth failures use the field "detail". Port of lp_core::error.

export interface FieldError {
  field: string;
  message: string;
}

export class ApiError extends Error {
  headers: [string, string][] = [];
  emptyBody = false;
  constructor(
    public status: number,
    public errors: FieldError[],
  ) {
    super(`${status} ${errors.map((e) => `[${e.field}: ${e.message}]`).join(" ")}`);
  }

  static of(status: number, field: string, message: string) {
    return new ApiError(status, [{ field, message }]);
  }
  /** Several field errors at once (DRF serializer validation). */
  static fields(status: number, errors: FieldError[]) {
    return new ApiError(status, errors);
  }
  /** Bare status, no body. */
  static statusOnly(status: number) {
    const e = new ApiError(status, []);
    e.emptyBody = true;
    return e;
  }
  withHeader(name: string, value: string) {
    this.headers.push([name, value]);
    return this;
  }
  /** 400 on a named field. */
  static badRequest(field: string, message: string) {
    return ApiError.of(400, field, message);
  }
  /** 400 like DRF's ValidationError("...") raised with a plain string. */
  static validation(message: string) {
    return ApiError.of(400, "non_field_errors", message);
  }
  /** 401 with field detail plus DRF's WWW-Authenticate challenge. */
  static unauthorized(message: string) {
    return ApiError.of(401, "detail", message).withHeader("WWW-Authenticate", 'Bearer realm="api"');
  }
  static notAuthenticated() {
    return ApiError.unauthorized("Authentication credentials were not provided.");
  }
  static forbidden(message: string) {
    return ApiError.of(403, "detail", message);
  }
  static permissionDenied() {
    return ApiError.forbidden("You do not have permission to perform this action.");
  }
  static notFound(message = "Not found.") {
    return ApiError.of(404, "detail", message);
  }
  static methodNotAllowed(method: string) {
    return ApiError.of(405, "detail", `Method "${method}" not allowed.`);
  }
  /** 500; the cause is logged, never sent. */
  static internal(err: unknown) {
    console.error("internal error:", err);
    return ApiError.of(500, "detail", "A server error occurred.");
  }

  toResponse(): Response {
    const headers = new Headers(this.headers);
    if (this.emptyBody) return new Response(null, { status: this.status, headers });
    headers.set("Content-Type", "application/json");
    return new Response(JSON.stringify({ errors: this.errors }), { status: this.status, headers });
  }
}

export function errorResponse(e: unknown): Response {
  if (e instanceof ApiError) return e.toResponse();
  if (e instanceof Response) return e;
  return ApiError.internal(e).toResponse();
}
