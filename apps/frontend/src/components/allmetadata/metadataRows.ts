import type { RawMetadataFile, RawMetadataGroup, RawTagValue } from "@librephotos/api-client";

/** A row of the All metadata table: a group's header, or one tag of an open group. */
export type MetadataRow =
  | Readonly<{
      type: "group";
      key: string;
      name: string;
      family: string;
      /** Tags in the group. */
      total: number;
      /** Tags that match the filter (all of them without one). */
      matching: number;
      collapsed: boolean;
    }>
  | Readonly<{
      type: "tag";
      key: string;
      /** `IFD0:Make`: what the filter and Copy as JSON use. */
      fullName: string;
      name: string;
      value: string;
      /** ExifTool's `(Binary data N bytes, ...)` placeholder, shown in italics. */
      binary: boolean;
    }>;

export type MetadataTable = Readonly<{
  rows: MetadataRow[];
  /** Tags in the file. */
  total: number;
  /** Tags that match the filter. */
  matching: number;
}>;

const BINARY = /^\(Binary data \d+ bytes/;

/** A value as text: as ExifTool prints it; a list joined, a structure as JSON. */
export function formatTagValue(value: RawTagValue): string {
  if (value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value) && value.every(item => typeof item === "string" || typeof item === "number")) {
    return value.join(", ");
  }
  return JSON.stringify(value);
}

/** Whether a tag matches the filter: its `Group:Name` or its value contains the text, any case. */
function matches(fullName: string, value: string, query: string): boolean {
  return fullName.toLowerCase().includes(query) || value.toLowerCase().includes(query);
}

function tagRows(group: RawMetadataGroup, query: string): MetadataRow[] {
  const rows: MetadataRow[] = [];
  for (const [name, raw] of Object.entries(group.tags)) {
    const fullName = `${group.name}:${name}`;
    const value = formatTagValue(raw);
    if (query && !matches(fullName, value, query)) continue;
    rows.push({ type: "tag", key: `tag:${fullName}`, fullName, name, value, binary: BINARY.test(value) });
  }
  return rows;
}

/**
 * The rows of one file under a filter: each group with a match gets its header, followed by its
 * matching tags unless it is collapsed. While a filter is set every group with a match is open,
 * so a match is never hidden behind a closed header.
 */
export function buildRows(file: RawMetadataFile, filter: string, collapsed: ReadonlySet<string>): MetadataTable {
  const query = filter.trim().toLowerCase();
  const rows: MetadataRow[] = [];
  let total = 0;
  let matching = 0;
  for (const group of file.groups) {
    const groupTotal = Object.keys(group.tags).length;
    const tags = tagRows(group, query);
    total += groupTotal;
    matching += tags.length;
    if (query && tags.length === 0) continue;
    const isCollapsed = !query && collapsed.has(group.name);
    rows.push({
      type: "group",
      key: `group:${group.name}`,
      name: group.name,
      family: group.family,
      total: groupTotal,
      matching: tags.length,
      collapsed: isCollapsed,
    });
    if (!isCollapsed) rows.push(...tags);
  }
  return { rows, total, matching };
}

/** The groups that start closed: maker notes, often hundreds of tags no one looks for first. */
export function initiallyCollapsed(file: RawMetadataFile): Set<string> {
  return new Set(file.groups.filter(group => group.family === "MakerNotes").map(group => group.name));
}

/** Every group of the file, to close them all. */
export function allGroups(file: RawMetadataFile): Set<string> {
  return new Set(file.groups.map(group => group.name));
}

/** How many tags the file has. */
export function tagCount(file: RawMetadataFile): number {
  return file.groups.reduce((sum, group) => sum + Object.keys(group.tags).length, 0);
}

/**
 * The file as ExifTool's own `-json -G1` would print it: `SourceFile`, then `Group:Name` keys
 * with their values as they came (lists and structures kept).
 */
export function fileAsJson(file: RawMetadataFile): string {
  const tags: Record<string, RawTagValue> = { SourceFile: file.path_label };
  for (const group of file.groups) {
    for (const [name, value] of Object.entries(group.tags)) {
      tags[`${group.name}:${name}`] = value;
    }
  }
  return JSON.stringify(tags, null, 2);
}

/** The last part of a path the server sent with forward slashes. */
export function fileNameOfLabel(pathLabel: string): string {
  return pathLabel.split("/").pop() ?? pathLabel;
}
