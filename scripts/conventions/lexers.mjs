const isBlank = (ch) => ch === " " || ch === "\t" || ch === "\r" || ch === "\f" || ch === "\v";
const isIdentChar = (ch) => ch !== undefined && /[\p{L}\p{N}_]/u.test(ch);

function lineEnd(text, from) {
  const end = text.indexOf("\n", from);
  return end === -1 ? text.length : end;
}

function skipQuoted(text, from, quote, { escapes = true, stopAtNewline = false } = {}) {
  let i = from + 1;
  while (i < text.length) {
    const ch = text[i];
    if (escapes && ch === "\\") {
      i += 2;
    } else if (ch === quote) {
      return i + 1;
    } else if (stopAtNewline && ch === "\n") {
      return i;
    } else {
      i += 1;
    }
  }
  return text.length;
}

function skipBlockComment(text, from, nested) {
  let depth = 1;
  let i = from + 2;
  while (i < text.length && depth > 0) {
    if (nested && text.startsWith("/*", i)) {
      depth += 1;
      i += 2;
    } else if (text.startsWith("*/", i)) {
      depth -= 1;
      i += 2;
    } else {
      i += 1;
    }
  }
  return i;
}

const RUST_RAW_STRING = /(?:br|cr|r)(#*)"/y;

function skipRustQuote(text, i) {
  if (text[i + 1] === "\\") {
    let j = i + 2;
    if (text[j] === "u" && text[j + 1] === "{") j = text.indexOf("}", j) + 1;
    else j += 1;
    return text[j] === "'" ? j + 1 : i + 1;
  }
  const codePoint = text.codePointAt(i + 1);
  if (codePoint === undefined) return i + 1;
  const width = codePoint > 0xffff ? 2 : 1;
  return text[i + 1 + width] === "'" ? i + 2 + width : i + 1;
}

export function cLikeComments(text, { nested = false, rust = false } = {}) {
  const found = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (text.startsWith("//", i)) {
      const end = lineEnd(text, i);
      found.push([i, end]);
      i = end;
    } else if (text.startsWith("/*", i)) {
      const end = skipBlockComment(text, i, nested);
      found.push([i, end]);
      i = end;
    } else if (rust && (ch === "r" || ch === "b" || ch === "c") && !isIdentChar(text[i - 1])) {
      RUST_RAW_STRING.lastIndex = i;
      const raw = RUST_RAW_STRING.exec(text);
      if (raw) {
        const close = text.indexOf(`"${raw[1]}`, i + raw[0].length);
        i = close === -1 ? text.length : close + 1 + raw[1].length;
      } else {
        i += 1;
      }
    } else if (ch === '"') {
      i = skipQuoted(text, i, '"');
    } else if (rust && ch === "'") {
      i = skipRustQuote(text, i);
    } else {
      i += 1;
    }
  }
  return found;
}

export function cssComments(text, { lineComments = false } = {}) {
  const found = [];
  const url = /url\(\s*(?!["'])/iy;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    url.lastIndex = i;
    if (text.startsWith("/*", i)) {
      const end = skipBlockComment(text, i, false);
      found.push([i, end]);
      i = end;
    } else if (lineComments && text.startsWith("//", i)) {
      const end = lineEnd(text, i);
      found.push([i, end]);
      i = end;
    } else if (ch === '"' || ch === "'") {
      i = skipQuoted(text, i, ch, { stopAtNewline: true });
    } else if (lineComments && !isIdentChar(text[i - 1]) && url.test(text)) {
      const close = text.indexOf(")", i);
      i = close === -1 ? text.length : close + 1;
    } else {
      i += 1;
    }
  }
  return found;
}

export function tomlComments(text) {
  const found = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "#") {
      const end = lineEnd(text, i);
      found.push([i, end]);
      i = end;
    } else if (text.startsWith('"""', i) || text.startsWith("'''", i)) {
      const fence = text.slice(i, i + 3);
      let j = i + 3;
      while (j < text.length && !text.startsWith(fence, j)) j += fence === '"""' && text[j] === "\\" ? 2 : 1;
      while (text[j + 3] === fence[0]) j += 1;
      i = Math.min(text.length, j + 3);
    } else if (ch === '"' || ch === "'") {
      i = skipQuoted(text, i, ch, { escapes: ch === '"', stopAtNewline: true });
    } else {
      i += 1;
    }
  }
  return found;
}

