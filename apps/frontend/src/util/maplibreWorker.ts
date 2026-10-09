import { setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

// maplibre-gl 6 loads its web worker from a file next to its own module
// (`new URL("./maplibre-gl-worker.mjs", import.meta.url)`). Vite's dependency
// pre-bundling and the production build both move maplibre-gl into a chunk of
// their own, so that file is never served: every map stays blank with "Worker
// failed to load". Let Vite bundle the worker (with the shared chunk it
// imports) and hand maplibre its URL before the first map is created.
setWorkerUrl(workerUrl);
