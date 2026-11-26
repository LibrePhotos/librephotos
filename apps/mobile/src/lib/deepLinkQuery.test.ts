import path from "path";
import { getStateFromPath } from "expo-router/build/react-navigation/core/getStateFromPath";

const linking = { screens: { foo: "foo" } };

function paramsOf(url: string) {
  return getStateFromPath(url, linking)?.routes[0]?.params;
}

function distinctPercentRuns(count: number) {
  let query = "";
  for (let index = 0; index < count; index++) {
    const high = Math.floor(index / 256).toString(16).padStart(2, "0");
    const low = (index % 256).toString(16).padStart(2, "0");
    query += `%${high}%${low}x`;
  }
  return `${query}%zz`;
}

describe("deep link query parsing through expo-router's query-string", () => {
  it("resolves decode-uri-component to the CommonJS port in packages/", () => {
    const queryStringDir = path.dirname(require.resolve("query-string"));
    const decoder = require.resolve("decode-uri-component", { paths: [queryStringDir] });
    expect(decoder.split(path.sep).join("/")).toMatch(/packages\/decode-uri-component\/src\/index\.js$/);
  });

  it("parses a normal query", () => {
    expect(paramsOf("/foo?album=Summer%202026&name=st%C3%A5le&page=2")).toEqual({
      album: "Summer 2026",
      name: "ståle",
      page: "2",
    });
  });

  it("keeps malformed escapes instead of throwing", () => {
    expect(paramsOf("/foo?a=%E0%A4%A&b=%C2")).toEqual({ a: "%E0%A4%A", b: "�" });
  });

  it("decodes one level only, as decode-uri-component 0.5 does", () => {
    expect(paramsOf("/foo?c=%25C2%zz&d=%84%D7%25%88%90")).toEqual({
      c: "%C2%zz",
      d: "%84%D7%%88%90",
    });
  });

  it("parses a hostile query in linear time", () => {
    const start = performance.now();
    const params = paramsOf(`/foo?q=${distinctPercentRuns(16_000)}`);
    expect(performance.now() - start).toBeLessThan(2000);
    expect(Object.keys(params ?? {})).toEqual(["q"]);
    expect(JSON.stringify(params)).toMatch(/%zz"\}$/);
  });
});
