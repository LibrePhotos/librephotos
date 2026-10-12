// node --test scripts/check-shared-deps.test.mjs
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { collect, findProblems, satisfies, versionFromPackageLock, versionFromYarnLock } from "./check-shared-deps.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Versions that agree: what the repo has at the time of writing. */
function agreeing() {
  return {
    peers: { zod: "^4.0.0", react: "^19.2.0", "@tanstack/react-query": "^5.96.0" },
    installed: {
      web: { zod: "4.6.6", react: "19.3.0", "@tanstack/react-query": "5.104.2" },
      mobile: { zod: "4.6.6", react: "19.2.3", "@tanstack/react-query": "5.103.2" },
      "api-client (dev)": { zod: "4.6.6", react: "19.2.3", "@tanstack/react-query": "5.103.2" },
    },
  };
}

describe("satisfies", () => {
  const cases = [
    ["4.6.6", "^4.0.0", true],
    ["4.6.6", "^4", true],
    ["5.0.0", "^4", false],
    ["3.25.76", "^4.0.0", false],
    ["3.25.76", "^3.23.0 || ^4.0.0", true],
    ["0.2.9", "^0.2.3", true],
    ["0.3.0", "^0.2.3", false],
    ["5.96.4", "~5.96.0", true],
    ["5.97.0", "~5.96.0", false],
    ["19.2.3", "19.2.3", true],
    ["19.2.4", "19.2.3", false],
    ["19.3.0", ">=18", true],
    ["17.0.2", ">=18", false],
    ["19.3.0", ">=19.2.0 <20", true],
    ["20.0.0", ">=19.2.0 <20", false],
    ["1.2.3", "*", true],
    ["1.2.3", "1.x", true],
  ];
  for (const [version, range, expected] of cases) {
    it(`${version} ${expected ? "satisfies" : "does not satisfy"} ${range}`, () => {
      assert.equal(satisfies(version, range), expected);
    });
  }

  it("refuses syntax it does not understand rather than guessing", () => {
    assert.throws(() => satisfies("1.2.3", "1.0.0 - 2.0.0"), /unsupported range/);
    assert.throws(() => satisfies("1.2.3-beta.1", "^1"), /unsupported version/);
  });
});

describe("lockfile readers", () => {
  it("reads the version yarn.lock resolved for one specifier, among several in a header", () => {
    const lock = [
      "# yarn lockfile v1",
      "",
      '"@tanstack/query-core@5.104.2":',
      '  version "5.104.2"',
      "",
      '"@tanstack/react-query@^5.90.0", "@tanstack/react-query@^5.96.2":',
      '  version "5.104.2"',
      '  resolved "https://registry.yarnpkg.com/x"',
      "",
      "zod@4.6.6:",
      '  version "4.6.6"',
      "",
    ].join("\n");
    assert.equal(versionFromYarnLock(lock, "@tanstack/react-query", "^5.96.2"), "5.104.2");
    assert.equal(versionFromYarnLock(lock, "zod", "4.6.6"), "4.6.6");
    assert.equal(versionFromYarnLock(lock, "zod", "^3.23.0"), undefined);
  });

  it("resolves a workspace's import like Node: nested copy first, then the hoisted one", () => {
    const lock = {
      packages: {
        "node_modules/zod": { version: "3.25.76" },
        "apps/mobile/node_modules/zod": { version: "4.6.6" },
      },
    };
    assert.equal(versionFromPackageLock(lock, "apps/mobile", "zod"), "4.6.6");
    assert.equal(versionFromPackageLock(lock, "packages/api-client", "zod"), "3.25.76");
    assert.equal(versionFromPackageLock(lock, "apps/mobile", "react"), undefined);
  });
});

describe("findProblems", () => {
  it("passes on the repository as it is", () => {
    assert.deepEqual(findProblems(collect(repoRoot)), []);
  });

  it("passes when the versions agree", () => {
    assert.deepEqual(findProblems(agreeing()), []);
  });

  it("fails when the package's zod peer is set back to zod 3", () => {
    const facts = agreeing();
    facts.peers.zod = "^3.23.0";
    const problems = findProblems(facts);
    assert.equal(problems.length, 3);
    assert.match(problems[0], /web: zod 4\.6\.6 does not satisfy the packages\/api-client peer range \^3\.23\.0/);
  });

  it("fails when mobile is on zod 3 while the web is on zod 4", () => {
    const facts = agreeing();
    facts.peers.zod = "^3.23.0 || ^4.0.0";
    facts.installed.mobile.zod = "3.25.76";
    assert.deepEqual(findProblems(facts), [
      "zod majors differ: web 4.6.6, mobile 3.25.76. The shared schemas run under both; bump zod in all three manifests together",
    ]);
  });

  it("fails when a consumer's React Query is below the peer floor", () => {
    const facts = agreeing();
    facts.installed.web["@tanstack/react-query"] = "5.62.0";
    assert.deepEqual(findProblems(facts), [
      "web: @tanstack/react-query 5.62.0 does not satisfy the packages/api-client peer range ^5.96.0",
    ]);
  });

  it("fails when a consumer's React is outside the peer range", () => {
    const facts = agreeing();
    facts.installed.mobile.react = "18.3.1";
    assert.deepEqual(findProblems(facts), [
      "mobile: react 18.3.1 does not satisfy the packages/api-client peer range ^19.2.0",
    ]);
  });

  it("fails when the package's own dev install is outside its peer range", () => {
    const facts = agreeing();
    facts.installed["api-client (dev)"].zod = "3.25.76";
    assert.deepEqual(findProblems(facts), [
      "api-client (dev): zod 3.25.76 does not satisfy the packages/api-client peer range ^4.0.0",
    ]);
  });

  it("fails when a peer is not declared or a consumer has no lockfile entry", () => {
    const facts = agreeing();
    delete facts.peers.react;
    facts.installed.web.zod = undefined;
    assert.deepEqual(findProblems(facts), [
      "web: zod is not installed (no lockfile entry)",
      "packages/api-client does not declare react as a peer dependency",
    ]);
  });
});
