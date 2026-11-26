import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { commentViolations, generatedReason, languageOf, lexComments } from "./conventions/comments.mjs";
import { collectChanges, parseDiff } from "./conventions/diff.mjs";
import { docsViolation, exemptReason, versionOnly } from "./conventions/docs-rule.mjs";

const lines = (...rows) => `${rows.join("\n")}\n`;

function addedFile(path, text, added) {
  const count = text.split("\n").length - 1;
  return { path, text, added: new Set(added ?? Array.from({ length: count }, (_, index) => index + 1)) };
}

function reported(path, text, added) {
  const { violations, errors } = commentViolations([addedFile(path, text, added)]);
  assert.deepEqual(errors, []);
  return violations.map((violation) => violation.line);
}

describe("TypeScript and JavaScript", () => {
  it("ignores comment markers inside strings, URLs, template literals and regex literals", () => {
    const text = lines(
      'const url = "https://example.com/*path*/";',
      "const single = '// not a comment';",
      "const template = `a // b ${'/* c */'} d`;",
      "const nested = `x ${`// inner`} y`;",
      "const pattern = /\\/\\/ and \\/\\*/g;",
      "const ratio = total / count / 2;",
    );
    assert.deepEqual(reported("src/a.ts", text), []);
  });

  it("reports line, block and JSDoc comments", () => {
    const text = lines("const a = 1; // trailing", "/** doc */", "function f() {}", "/* block */ const b = 2;");
    assert.deepEqual(reported("src/a.ts", text), [1, 2, 4]);
  });

  it("reports every added line a multi-line block comment touches, and no unchanged line", () => {
    const text = lines("const a = 1;", "/* starts here", "   goes on", "   ends */", "const b = 2;");
    assert.deepEqual(reported("src/a.ts", text, [3, 4, 5]), [3, 4]);
    assert.deepEqual(reported("src/a.ts", text, [1, 5]), []);
  });

  it("reports JSX comments but not JSX text that looks like one", () => {
    const text = lines("export const A = () => (", "  <div>", "    {/* hidden */}", "    // shown as text", "    http://example.com", "  </div>", ");");
    assert.deepEqual(reported("src/a.tsx", text), [3]);
  });

  it("reports tool suppressions as comments", () => {
    const text = lines("// @ts-ignore", "const a: number = 'x';", "// eslint-disable-next-line no-console", "console.log(a);");
    assert.deepEqual(reported("src/a.ts", text), [1, 3]);
  });

  it("allows a shebang, triple-slash references and @ts-check", () => {
    const text = lines("#!/usr/bin/env node", '/// <reference types="vite/client" />', "// @ts-check", "export {};");
    assert.deepEqual(reported("scripts/a.mjs", text), []);
    assert.deepEqual(reported("src/vite-env.d.ts", lines('/// <reference types="vite/client" />')), []);
  });

  it("reads .js, .jsx, .cjs and .mjs with JSX enabled", () => {
    assert.deepEqual(reported("a.jsx", lines("const a = <b>// text</b>; // c")), [1]);
    assert.deepEqual(reported("a.cjs", lines("module.exports = '//'; /* c */")), [1]);
  });

  it("reports // keys in JSON but not URLs in its strings", () => {
    const text = lines("{", '  "//expo": "why it is pinned",', '  "homepage": "https://example.com/a/*b*/"', "}");
    assert.deepEqual(reported("package.json", text), [2]);
  });
});