const DOCKER_DIRECTIVE = /^#\s*(syntax|escape|check)\s*=/i;

export function dockerfileComments(text) {
  const found = [];
  let directives = true;
  let start = 0;
  while (start <= text.length) {
    const end = lineEnd(text, start);
    const line = text.slice(start, end);
    const trimmed = line.trimStart();
    if (trimmed.startsWith("#")) {
      const offset = start + line.length - trimmed.length;
      if (!(directives && DOCKER_DIRECTIVE.test(trimmed))) {
        found.push([offset, end]);
        directives = false;
      }
    } else {
      directives = false;
    }
    start = end + 1;
  }
  return found;
}

const SHELL_WORD_BREAK = new Set([" ", "\t", "\n", ";", "&", "|", "(", ")", "<", ">"]);
const HEREDOC = /<<(-?)[ \t]*(?:'([^'\n]+)'|"([^"\n]+)"|\\?([A-Za-z_][A-Za-z0-9_.-]*))/y;

function skipHeredocBodies(text, from, delimiters) {
  let pos = from;
  for (const delimiter of delimiters) {
    while (pos < text.length) {
      const end = lineEnd(text, pos);
      const line = text.slice(pos, end);
      pos = end + 1;
      if (line.trim() === delimiter) break;
    }
  }
  return Math.min(pos, text.length);
}

function shellCodeStep(text, i, stack, state) {
  const ch = text[i];
  const top = stack[stack.length - 1];
  if (ch === "#" && state.wordStart) {
    const end = lineEnd(text, i);
    state.found.push([i, end]);
    return end;
  }
  state.wordStart = SHELL_WORD_BREAK.has(ch);
  if (ch === "\\") return i + 2;
  if (ch === "'") {
    stack.push({ kind: "single" });
    return i + 1;
  }
  if (ch === '"') {
    stack.push({ kind: "double" });
    return i + 1;
  }
  if (ch === "`") {
    if (top.kind === "backtick") stack.pop();
    else stack.push({ kind: "backtick" });
    state.wordStart = true;
    return i + 1;
  }
  if (ch === "$") return shellDollar(text, i, stack, state);
  if (ch === "<" && text[i + 1] === "<" && text[i + 2] !== "<") {
    HEREDOC.lastIndex = i;
    const heredoc = HEREDOC.exec(text);
    if (heredoc) {
      state.heredocs.push(heredoc[2] ?? heredoc[3] ?? heredoc[4]);
      return HEREDOC.lastIndex;
    }
  }
  if (top.kind === "command" && ch === "(") top.depth += 1;
  if (top.kind === "command" && ch === ")") {
    top.depth -= 1;
    if (top.depth === 0) stack.pop();
  }
  return i + 1;
}

function shellDollar(text, i, stack, state) {
  const next = text[i + 1];
  state.wordStart = false;
  if (next === "(") {
    stack.push({ kind: "command", depth: 1 });
    state.wordStart = true;
    return i + 2;
  }
  if (next === "{") {
    stack.push({ kind: "brace" });
    return i + 2;
  }
  if (next === "'") {
    stack.push({ kind: "ansi" });
    return i + 2;
  }
  return i + 2;
}

function shellQuotedStep(text, i, stack) {
  const ch = text[i];
  const top = stack[stack.length - 1];
  if (top.kind === "single") {
    if (ch === "'") stack.pop();
    return i + 1;
  }
  if (ch === "\\") return i + 2;
  if (top.kind === "ansi") {
    if (ch === "'") stack.pop();
    return i + 1;
  }
  if (top.kind === "double" && ch === '"') {
    stack.pop();
    return i + 1;
  }
  if (top.kind === "brace") {
    if (ch === "}") {
      stack.pop();
      return i + 1;
    }
    if (ch === "{") {
      stack.push({ kind: "brace" });
      return i + 1;
    }
    if (ch === '"') {
      stack.push({ kind: "double" });
      return i + 1;
    }
    if (ch === "'") {
      stack.push({ kind: "single" });
      return i + 1;
    }
  }
  if (ch === "`") {
    stack.push({ kind: "backtick" });
    return i + 1;
  }
  if (ch === "$" && text[i + 1] === "(") {
    stack.push({ kind: "command", depth: 1 });
    return i + 2;
  }
  if (ch === "$" && text[i + 1] === "{") {
    stack.push({ kind: "brace" });
    return i + 2;
  }
  return i + 1;
}

