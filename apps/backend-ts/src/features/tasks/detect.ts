// Pure media-category heuristics (port of lp_tasks::detect: Django's
// api/document_detection.py and api/screenshot_detection.py, rule for rule).

const DENSE_TEXT_AREA_FRACTION = 0.18;
const DENSE_TEXT_MIN_CHARS = 40;
const MODERATE_TEXT_AREA_FRACTION = 0.08;
const MODERATE_TEXT_MIN_CHARS = 20;

const STRONG_SIGLIP_LABELS = ["receipt", "document", "invoice", "business card", "identity document", "book page"];
const WEAK_SIGLIP_LABELS = ["ticket", "menu", "whiteboard", "handwritten note"];

const SYMBOLS = "[$€£¥₹₩₽]";
const AMOUNT = String.raw`\d(?:[\d.,]*\d)?`;
const CURRENCY_RE = new RegExp(`${SYMBOLS}\\s?${AMOUNT}|${AMOUNT}\\s?${SYMBOLS}`, "u");
// Python's \b is Unicode-aware: a word boundary between \w (letters of any
// script, digits, _) and anything else.
const W = String.raw`[\p{L}\p{N}_]`;
const TOTAL_KEYWORD_RE = new RegExp(
  String.raw`(?<!${W})(?:TOTAL|SUBTOTAL|SUMME|GESAMT|MWST|TVA|IVA|TOTAAL|ИТОГО)(?!${W})|合計|小計`,
  "iu",
);

const contentLength = (text: string | null | undefined) => (text ? [...text].filter((c) => !/\s/u.test(c)).length : 0);

export const hasCurrencyAmount = (text: string | null | undefined) => !!text && CURRENCY_RE.test(text);
export const hasTotalKeyword = (text: string | null | undefined) => !!text && TOTAL_KEYWORD_RE.test(text);

/** `classify_document`: a strong SigLIP label alone, else two distinct medium/weak signals. */
export function classifyDocument(ocrText: string | null | undefined, textAreaFraction: number | null | undefined, siglipLabels: string[]): boolean {
  const labels = siglipLabels.map((l) => l.toLowerCase());
  const has = (set: string[]) => labels.some((l) => set.includes(l));
  const fraction = textAreaFraction ?? 0;
  const chars = contentLength(ocrText);
  if (has(STRONG_SIGLIP_LABELS)) return true;
  const denseText = fraction >= DENSE_TEXT_AREA_FRACTION && chars >= DENSE_TEXT_MIN_CHARS;
  const receipt = hasCurrencyAmount(ocrText) && hasTotalKeyword(ocrText);
  const weakSiglip = has(WEAK_SIGLIP_LABELS);
  const moderateText = fraction >= MODERATE_TEXT_AREA_FRACTION && chars >= MODERATE_TEXT_MIN_CHARS && !denseText;
  return [denseText, receipt, weakSiglip, moderateText].filter(Boolean).length >= 2;
}

const SCREENSHOT_PREFIXES = [
  "screenshot",
  "screen shot",
  "bildschirmfoto",
  "captura de pantalla",
  "capture d'ecran",
  "снимок экрана",
  "スクリーンショット",
];

export interface ScreenshotInput {
  main_path: string | null;
  has_metadata: boolean;
  camera_model: string | null;
  aperture: number | null;
  iso: number | null;
  focal_length: number | null;
  photo_gps: boolean;
  metadata_gps: boolean;
}

const normalize = (t: string) => t.toLowerCase().replace(/’/g, "'").replace(/[_-]/g, " ");

function matchesPrefix(basename: string): boolean {
  const n = normalize(basename);
  return SCREENSHOT_PREFIXES.some((p) => n.startsWith(p) && !/^\p{L}/u.test(n.slice(p.length)));
}

/** os.path.basename on Windows (either separator). */
export const basename = (p: string) => p.split(/[\\/]/).pop() ?? p;

/** os.path.splitext(path)[1].lower(): leading dots of the name are not an extension. */
export function extensionLower(p: string): string {
  const name = basename(p);
  const stemStart = name.length - name.replace(/^\.+/, "").length;
  const i = name.slice(stemStart).lastIndexOf(".");
  return i < 0 ? "" : name.slice(stemStart + i).toLowerCase();
}

export function isScreenshot(photo: ScreenshotInput): boolean {
  const p = photo.main_path ?? "";
  if (p) {
    if (matchesPrefix(basename(p))) return true;
    // Only parent directories count: every part but the last.
    const parts = p.split(/[\\/]/);
    if (parts.slice(0, -1).some((x) => x.toLowerCase() === "screenshots")) return true;
  }
  if (extensionLower(p) !== ".png") return false;
  if (photo.has_metadata) {
    const camera =
      !!photo.camera_model ||
      (photo.aperture !== null && photo.aperture !== 0) ||
      (photo.iso !== null && photo.iso !== 0) ||
      (photo.focal_length !== null && photo.focal_length !== 0);
    if (camera) return false;
  }
  if (photo.photo_gps || (photo.has_metadata && photo.metadata_gps)) return false;
  return true;
}