describe("Python", () => {
  it("ignores # inside strings and f-strings", () => {
    const text = lines(
      'a = "# not a comment"',
      "b = '#'",
      'c = f"{a!r:#>10}"',
      "d = f\"{'#' + a}\"",
      'e = """',
      "# inside a triple-quoted string",
      '"""',
      "f = r'\\#'",
    );
    assert.deepEqual(reported("apps/backend/api/a.py", text), []);
  });

  it("reports comments, suppressions and docstrings, not other strings", () => {
    const text = lines(
      '"""Module docstring."""',
      "import os  # noqa: F401",
      "",
      "",
      "class A:",
      '    """Class docstring."""',
      "",
      "    def f(self) -> str:",
      "        '''Method docstring.'''",
      '        value = "a string, not a docstring"',
      "        print(value)  # type: ignore",
      "        return value",
      "",
      "",
      "x = 1",
      '"""A string statement explaining x."""',
    );
    assert.deepEqual(reported("apps/backend/api/a.py", text), [1, 2, 6, 9, 11, 16]);
  });

  it("reports the added lines of a multi-line docstring", () => {
    const text = lines("def f() -> None:", '    """First line.', "", "    More.", '    """', "    return None");
    assert.deepEqual(reported("apps/backend/api/a.py", text, [4, 6]), [4]);
  });

  it("allows a shebang, a coding line and the raw-create marker", () => {
    const text = lines("#!/usr/bin/env python", "# -*- coding: utf-8 -*-", "row = Model.objects.create()  # raw-create: the constraint under test");
    assert.deepEqual(reported("apps/backend/api/tests/a.py", text), []);
  });

  it("reports a file Python cannot read instead of passing it", () => {
    const { errors } = commentViolations([addedFile("apps/backend/a.py", lines("def (:"))]);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].path, "apps/backend/a.py");
  });
});

describe("Rust", () => {
  it("tells lifetimes, labels and char literals from quotes", () => {
    const text = lines(
      "fn first<'a>(items: &'a [char]) -> char {",
      "    let quote = '\"';",
      "    let escaped = '\\'';",
      "    let slash = '/';",
      "    'outer: for _ in 0..1 { break 'outer; }",
      '    let s = "// not a comment";',
      '    let raw = r#"/* not "a" comment */"#;',
      '    let bytes = br"//";',
      "    items[0]",
      "}",
    );
    assert.deepEqual(reported("apps/desktop/src-tauri/src/a.rs", text), []);
  });

  it("reports line, doc and nested block comments", () => {
    const text = lines("//! Crate docs.", "/// Item docs.", "fn a() {} // trailing", "/* outer /* inner */ still outer */", "fn b() {}");
    assert.deepEqual(reported("apps/desktop/src-tauri/src/a.rs", text), [1, 2, 3, 4]);
  });
});

describe("CSS and SCSS", () => {
  it("reports block comments, not markers in strings or URLs", () => {
    const text = lines('a { content: "/* x */"; background: url(http://example.com/a.png); }', "/* comment */", "b { color: red; }");
    assert.deepEqual(reported("src/a.css", text), [2]);
  });

  it("reports // in SCSS outside strings and unquoted URLs", () => {
    const text = lines("a { background: url(http://example.com/a.png); }", "// comment", "b { content: '//'; }");
    assert.deepEqual(reported("src/a.scss", text), [2]);
  });
});

describe("shell", () => {
  it("knows when # starts a comment", () => {
    const text = lines(
      "#!/usr/bin/env bash",
      'echo "$#" "${#items[@]}" \'#\' "#" a#b ${x#prefix}',
      "cat <<EOF",
      "# heredoc body, not a comment",
      "EOF",
      "echo done # trailing comment",
      "# whole-line comment",
      'echo "$(printf "%s" a) # still a string"',
    );
    assert.deepEqual(reported("deploy/docker/backend/entrypoint.sh", text), [6, 7]);
  });
});

describe("YAML", () => {
  it("reports YAML comments and shell comments in workflow run blocks", () => {
    const text = lines(
      "on: pull_request # trigger",
      "jobs:",
      "  check:",
      "    steps:",
      "      - name: 'it''s # not a comment'",
      '        url: "a # b"',
      "        plain: http://example.com/#anchor",
      "      - run: |",
      '          echo "#" ${#x}',
      "          # shell comment",
      "          node a.mjs # trailing",
      "      # yaml comment",
    );
    assert.deepEqual(reported(".github/workflows/x.yml", text), [1, 10, 11, 12]);
  });

  it("allows the version comment of an action pinned by commit SHA, and nothing else after uses", () => {
    const sha = "f87e5991a6d7451dcb8d9637bfbc97413f497069";
    const text = lines(
      "jobs:",
      "  check:",
      "    steps:",
      `      - uses: docker/setup-buildx-action@${sha} # v4.4.1`,
      `        uses: actions/cache/restore@${sha} # v5`,
      `      - uses: docker/login-action@${sha} # the login`,
      "      - uses: actions/checkout@v7 # v7",
      "      - name: x # v1.2.3",
    );
    assert.deepEqual(reported(".github/workflows/x.yml", text), [6, 7, 8]);
  });

  it("leaves block scalars alone outside workflow run steps", () => {
    const text = lines("config: |", "  # part of the value", "other: 1");
    assert.deepEqual(reported("deploy/k8s/a.yaml", text), []);
  });
});