const SHELL_CODE = new Set(["top", "command", "backtick"]);

export function shellComments(text) {
  const stack = [{ kind: "top" }];
  const state = { found: [], wordStart: true, heredocs: [] };
  let i = 0;
  while (i < text.length) {
    const top = stack[stack.length - 1];
    if (text[i] === "\n" && SHELL_CODE.has(top.kind)) {
      i += 1;
      state.wordStart = true;
      if (state.heredocs.length > 0) {
        i = skipHeredocBodies(text, i, state.heredocs);
        state.heredocs = [];
      }
    } else if (SHELL_CODE.has(top.kind)) {
      i = shellCodeStep(text, i, stack, state);
    } else {
      i = shellQuotedStep(text, i, stack);
    }
  }
  return state.found;
}

const BLOCK_SCALAR = /^[|>][-+0-9]*[ \t]*(#.*)?$/;

function yamlLine(line, quote) {
  const result = { comment: null, quote, block: false, key: null, parentColumn: -1 };
  let i = 0;
  let scalarStart = true;
  let scalarColumn = -1;
  let column = line.length - line.trimStart().length - 1;
  while (i < line.length) {
    const ch = line[i];
    if (result.quote === '"') {
      if (ch === "\\") i += 2;
      else {
        if (ch === '"') result.quote = null;
        i += 1;
      }
      continue;
    }
    if (result.quote === "'") {
      if (ch === "'" && line[i + 1] === "'") i += 2;
      else {
        if (ch === "'") result.quote = null;
        i += 1;
      }
      continue;
    }
    if (ch === "#" && (i === 0 || isBlank(line[i - 1]))) {
      result.comment = i;
      return result;
    }
    if (isBlank(ch)) {
      i += 1;
      continue;
    }
    const followedBySpace = i + 1 >= line.length || isBlank(line[i + 1]);
    if (scalarStart && (ch === '"' || ch === "'")) {
      result.quote = ch;
      scalarColumn = i;
      scalarStart = false;
    } else if (scalarStart && (ch === "-" || ch === "?") && followedBySpace) {
      column = i;
    } else if (ch === "[" || ch === "{" || ch === ",") {
      scalarStart = true;
    } else if (ch === ":" && followedBySpace) {
      result.key = scalarColumn >= 0 ? line.slice(scalarColumn, i).trim().replace(/^["']|["']$/g, "") : null;
      column = scalarColumn >= 0 ? scalarColumn : column;
      scalarStart = true;
    } else if (scalarStart && (ch === "|" || ch === ">") && BLOCK_SCALAR.test(line.slice(i))) {
      const comment = line.slice(i).search(/[ \t]#/);
      result.comment = comment === -1 ? null : i + comment + 1;
      result.block = true;
      result.parentColumn = column;
      return result;
    } else if (scalarStart) {
      scalarStart = false;
      scalarColumn = i;
    }
    i += 1;
  }
  return result;
}

export function yamlComments(text, { shellKeys = [] } = {}) {
  const found = [];
  let quote = null;
  let block = null;
  let start = 0;
  const flushBlock = (end) => {
    if (block?.shell && end > block.start) {
      for (const [from, to] of shellComments(text.slice(block.start, end))) found.push([block.start + from, block.start + to]);
    }
    block = null;
  };
  while (start <= text.length) {
    const end = lineEnd(text, start);
    const line = text.slice(start, end);
    if (block) {
      const indent = line.length - line.trimStart().length;
      if (line.trim() === "" || indent > block.parentColumn) {
        start = end + 1;
        continue;
      }
      flushBlock(start);
    }
    const scanned = yamlLine(line, quote);
    quote = scanned.quote;
    if (scanned.comment !== null) found.push([start + scanned.comment, end]);
    if (scanned.block) block = { start: end + 1, parentColumn: scanned.parentColumn, shell: shellKeys.includes(scanned.key) };
    start = end + 1;
  }
  if (block) flushBlock(text.length);
  return found;
}
