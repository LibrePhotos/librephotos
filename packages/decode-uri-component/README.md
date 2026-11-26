# @librephotos/decode-uri-component

A CommonJS port of [decode-uri-component](https://github.com/SamVerschueren/decode-uri-component) 0.5.1
(MIT, see `LICENSE`), installed in place of decode-uri-component 0.2.2 for the mobile app.

## Why it exists

Expo SDK 57's `expo-router` depends on `query-string` 7, which loads `decode-uri-component` with
`require()`. Version 0.2.2 has two denial-of-service advisories: GHSA-qr28-fpjm-wq7f (quadratic
replacement, fixed in 0.5.1) and GHSA-vcc3-ghjq-m6fr (exponential decoding, fixed in 0.5.0). The fixed
versions are ESM-only, so `query-string` 7 cannot `require()` them, and `query-string` 8 and later are
ESM-only too and break `expo-router`, which calls `queryString.parse` on a CommonJS import.

The root `package.json` depends on this package under the name `decode-uri-component` and its
`overrides` hand that copy to `query-string` (`"$decode-uri-component"`). A `file:` spec inside
`overrides` does not work: npm resolves it relative to the overridden package and writes
`node_modules/query-string/packages/...` into the lockfile.

`src/index.js` is the upstream 0.5.1 algorithm unchanged, as `module.exports` instead of a default
export. `src/index.test.js` carries the upstream test cases plus time-bound DoS cases, and
`apps/mobile/src/lib/deepLinkQuery.test.ts` checks that `expo-router` parses deep link queries through it.

## When to delete it

Delete this package, the `decode-uri-component` dependency and the `query-string` override in the root
`package.json`, then run `npm install`, as soon as `expo-router` no longer depends on `query-string`
(Expo SDK 58). `npm ls decode-uri-component` must then print nothing.

## Checks

```bash
npm run test --workspace packages/decode-uri-component
```