describe("TOML and Dockerfile", () => {
  it("reports TOML comments, not # in strings", () => {
    const text = lines('a = "#1"', "b = '#2'", 'c = """', "# in a string", '"""', "d = 1 # comment");
    assert.deepEqual(reported("apps/desktop/src-tauri/Cargo.toml", text), [6]);
  });

  it("allows parser directives at the top of a Dockerfile and reports other # lines", () => {
    const text = lines("# syntax=docker/dockerfile:1", "FROM node:24-alpine", "# comment", 'RUN echo "#" \\', "    # continuation comment", "    && true");
    assert.deepEqual(reported("deploy/docker/frontend/Dockerfile", text), [3, 5]);
  });
});

describe("allow-list", () => {
  const comment = lines("// generated", "# generated");
  const generated = [
    "apps/backend/api/migrations/0240_auto.py",
    "packages/local-db/migrations/meta/_journal.json",
    "apps/frontend/src/routeTree.gen.ts",
    "apps/frontend/node_modules/x/index.js",
    "apps/frontend/src/__snapshots__/a.test.tsx.snap",
    "apps/backend/chunked_upload/models.py",
    "apps/backend/vulture_whitelist.py",
    "package-lock.json",
    "apps/desktop/src-tauri/Cargo.lock",
    "apps/desktop/src-tauri/gen/schemas/desktop-schema.json",
  ];
  for (const path of generated) {
    it(`skips ${path}`, () => {
      assert.ok(generatedReason(path));
      assert.deepEqual(reported(path, comment), []);
    });
  }

  it("does not check prose and data files", () => {
    for (const path of ["README.md", "apps/docs/docs/a.mdx", "deploy/compose/librephotos.env", "apps/backend/requirements.txt"]) {
      assert.equal(languageOf(path), null);
    }
  });

  it("checks every language it knows", () => {
    const known = { "a.ts": "ts", "a.py": "python", "a.rs": "rust", "a.css": "css", "a.sh": "shell", "a.yml": "yaml", "a.toml": "toml", Dockerfile: "dockerfile", "Dockerfile.dev": "dockerfile", "a.glsl": "glsl" };
    for (const [path, language] of Object.entries(known)) assert.equal(languageOf(path), language);
  });
});

describe("lexComments", () => {
  it("returns the comment text and lines", () => {
    assert.deepEqual(lexComments("a.ts", lines("const a = 1;", "/* x", "y */")), [{ start: 2, end: 3, kind: "comment", text: "/* x" }]);
  });
});

const PATCH = lines(
  "diff --git a/apps/frontend/src/a.ts b/apps/frontend/src/a.ts",
  "index 1111111..2222222 100644",
  "--- a/apps/frontend/src/a.ts",
  "+++ b/apps/frontend/src/a.ts",
  "@@ -2 +2,2 @@",
  "-const a = 1;",
  "+const a = 2;",
  "+++const b = 3;",
  "@@ -10,0 +12 @@ function f() {",
  "+// added",
  "diff --git a/new.py b/new.py",
  "new file mode 100644",
  "index 0000000..3333333",
  "--- /dev/null",
  "+++ b/new.py",
  "@@ -0,0 +1 @@",
  "+x = 1",
  "diff --git a/old.ts b/old.ts",
  "deleted file mode 100644",
  "index 4444444..0000000",
  "--- a/old.ts",
  "+++ /dev/null",
  "@@ -1 +0,0 @@",
  "-gone",
  "diff --git a/from.ts b/to.ts",
  "similarity index 100%",
  "rename from from.ts",
  "rename to to.ts",
  "diff --git a/img.png b/img.png",
  "index 5555555..6666666 100644",
  "Binary files a/img.png and b/img.png differ",
);

