/**
 * Reads the first sheet of an Excel workbook (.xlsx) into rows of cells.
 *
 * Enough for a report exported from QuickBooks or any accounting system: text, numbers,
 * shared strings and inline strings, in the cell positions the file gives them. No
 * formulas are worked out (an export carries their results), no styles are read, and
 * nothing in the file is ever run.
 *
 * An .xlsx file is a zip of XML. The zip is read from its central directory, entries
 * are inflated with the platform's own DecompressionStream, and the two XML files that
 * matter are read with patterns rather than a DOM, so the same code runs in a browser,
 * in the Worker and under the tests. The older .xls format is a different thing
 * altogether and is refused, with a sentence saying how to get an .xlsx instead.
 */

import type { Cell } from "./quickbooks-import";

const MAX_ENTRY = 40 * 1024 * 1024;

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The files inside a zip, by name, read lazily. */
function zipEntries(bytes: Uint8Array): Map<string, () => Promise<Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end-of-central-directory record is in the last 64 kB (after any comment).
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("not a zip");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const entries = new Map<string, () => Promise<Uint8Array>>();
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error("bad zip directory");
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    entries.set(name, async () => {
      if (view.getUint32(local, true) !== 0x04034b50) throw new Error("bad zip entry");
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const data = bytes.subarray(start, start + size);
      if (method === 0) return data;
      if (method !== 8) throw new Error("unsupported compression");
      const out = await inflateRaw(data);
      if (out.length > MAX_ENTRY) throw new Error("too large");
      return out;
    });
  }
  return entries;
}

function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    const lower = e.toLowerCase();
    if (lower === "amp") return "&";
    if (lower === "lt") return "<";
    if (lower === "gt") return ">";
    if (lower === "quot") return '"';
    if (lower === "apos") return "'";
    const code = lower.startsWith("#x") ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : "";
  });
}

/** All the text runs inside one piece of XML, joined - rich text included. */
function textOf(xml: string): string {
  let out = "";
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += m[1];
  return unescapeXml(out);
}

/** "B5" -> column 1. */
function columnOf(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** The first sheet of a workbook, as rows of cells. */
export async function readFirstSheet(bytes: Uint8Array): Promise<Cell[][]> {
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) {
    throw new Error(
      "That is an old-style Excel file (.xls). Open it in Excel and save it as .xlsx, or export the report from QuickBooks again as Excel.",
    );
  }
  let entries: Map<string, () => Promise<Uint8Array>>;
  try {
    entries = zipEntries(bytes);
  } catch {
    throw new Error("That file could not be read as an Excel workbook (.xlsx).");
  }
  const decoder = new TextDecoder();
  const read = async (name: string) => {
    const entry = entries.get(name);
    return entry ? decoder.decode(await entry()) : null;
  };

  // The first sheet in the workbook's own order, through its relationship id.
  let sheetPath = "xl/worksheets/sheet1.xml";
  const workbook = await read("xl/workbook.xml");
  const rels = await read("xl/_rels/workbook.xml.rels");
  const firstId = workbook ? /<sheet\b[^>]*\br:id="([^"]+)"/.exec(workbook)?.[1] : undefined;
  if (firstId && rels) {
    const target = new RegExp(`<Relationship\\b[^>]*\\bId="${firstId}"[^>]*\\bTarget="([^"]+)"`).exec(rels)?.[1]
      ?? new RegExp(`<Relationship\\b[^>]*\\bTarget="([^"]+)"[^>]*\\bId="${firstId}"`).exec(rels)?.[1];
    if (target) sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  }
  const sheet = await read(sheetPath);
  if (!sheet) throw new Error("That workbook has no sheet to read.");

  const shared: string[] = [];
  const strings = await read("xl/sharedStrings.xml");
  if (strings) for (const m of strings.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]));

  const rows: Cell[][] = [];
  for (const rowMatch of sheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const r = Number(/\br="(\d+)"/.exec(rowMatch[1])?.[1] ?? rows.length + 1) - 1;
    const row: Cell[] = [];
    let next = 0;
    for (const c of rowMatch[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const col = ref ? columnOf(ref) : next;
      next = col + 1;
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? "n";
      const body = c[2] ?? "";
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value: Cell = null;
      if (type === "s") value = v !== undefined ? (shared[Number(v)] ?? "") : "";
      else if (type === "inlineStr") value = textOf(body);
      else if (type === "str" || type === "e") value = v !== undefined ? unescapeXml(v) : "";
      else if (type === "b") value = v === "1" ? "TRUE" : "FALSE";
      else if (v !== undefined && v !== "") value = Number(v);
      while (row.length < col) row.push(null);
      row[col] = value;
    }
    while (rows.length < r) rows.push([]);
    rows[r] = row;
  }
  return rows;
}
