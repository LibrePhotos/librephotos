import { lpFetch, prepareServer } from "./dist/server/server.js";
prepareServer();
const H = { authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0b2tlbl90eXBlIjoiYWNjZXNzIiwiZXhwIjoxNzkzOTc0NjUyLCJpYXQiOjE3OTEzODI2NTIsImp0aSI6ImQ4Yjc3NDUyNjY2MzQxZWFhOTAxM2QyNzc5N2YzNDRkIiwidXNlcl9pZCI6IjIifQ.TghbBo3w-CC86eRdOtwMty1xKdzHDG9CwA71iL7WjG0" };
const paths = (process.env.P ?? "/api/rqavailable/").split(",");
async function run(ms: number) {
  let n = 0; const t0 = performance.now();
  await Promise.all(Array.from({ length: 32 }, async (_, i) => { while (performance.now() - t0 < ms) { const r = await lpFetch(new Request("http://127.0.0.1" + paths[i % paths.length], { headers: H })); await r.arrayBuffer(); n++; } }));
  return n / (ms / 1000);
}
await run(1000);
console.log("req/s", Math.round(await run(4000)));
process.exit(0);
