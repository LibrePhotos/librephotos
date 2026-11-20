import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function unquote(path) {
  if (!path.startsWith('"')) return path;
  return JSON.parse(path.replace(/\\([0-7]{3})/g, (_, octal) => `\\u00${parseInt(octal, 8).toString(16).padStart(2, "0")}`));
}

function stripPrefix(path) {
  const plain = unquote(path.trim());
  if (plain === "/dev/null") return null;
  return plain.replace(/^[ab]\//, "");
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseDiff(patch) {
  const files = [];
  let file = null;
  const lines = patch.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("diff --git ")) {
      file = { path: null, oldPath: null, status: "modified", added: new Set(), hunks: [] };
      files.push(file);
      i += 1;
      continue;
    }
    if (!file) {
      i += 1;
      continue;
    }
    if (line.startsWith("new file mode")) file.status = "added";
    else if (line.startsWith("deleted file mode")) file.status = "deleted";
    else if (line.startsWith("rename from ")) {
      file.oldPath = unquote(line.slice("rename from ".length));
      file.status = "renamed";
    } else if (line.startsWith("rename to ")) file.path = unquote(line.slice("rename to ".length));
    else if (line.startsWith("--- ")) file.oldPath = stripPrefix(line.slice(4)) ?? file.oldPath;
    else if (line.startsWith("+++ ")) file.path = stripPrefix(line.slice(4)) ?? file.path;
    else if (line.startsWith("Binary files ")) {
      const match = /^Binary files (.+) and (.+) differ$/.exec(line);
      if (match) {
        file.oldPath = stripPrefix(match[1]) ?? file.oldPath;
        file.path = stripPrefix(match[2]) ?? file.path;
      }
    } else if (HUNK.test(line)) {
      const [, , oldCount = "1", newStart, newCount = "1"] = HUNK.exec(line);
      const hunk = { removed: [], added: [] };
      file.hunks.push(hunk);
      let removedLeft = Number(oldCount);
      let addedLeft = Number(newCount);
      let lineNumber = Number(newStart);
      i += 1;
      while (i < lines.length && (removedLeft > 0 || addedLeft > 0)) {
        const body = lines[i];
        if (body.startsWith("-")) {
          hunk.removed.push(body.slice(1));
          removedLeft -= 1;
        } else if (body.startsWith("+")) {
          hunk.added.push(body.slice(1));
          file.added.add(lineNumber);
          lineNumber += 1;
          addedLeft -= 1;
        } else if (body.startsWith(" ")) {
          lineNumber += 1;
          removedLeft -= 1;
          addedLeft -= 1;
        } else if (!body.startsWith("\\")) {
          break;
        }
        i += 1;
      }
      continue;
    }
    i += 1;
  }
  for (const entry of files) {
    if (entry.status === "deleted") entry.path = entry.oldPath;
    if (!entry.oldPath) entry.oldPath = entry.path;
  }
  return files.filter((entry) => entry.path);
}

function git(cwd, args) {
  return execFileSync("git", ["-c", "core.quotePath=false", ...args], { cwd, encoding: "utf8", maxBuffer: 1024 * 1024 * 1024 });
}

export function readBlobs(cwd, specs) {
  if (specs.length === 0) return [];
  const input = specs.map((spec) => `${spec}\n`).join("");
  const output = execFileSync("git", ["cat-file", "--batch"], { cwd, input, maxBuffer: 2 * 1024 * 1024 * 1024 });
  const blobs = [];
  let offset = 0;
  for (let index = 0; index < specs.length; index += 1) {
    const headerEnd = output.indexOf(10, offset);
    const header = output.subarray(offset, headerEnd).toString("utf8");
    offset = headerEnd + 1;
    if (/ (missing|ambiguous)$/.test(header)) {
      blobs.push(null);
      continue;
    }
    const size = Number(header.slice(header.lastIndexOf(" ") + 1));
    blobs.push(output.subarray(offset, offset + size).toString("utf8"));
    offset += size + 1;
  }
  return blobs;
}

function untrackedFiles(cwd) {
  return git(cwd, ["ls-files", "--others", "--exclude-standard", "-z"])
    .split("\0")
    .filter(Boolean)
    .map((path) => {
      const lines = readFileSync(join(cwd, path), "utf8").split("\n");
      const count = lines.length - (lines[lines.length - 1] === "" ? 1 : 0);
      return {
        path,
        oldPath: path,
        status: "added",
        added: new Set(Array.from({ length: count }, (_, index) => index + 1)),
        hunks: [{ removed: [], added: lines.slice(0, count) }],
      };
    });
}

function lazyTexts(files, read) {
  let texts;
  return (file) => {
    if (!texts) {
      const wanted = files.filter((entry) => entry.hunks.length > 0);
      const loaded = read(wanted);
      texts = new Map(wanted.map((entry, index) => [entry, loaded[index] ?? ""]));
    }
    return texts.get(file) ?? "";
  };
}

export function collectChanges({ cwd, base, head }) {
  const mergeBase = git(cwd, ["merge-base", base, head ?? "HEAD"]).trim();
  const range = head ? [mergeBase, head] : [mergeBase];
  const files = parseDiff(git(cwd, ["diff", "--no-color", "--no-ext-diff", "--find-renames", "-U0", ...range]));
  if (!head) files.push(...untrackedFiles(cwd));
  const present = files.filter((file) => file.status !== "deleted");
  const previous = files.filter((file) => file.status !== "added");
  const newText = lazyTexts(present, (wanted) =>
    head ? readBlobs(cwd, wanted.map((file) => `${head}:${file.path}`)) : wanted.map((file) => readFileSync(join(cwd, file.path), "utf8")),
  );
  const oldText = lazyTexts(previous, (wanted) => readBlobs(cwd, wanted.map((file) => `${mergeBase}:${file.oldPath}`)));
  for (const file of files) {
    Object.defineProperty(file, "text", { get: () => newText(file) });
    Object.defineProperty(file, "oldText", { get: () => oldText(file) });
  }
  return files;
}
