// Import first: every datetime this process formats is UTC, like Django's
// containers (TIME_ZONE = UTC) and the Rust server.
process.env.TZ = "UTC";
export {};
