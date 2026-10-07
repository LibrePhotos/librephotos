// What an in-process ML call answers instead of a sidecar error status
// (lp_ml's `bad_input` = 400, `failed` = 500). A whole-model failure (model
// missing, runtime not loadable) is runtime.ts's MlUnavailable instead, which
// callers treat like an unreachable sidecar.
export class MlFailed extends Error {
  constructor(
    readonly status: 400 | 500,
    message: string,
  ) {
    super(message);
  }
}
