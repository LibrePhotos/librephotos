// React's act() reads this flag to tell a test environment; the tests that
// render with act() set it on globalThis. (A global is declared with var.)
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

export {};
