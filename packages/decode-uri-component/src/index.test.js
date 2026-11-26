"use strict";

const assert = require("node:assert/strict");
const { describe, test } = require("node:test");
const decodeUriComponent = require("./index.js");

const decodingCases = {
  "decodes like upstream": {
    test: "test",
    "a+b": "a+b",
    "a+b+c+d": "a+b+c+d",
    "=a": "=a",
    "%": "%",
    "%25": "%",
    "%%25%%": "%%%%",
    "st%C3%A5le": "ståle",
    "st%C3%A5le%": "ståle%",
    "%st%C3%A5le%": "%ståle%",
    "%%7Bst%C3%A5le%7D%": "%{ståle}%",
    "%ab%C3%A5le%": "%abåle%",
    "%C3%A5%able%": "å%able%",
    "%7B%ab%7C%de%7D": "{%ab|%de}",
    "%7B%ab%%7C%de%%7D": "{%ab%|%de%}",
    "%7 B%ab%%7C%de%%7 D": "%7 B%ab%|%de%%7 D",
    "%ab": "%ab",
    "%ab%ab%ab": "%ab%ab%ab",
    "%61+%4d%4D": "a+MM",
    "﻿test2": "﻿test2",
    "﻿": "﻿",
    "%EF%BB%BFtest": "﻿test",
    "%EF%BB%BF": "﻿",
    "%FE%FF": "��",
    "%FF%FE": "��",
    "†": "†",
    "%C2": "�",
    "%C2x": "�x",
    "%C2%B5": "µ",
    "%C2%B5%": "µ%",
    "%%C2%B5%": "%µ%",
    "%ea%ba%5a%ba": "%ea%baZ%ba",
    "%C3%5A%A5": "%C3Z%A5",
    "%C3%5A%A5%AB": "%C3Z%A5%AB",
  },
  "treats hex digits case-insensitively": {
    "%c3%a5": "å",
    "%C3%a5": "å",
    "%7b%ab%7c%de%7d": "{%ab|%de}",
  },
  "replaces a truncated %C2 with U+FFFD": {
    "%C2%41": "�A",
    "%C2%C2": "��",
    "%C2G5": "�G5",
    "prefix%C2suffix": "prefix�suffix",
    "%C3%A5%C2": "å�",
    "%C2%B5%C2": "µ�",
    "%C2%C2%B5": "�µ",
    "%%C2%%": "%�%%",
  },
  "keeps malformed UTF-8 sequences literal": {
    "%F0%9F%98%80": "\u{1F600}",
    "%F0%9F%98": "%F0%9F%98",
    "%F0%9F": "%F0%9F",
    "%F0": "%F0",
    "%F0%9F%41": "%F0%9FA",
    "%F0%41%82%83": "%F0A%82%83",
    "%F5%80%80%80": "%F5%80%80%80",
    "%F8%88%88%88": "%F8%88%88%88",
    "%C0%AF": "%C0%AF",
    "%C1%BF": "%C1%BF",
    "%E2%82%AC": "€",
    "%E2%82": "%E2%82",
    "%E2%41%AC": "%E2A%AC",
    "%E0%80%41": "%E0%80A",
    "%ED%A0%80": "%ED%A0%80",
    "%80": "%80",
    "%BF": "%BF",
    "%C3": "%C3",
    "%DF": "%DF",
    "%C3%41": "%C3A",
    "%F0%9F%98%80%ab": "\u{1F600}%ab",
    "%C3%A5%ab": "å%ab",
  },
  "keeps well-formed but invalid UTF-8 literal": {
    "%E0%80%80": "%E0%80%80",
    "%E0%80%81": "%E0%80%81",
    "%F0%80%80%80": "%F0%80%80%80",
    "%F0%8F%BF%BF": "%F0%8F%BF%BF",
    "%E0%80%80%ab": "%E0%80%80%ab",
  },
  "keeps code points beyond the Unicode scalar range literal": {
    "%ED%BF%BF": "%ED%BF%BF",
    "%F4%90%80%80": "%F4%90%80%80",
  },
  "keeps invalid percent syntax literal": {
    "%G0": "%G0",
    "%0G": "%0G",
    "%GG": "%GG",
    "foo%bar": "foo%bar",
    "%u0041": "%u0041",
  },
  "keeps invalid lead bytes and orphaned continuation bytes literal": {
    "%C1%88": "%C1%88",
    "%F9%80%80%80": "%F9%80%80%80",
    "%FA%80%80%80": "%FA%80%80%80",
    "%FB%80%80%80": "%FB%80%80%80",
    "%FC%80%80%80": "%FC%80%80%80",
    "%FD%80%80%80": "%FD%80%80%80",
    "%FE%80%80%80": "%FE%80%80%80",
    "%FF%80%80%80": "%FF%80%80%80",
    "%FF": "%FF",
    "%80%80%80": "%80%80%80",
  },
  "decodes the valid parts of mixed sequences": {
    "%C3%A5%80%C3%A5": "å%80å",
    "%G0%C3%A5%ab": "%G0å%ab",
    "%F0%9F%98%80%G0": "\u{1F600}%G0",
    "%C3%A5%%C3%A5": "å%å",
    "%ab%cd%ef": "%ab%cd%ef",
  },
  "replaces UTF-16 byte order marks inside larger strings": {
    "a%FE%FFb": "a��b",
    "%FE%FF%FE%FF": "����",
    "%41%FE%FF": "A��",
  },
  "decodes one level per call even on the fallback path": {
    "%252525": "%2525",
    "%25C2%zz": "%C2%zz",
    "%25%41%zz": "%A%zz",
    "%%%": "%%%",
    "%25C2%25": "%C2%",
    "%2525C2": "%25C2",
  },
  "never recombines a decoded %25 with adjacent bytes": {
    "%84%D7%25%88%90": "%84%D7%%88%90",
    "%20%20%25%80": "  %%80",
  },
};