describe("parseDiff", () => {
  const files = parseDiff(PATCH);

  it("numbers added lines in the new file, including lines that start with +++", () => {
    const [changed] = files;
    assert.equal(changed.path, "apps/frontend/src/a.ts");
    assert.deepEqual([...changed.added], [2, 3, 12]);
    assert.deepEqual(changed.hunks[0], { removed: ["const a = 1;"], added: ["const a = 2;", "++const b = 3;"] });
  });

  it("reads added, deleted, renamed and binary files", () => {
    assert.deepEqual(
      files.map((file) => [file.path, file.oldPath, file.status]),
      [
        ["apps/frontend/src/a.ts", "apps/frontend/src/a.ts", "modified"],
        ["new.py", "new.py", "added"],
        ["old.ts", "old.ts", "deleted"],
        ["to.ts", "from.ts", "renamed"],
        ["img.png", "img.png", "modified"],
      ],
    );
  });
});

function change(path, { status = "modified", removed = [], added = ["x"], text = "", oldText = "" } = {}) {
  return { path, oldPath: path, status, added: new Set(added.map((_, index) => index + 1)), hunks: [{ removed, added }], text, oldText };
}

describe("docs rule", () => {
  it("fails a source change without a docs change and names the sources", () => {
    const violation = docsViolation([change("apps/frontend/src/components/A.tsx"), change("apps/backend/api/views/a.py"), change("scripts/x.mjs")]);
    assert.deepEqual(violation, { sources: ["apps/frontend/src/components/A.tsx", "apps/backend/api/views/a.py"] });
  });

  it("passes when the same change touches the docs or the blog", () => {
    assert.equal(docsViolation([change("apps/mobile/src/a.ts"), change("apps/docs/docs/user-guide/a.md")]), null);
    assert.equal(docsViolation([change("deploy/compose/docker-compose.yml"), change("apps/docs/blog/2026-11-20-release.md")]), null);
  });

  it("counts every app and package source, and deletions", () => {
    for (const path of ["apps/desktop/src-tauri/src/a.rs", "packages/api-client/src/a.ts", "deploy/docker/backend/entrypoint.sh"]) {
      assert.ok(docsViolation([change(path)]), path);
    }
    assert.ok(docsViolation([change("apps/backend/api/old.py", { status: "deleted", added: [] })]));
  });

  it("passes docs-only changes and changes outside the sources", () => {
    assert.equal(docsViolation([change("apps/docs/docs/a.md")]), null);
    assert.equal(docsViolation([change("scripts/check-shared-deps.mjs"), change("plans/a.md"), change("apps/frontend/eslint.config.mjs")]), null);
  });

  it("exempts tests, workflows, lockfiles, translations and markdown", () => {
    const exempt = [
      "apps/backend/api/tests/infra/test_a.py",
      "apps/frontend/src/components/A.test.tsx",
      "packages/api-client/src/__tests__/a.test.ts",
      "apps/frontend/e2e/specs/a.spec.ts",
      "apps/mobile/src/sync/__snapshots__/a.snap",
      ".github/workflows/conventions.yml",
      "apps/desktop/src-tauri/Cargo.lock",
      "apps/frontend/src/locales/de/translation.json",
      "apps/backend/AGENTS.md",
    ];
    for (const path of exempt) assert.ok(exemptReason(path), path);
    assert.equal(docsViolation(exempt.map((path) => change(path))), null);
    assert.ok(docsViolation([change("apps/frontend/src/locales/en/translation.json")]));
  });

  it("exempts a Renovate-style package.json bump, not a script change", () => {
    const before = { name: "a", scripts: { build: "vite build" }, dependencies: { zod: "^4.0.0" }, devDependencies: { vite: "8.0.1" } };
    const bumped = { ...before, dependencies: { zod: "^4.1.0" }, devDependencies: { vite: "8.0.2" } };
    const scripted = { ...before, scripts: { build: "vite build --minify false" } };
    const added = { ...before, dependencies: { zod: "^4.0.0", lodash: "4.17.21" } };
    const manifest = (after) => change("apps/frontend/src/../package.json", { text: JSON.stringify(after), oldText: JSON.stringify(before) });
    assert.equal(versionOnly({ ...manifest(bumped), path: "packages/api-client/package.json" }), true);
    assert.equal(versionOnly({ ...manifest(scripted), path: "packages/api-client/package.json" }), false);
    assert.equal(versionOnly({ ...manifest(added), path: "packages/api-client/package.json" }), false);
  });

  it("exempts version-only bumps of requirements, Cargo.toml, Dockerfiles and compose images", () => {
    const bumps = [
      change("apps/backend/requirements.txt", { removed: ["django==6.1.0", "numpy>=2.3,<3"], added: ["django==6.1.2", "numpy>=2.4,<3"] }),
      change("apps/backend/requirements.dev.txt", { removed: ["ruff==0.15.22"], added: ["ruff==0.15.23"] }),
      change("apps/desktop/src-tauri/Cargo.toml", { removed: ['tauri = { version = "2.9.1" }'], added: ['tauri = { version = "2.10.0" }'] }),
      change("deploy/docker/backend/Dockerfile", { removed: ["FROM ubuntu:24.04@sha256:" + "a".repeat(64)], added: ["FROM ubuntu:24.04@sha256:" + "b".repeat(64)] }),
      change("deploy/compose/docker-compose.yml", { removed: ["    image: pgautoupgrade/pgautoupgrade:18-alpine"], added: ["    image: pgautoupgrade/pgautoupgrade:19-alpine"] }),
    ];
    for (const bump of bumps) assert.equal(versionOnly(bump), true, bump.path);
    assert.equal(docsViolation(bumps), null);
  });

  it("counts other changes to the same files", () => {
    const changes = [
      change("apps/backend/requirements.txt", { removed: [], added: ["requests==2.32.0"] }),
      change("apps/desktop/src-tauri/Cargo.toml", { removed: ["opt-level = 2"], added: ["opt-level = 3"] }),
      change("deploy/docker/backend/Dockerfile", { removed: ["RUN apt-get install -y a"], added: ["RUN apt-get install -y b"] }),
      change("deploy/compose/docker-compose.yml", { removed: ["      - 8001:8001"], added: ["      - 8002:8001"] }),
    ];
    for (const other of changes) assert.equal(versionOnly(other), false, other.path);
  });
});

