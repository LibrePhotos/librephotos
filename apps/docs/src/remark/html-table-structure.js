// @ts-check
/**
 * Remark plugin that makes raw HTML tables written in Markdown hydrate
 * cleanly under React 18+.
 *
 * Several docs pages (feature comparison, feature toggles, EXIF data) write
 * tables as raw HTML: `<table><tr>...` with no `<tbody>`, and the feature
 * comparison also puts `<p hidden>` column labels directly inside `<tr>`.
 * The browser's HTML parser fixes both up (it inserts a `<tbody>` and moves
 * the `<p>` elements out of the table), so the server-rendered DOM no longer
 * matches the React tree. React 17 patched that silently; React 18+ reports a
 * hydration error and re-renders the whole page on the client.
 *
 * Instead of editing every table, normalise them at build time:
 * - wrap `<tr>` rows that sit directly inside `<table>` in a `<tbody>`;
 * - drop `<p hidden>` elements inside `<tr>`. They are never visible; they
 *   only exist as labels for people editing the Markdown source.
 */

/** @param {any} node @param {string} name */
function isJsx(node, name) {
  return (
    node != null &&
    (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") &&
    node.name === name
  );
}

/** @param {any} node */
function isHiddenParagraph(node) {
  return (
    isJsx(node, "p") &&
    (node.attributes || []).some(
      (/** @type {any} */ attr) => attr.type === "mdxJsxAttribute" && attr.name === "hidden",
    )
  );
}

/** @param {any} table */
function wrapBareRows(table) {
  /** @type {any[]} */
  const children = [];
  /** @type {any} */
  let body = null;
  for (const child of table.children) {
    if (isJsx(child, "tr")) {
      if (!body) {
        body = { type: child.type, name: "tbody", attributes: [], children: [] };
        children.push(body);
      }
      body.children.push(child);
    } else {
      // {/* comments */} don't break a run of rows; anything else
      // (an explicit thead/tbody, say) does.
      if (child.type !== "mdxFlowExpression") body = null;
      children.push(child);
    }
  }
  table.children = children;
}

/** @param {any} node */
function walk(node) {
  if (!node || !Array.isArray(node.children)) return;
  if (isJsx(node, "tr")) {
    node.children = node.children.filter((/** @type {any} */ c) => !isHiddenParagraph(c));
  }
  if (isJsx(node, "table")) wrapBareRows(node);
  node.children.forEach(walk);
}

module.exports = function htmlTableStructure() {
  return (/** @type {any} */ tree) => walk(tree);
};
