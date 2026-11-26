import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cLikeComments, cssComments, dockerfileComments, shellComments, tomlComments, yamlComments } from "./lexers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

export const GENERATED_PATHS = [
  ["lockfile", /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|uv\.lock|poetry\.lock)$/],
  ["migration", /(^|\/)migrations\//],
  ["generated", /\.gen\.[^/]+$/],
  ["generated", /^apps\/backend\/openapi\.json$/],
  ["generated", /(^|\/)src-tauri\/gen\//],
  ["vendored", /(^|\/)node_modules\//],
  ["vendored", /^apps\/backend\/chunked_upload\//],
  ["generated", /^apps\/backend\/vulture_whitelist\.py$/],
  ["snapshot", /(^|\/)__snapshots__\//],
  ["snapshot", /\.snap$/],
  ["minified", /\.min\.(js|css)$/],
];

export const ALLOWED_COMMENTS = [
  ["shebang", (comment) => comment.line === 1 && comment.text.startsWith("#!")],
  ["triple-slash reference", (comment) => comment.language === "ts" && /^\/\/\/\s*<reference\s/.test(comment.text)],
  ["@ts-check", (comment) => comment.language === "ts" && /^\/\/\s*@ts-check\s*$/.test(comment.text)],
  ["encoding declaration", (comment) => comment.language === "python" && comment.line <= 2 && /^#.*?coding[:=]\s*[-\w.]+/.test(comment.text)],
  ["raw-create marker", (comment) => comment.language === "python" && /^#\s*raw-create:\s*\S/.test(comment.text)],
  [
    "action version of a SHA pin",
    (comment) =>
      comment.language === "yaml" &&
      /^#\s*v\d+(\.\d+){0,2}$/.test(comment.text) &&
      /^\s*(-\s+)?uses:\s+[\w.-]+\/[\w./-]+@[0-9a-f]{40}\s+#/.test(comment.lineText ?? ""),
  ],
];

const EXTENSIONS = new Map([
  ...[".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"].map((ext) => [ext, "ts"]),
  [".json", "json"],
  [".jsonc", "json"],
  [".py", "python"],
  [".pyi", "python"],
  [".rs", "rust"],
  [".glsl", "glsl"],
  [".vert", "glsl"],
  [".frag", "glsl"],
  [".wgsl", "wgsl"],
  [".css", "css"],
  [".scss", "scss"],
  [".sass", "scss"],
  [".less", "scss"],
  [".sh", "shell"],
  [".bash", "shell"],
  [".yml", "yaml"],
  [".yaml", "yaml"],
  [".toml", "toml"],
]);

export function generatedReason(path) {
  return GENERATED_PATHS.find(([, pattern]) => pattern.test(path))?.[0] ?? null;
}

export function languageOf(path) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (/^Dockerfile(\..+)?$/.test(name) || /\.dockerfile$/i.test(name)) return "dockerfile";
  const dot = name.lastIndexOf(".");
  return dot === -1 ? null : (EXTENSIONS.get(name.slice(dot).toLowerCase()) ?? null);
}

let typescript;

export function loadTypescript() {
  if (typescript) return typescript;
  for (const base of [repoRoot, join(repoRoot, "apps", "frontend"), join(repoRoot, "apps", "docs")]) {
    if (!existsSync(join(base, "node_modules", "typescript"))) continue;
    typescript = createRequire(join(base, "package.json"))("typescript");
    return typescript;
  }
  throw new Error("typescript is not installed: run `npm ci --workspace packages/api-client --ignore-scripts` at the repo root");
}

function triviaComments(text, from, to, found) {
  let i = from;
  while (i < to) {
    if (text.startsWith("//", i)) {
      const end = Math.min(to, text.indexOf("\n", i) === -1 ? text.length : text.indexOf("\n", i));
      found.push([i, end]);
      i = end;
    } else if (text.startsWith("/*", i)) {
      const close = text.indexOf("*/", i + 2);
      const end = close === -1 ? to : close + 2;
      found.push([i, end]);
      i = end;
    } else if (i === 0 && text.startsWith("#!")) {
      const end = text.indexOf("\n") === -1 ? text.length : text.indexOf("\n");
      found.push([0, end]);
      i = end;
    } else {
      i += 1;
    }
  }
}

function scriptKind(ts, path) {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  if (ext === ".tsx") return ts.ScriptKind.TSX;
  if (ext === ".jsx") return ts.ScriptKind.JSX;
  if ([".js", ".mjs", ".cjs"].includes(ext)) return ts.ScriptKind.JS;
  if (ext === ".json" || ext === ".jsonc") return ts.ScriptKind.JSON;
  return ts.ScriptKind.TS;
}

export function typescriptComments(path, text) {
  const ts = loadTypescript();
  const kind = scriptKind(ts, path);
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
  const found = [];
  const keyComments = [];
  const visit = (node) => {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return;
    if (kind === ts.ScriptKind.JSON && ts.isPropertyAssignment(node) && ts.isStringLiteral(node.name) && node.name.text.startsWith("//")) {
      keyComments.push([node.getStart(source), node.end]);
    }
    if (node.kind <= ts.SyntaxKind.LastToken) {
      if (node.kind !== ts.SyntaxKind.JsxText && node.kind !== ts.SyntaxKind.JsxTextAllWhiteSpaces) {
        triviaComments(text, node.pos, node.getStart(source), found);
      }
      return;
    }
    for (const child of node.getChildren(source)) visit(child);
  };
  visit(source);
  return { ranges: found, keyComments };
}

function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}

function lineAt(starts, offset) {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

function fromRanges(text, ranges, kind) {
  const starts = lineStarts(text);
  return ranges.map(([from, to]) => {
    const firstLineEnd = text.indexOf("\n", from);
    return {
      start: lineAt(starts, from),
      end: lineAt(starts, Math.max(from, to - 1)),
      kind,
      text: text.slice(from, firstLineEnd === -1 || firstLineEnd > to ? to : firstLineEnd).trim(),
    };
  });
}

function workflowFile(path) {
  return /(^|\/)\.github\/workflows\/[^/]+$/.test(path) || /(^|\/)action\.ya?ml$/.test(path);
}

export function lexComments(path, text) {
  const language = languageOf(path);
  switch (language) {
    case "ts":
    case "json": {
      const { ranges, keyComments } = typescriptComments(path, text);
      return [...fromRanges(text, ranges, "comment"), ...fromRanges(text, keyComments, "comment key")];
    }
    case "rust":
      return fromRanges(text, cLikeComments(text, { nested: true, rust: true }), "comment");
    case "glsl":
      return fromRanges(text, cLikeComments(text), "comment");
    case "wgsl":
      return fromRanges(text, cLikeComments(text, { nested: true }), "comment");
    case "css":
      return fromRanges(text, cssComments(text), "comment");
    case "scss":
      return fromRanges(text, cssComments(text, { lineComments: true }), "comment");
    case "shell":
      return fromRanges(text, shellComments(text), "comment");
    case "yaml":
      return fromRanges(text, yamlComments(text, { shellKeys: workflowFile(path) ? ["run"] : [] }), "comment");
    case "toml":
      return fromRanges(text, tomlComments(text), "comment");
    case "dockerfile":
      return fromRanges(text, dockerfileComments(text), "comment");
    default:
      return [];
  }
}

let python;

export function findPython() {
  if (python !== undefined) return python;
  const candidates = process.env.PYTHON ? [process.env.PYTHON] : ["python3", "python"];
  python = null;
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["-I", "-c", "import sys; print(sys.version_info >= (3, 12))"], { encoding: "utf8" });
    if (probe.status === 0 && probe.stdout.trim() === "True") {
      python = candidate;
      break;
    }
  }
  return python;
}

export function pythonComments(files) {
  const entries = Object.entries(files);
  if (entries.length === 0) return {};
  const interpreter = findPython();
  if (!interpreter) throw new Error("Python 3.12 or newer is needed to check .py files: put it on PATH or set PYTHON");
  const run = spawnSync(interpreter, ["-I", join(here, "python_comments.py")], {
    input: JSON.stringify(Object.fromEntries(entries)),
    maxBuffer: 256 * 1024 * 1024,
  });
  if (run.status !== 0) throw new Error(`python_comments.py failed: ${run.stderr.toString()}`);
  return JSON.parse(run.stdout.toString());
}

export function allowedReason(comment) {
  return ALLOWED_COMMENTS.find(([, allowed]) => allowed(comment))?.[0] ?? null;
}

export function commentViolations(files) {
  const violations = [];
  const errors = [];
  const checked = files.filter((file) => file.added.size > 0 && languageOf(file.path) && !generatedReason(file.path));
  const pythonFiles = Object.fromEntries(checked.filter((file) => languageOf(file.path) === "python").map((file) => [file.path, file.text]));
  const pythonResults = pythonComments(pythonFiles);
  for (const file of checked) {
    const language = languageOf(file.path) === "json" ? "ts" : languageOf(file.path);
    let comments;
    if (language === "python") {
      const result = pythonResults[file.path];
      if (result.error) {
        errors.push({ path: file.path, message: result.error });
        continue;
      }
      comments = result.comments;
    } else {
      comments = lexComments(file.path, file.text);
    }
    const lines = file.text.split("\n");
    const reported = new Set();
    for (const comment of comments) {
      if (allowedReason({ ...comment, line: comment.start, language, text: comment.text || lines[comment.start - 1].trim(), lineText: lines[comment.start - 1] })) continue;
      for (let line = comment.start; line <= comment.end; line += 1) {
        if (!file.added.has(line) || reported.has(line)) continue;
        reported.add(line);
        violations.push({ path: file.path, line, kind: comment.kind, text: lines[line - 1].trim() });
      }
    }
  }
  violations.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
  return { violations, errors };
}