describe("collectChanges", () => {
  it("diffs the working tree against the merge base, untracked files included", () => {
    const repo = mkdtempSync(join(tmpdir(), "conventions-"));
    const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: repo });
    try {
      git("init", "-q", "-b", "base");
      writeFileSync(join(repo, "a.ts"), lines("// old comment", "export const a = 1;"));
      git("add", ".");
      git("commit", "-q", "-m", "base");
      git("checkout", "-q", "-b", "work");
      writeFileSync(join(repo, "a.ts"), lines("// old comment", "export const a = 2; // new comment"));
      git("commit", "-q", "-am", "work");
      writeFileSync(join(repo, "b.ts"), lines("/* untracked */"));
      const files = collectChanges({ cwd: repo, base: "base" });
      assert.deepEqual(
        files.map((file) => [file.path, file.status, [...file.added]]),
        [
          ["a.ts", "modified", [2]],
          ["b.ts", "added", [1]],
        ],
      );
      assert.deepEqual(
        commentViolations(files).violations.map((violation) => `${violation.path}:${violation.line}`),
        ["a.ts:2", "b.ts:1"],
      );
      const committed = collectChanges({ cwd: repo, base: "base", head: "work" });
      assert.equal(committed[0].text, lines("// old comment", "export const a = 2; // new comment"));
      assert.equal(committed[0].oldText, lines("// old comment", "export const a = 1;"));
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