const nativeParityCases = {
  "": "",
  "%20": " ",
  "%2B": "+",
  "%2b": "+",
  "%00": "\0",
  "%7F": "\u007F",
  "%09": "\t",
  "%0A": "\n",
  "%0D%0A": "\r\n",
  "%61%62%63": "abc",
  "%2F%3F%23": "/?#",
  "%7E": "~",
  "%E2%80%A0": "†",
  "%F4%8F%BF%BF": "\u{10FFFF}",
  "%ED%9F%BF": "\u{D7FF}",
  "%F0%9F%98%80%F0%9F%98%81": "\u{1F600}\u{1F601}",
  "%2525": "%25",
  "%E4%BD%A0%E5%A5%BD": "你好",
  "%E4%BD%A0%20%E5%A5%BD%21��": "你 好!��",
  "%F0%9D%84%9E": "\u{1D11E}",
};

const invalidTypes = {
  undefined: [undefined, "undefined"],
  null: [null, "object"],
  number: [5, "number"],
  "boolean true": [true, "boolean"],
  "boolean false": [false, "boolean"],
  "plain object": [{}, "object"],
  array: [[], "object"],
  symbol: [Symbol("x"), "symbol"],
  bigint: [0n, "bigint"],
  "boxed string": [Object("test"), "object"],
  "object with toString": [{ toString: () => "test%20" }, "object"],
};

function buildDistinctRuns(count) {
  let input = "";
  for (let index = 0; index < count; index++) {
    const high = Math.floor(index / 256).toString(16).padStart(2, "0");
    const low = (index % 256).toString(16).padStart(2, "0");
    input += `%${high}%${low}x`;
  }
  return `${input}%zz`;
}

function elapsedMilliseconds(run) {
  const start = performance.now();
  const result = run();
  return { result, elapsed: performance.now() - start };
}

for (const [group, cases] of Object.entries(decodingCases)) {
  describe(group, () => {
    for (const [input, expected] of Object.entries(cases)) {
      test(`${JSON.stringify(input)} -> ${JSON.stringify(expected)}`, () => {
        assert.equal(decodeUriComponent(input), expected);
      });
    }
  });
}

describe("matches native decodeURIComponent on valid input", () => {
  for (const [input, expected] of Object.entries(nativeParityCases)) {
    test(`${JSON.stringify(input)} -> ${JSON.stringify(expected)}`, () => {
      assert.equal(decodeUriComponent(input), expected);
      assert.equal(decodeUriComponent(input), decodeURIComponent(input));
    });
  }
});

describe("rejects non-string input", () => {
  for (const [title, [value, type]] of Object.entries(invalidTypes)) {
    test(title, () => {
      assert.throws(() => decodeUriComponent(value), {
        name: "TypeError",
        message: `Expected \`encodedURI\` to be of type \`string\`, got \`${type}\``,
      });
    });
  }
});

describe("denial of service resistance", () => {
  test("many distinct percent-encoded runs decode in linear time (GHSA-qr28-fpjm-wq7f)", () => {
    const { elapsed } = elapsedMilliseconds(() => decodeUriComponent(buildDistinctRuns(32_000)));
    assert.ok(elapsed < 1000, `took ${elapsed} ms`);
  });

  test("a long run of malformed bytes decodes in linear time (GHSA-vcc3-ghjq-m6fr)", () => {
    const input = `${"%C2%C3%E0%F0%80".repeat(40_000)}%zz`;
    const { result, elapsed } = elapsedMilliseconds(() => decodeUriComponent(input));
    assert.ok(elapsed < 1000, `took ${elapsed} ms`);
    assert.ok(result.endsWith("%zz"));
  });

  test("a long run of unmatched percent signs decodes in linear time", () => {
    const input = `${"%".repeat(200_000)}%E0%A4%A`;
    const { result, elapsed } = elapsedMilliseconds(() => decodeUriComponent(input));
    assert.ok(elapsed < 1000, `took ${elapsed} ms`);
    assert.equal(result, input);
  });
});

test("decodes one level per call", () => {
  assert.equal(decodeUriComponent("%2525"), "%25");
  assert.equal(decodeUriComponent("%25"), "%");
});

test("is idempotent once no percent-encoding remains", () => {
  for (const input of ["%25", "st%C3%A5le", "%C3%A5%ab", "%G0%C3%A5", "%"]) {
    const once = decodeUriComponent(input);
    assert.equal(decodeUriComponent(once), once, `double decode of ${input}`);
  }
});

test("exports the function itself for CommonJS require", () => {
  assert.equal(typeof decodeUriComponent, "function");
  assert.equal(decodeUriComponent.name, "decodeUriComponent");
});
