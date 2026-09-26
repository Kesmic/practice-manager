/**
 * A small PDF writer: pages of positioned text, rules, filled boxes and one kind of
 * picture, which is everything an invoice is.
 *
 * Written here rather than taken from a library for the reason the rest of the portal
 * has no runtime dependencies: a general PDF library is several hundred kilobytes of
 * font parsing, forms and encryption carried into every request the Worker serves, to
 * draw one table. This draws the table.
 *
 * What it does, and deliberately no more:
 *
 *  - Text in Helvetica and Helvetica Bold, two of the standard fonts every PDF reader
 *    has, so no font is embedded. They cover WinAnsi - English, the Western European
 *    accents, curly quotes, dashes, the euro - and anything outside it is spelt as
 *    near as it can be (an Akan ɛ as e, a cedi sign as C) rather than dropped or
 *    turned into a box. See toWinAnsi.
 *  - Lines, filled rectangles, fill and stroke colours, character spacing.
 *  - JPEG and PNG pictures (the firm's logo), PNG transparency included.
 *  - Page contents compressed, a document information dictionary, and a correct
 *    cross-reference table - checked by the tests against a real PDF reader.
 *
 * Coordinates are in points from the top-left of the page, the way a layout is
 * thought about; the writer turns them into PDF's bottom-left space.
 *
 * Every string is written as hex, so nothing in an invoice - a client called
 * "Smith (Holdings) \ Ltd", say - can close a string early and become an instruction.
 */

import { HELVETICA_BOLD_WIDTHS, HELVETICA_WIDTHS, WIN_ANSI_SPECIAL } from "./pdf-fonts";

export type PdfFont = "regular" | "bold";

/** An RGB colour as "#1b2431". */
export type PdfColour = string;

/** A4, in points. */
export const A4 = { width: 595.28, height: 841.89 };

/**
 * Letters outside WinAnsi that have an obvious nearest spelling. Ghanaian names and
 * places are the reason for most of these: Akan writes ɛ and ɔ, and "Asɔrɔ" set as
 * "Asoro" is legible where "As?r?" is not.
 */
const NEAREST: Record<string, string> = {
  "ɛ": "e", "Ɛ": "E", "ɔ": "o", "Ɔ": "O", "ŋ": "n", "Ŋ": "N", "ɖ": "d", "Ɖ": "D",
  "ƒ": "f", "ʋ": "v", "Ʋ": "V", "ɣ": "g", "Ɣ": "G", "ı": "i", "ł": "l", "Ł": "L",
  "đ": "d", "Đ": "D", "ø": "o", "ß": "ss",
  "₵": "C", "‐": "-", "‑": "-", "‒": "-", "−": "-",
  " ": " ", " ": " ", " ": " ", " ": " ", "\t": " ",
  "′": "'", "″": "\"",
};

/** One character as a WinAnsi code, or null when it has none. */
function winAnsiCode(cp: number): number | null {
  if ((cp >= 32 && cp <= 126) || (cp >= 160 && cp <= 255)) return cp;
  return WIN_ANSI_SPECIAL[cp] ?? null;
}

/**
 * Text as the bytes Helvetica can show. Line breaks become spaces - a caller that
 * wants lines splits them first - and anything else without a code is spelt as near
 * as it can be: from the table above, then by dropping accents, then as "?".
 */
export function toWinAnsi(text: string): number[] {
  const out: number[] = [];
  for (const ch of text.normalize("NFC").replace(/[\r\n]+/g, " ")) {
    const direct = winAnsiCode(ch.codePointAt(0)!);
    if (direct !== null) {
      out.push(direct);
      continue;
    }
    const near = NEAREST[ch] ?? ch.normalize("NFKD").replace(/[̀-ͯ]/g, "");
    let any = false;
    for (const part of near) {
      const code = winAnsiCode(part.codePointAt(0)!);
      if (code !== null) {
        out.push(code);
        any = true;
      }
    }
    if (!any) out.push(0x3f);
  }
  return out;
}

/** How wide a piece of text is, in points. */
export function textWidth(text: string, font: PdfFont, size: number, spacing = 0): number {
  const widths = font === "bold" ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS;
  const codes = toWinAnsi(text);
  let units = 0;
  for (const code of codes) units += widths[code - 32] ?? 556;
  return (units * size) / 1000 + spacing * codes.length;
}

/**
 * Breaks text into lines no wider than `width`. Paragraph breaks in the text are kept;
 * a word too long for a line on its own is broken where it has to be.
 */
export function wrapText(text: string, font: PdfFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, "\n").split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (textWidth(candidate, font, size) <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      // A word wider than the whole line: break it by characters.
      let rest = word;
      while (textWidth(rest, font, size) > width) {
        let cut = rest.length - 1;
        while (cut > 1 && textWidth(rest.slice(0, cut), font, size) > width) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line);
  }
  // Trailing blank lines say nothing on a printed page.
  while (lines.length > 1 && !lines[lines.length - 1]) lines.pop();
  return lines;
}

function hex(bytes: ArrayLike<number>): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
  return s;
}

function num(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function rgb(colour: PdfColour): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(colour);
  const [r, g, b] = m ? [m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255) : [0, 0, 0];
  return `${num(r)} ${num(g)} ${num(b)}`;
}

/** A picture ready to place: a JPEG as it came, or pixels to be compressed. */
export type PdfImage =
  | { kind: "jpeg"; width: number; height: number; components: 1 | 3 | 4; data: Uint8Array }
  | { kind: "pixels"; width: number; height: number; rgb: Uint8Array; alpha: Uint8Array | null };

/** One page's drawing instructions. */
export class PdfPage {
  readonly ops: string[] = [];
  readonly images = new Set<number>();

  constructor(readonly height: number) {}

  /** Text with its baseline at `y`, starting at `x` - or ending there, with align "right". */
  text(
    value: string,
    x: number,
    y: number,
    options: {
      font?: PdfFont;
      size: number;
      colour?: PdfColour;
      spacing?: number;
      align?: "left" | "right" | "centre";
    },
  ): void {
    if (!value) return;
    const font = options.font ?? "regular";
    const spacing = options.spacing ?? 0;
    const width = textWidth(value, font, options.size, spacing);
    const left =
      options.align === "right" ? x - width + spacing : options.align === "centre" ? x - width / 2 : x;
    this.ops.push(
      "BT",
      `/${font === "bold" ? "F2" : "F1"} ${num(options.size)} Tf`,
      `${rgb(options.colour ?? "#000000")} rg`,
      `${num(spacing)} Tc`,
      `${num(left)} ${num(this.height - y)} Td`,
      `<${hex(toWinAnsi(value))}> Tj`,
      "ET",
    );
  }

  /** A straight line. */
  line(x1: number, y1: number, x2: number, y2: number, options: { width?: number; colour?: PdfColour } = {}): void {
    this.ops.push(
      `${rgb(options.colour ?? "#000000")} RG`,
      `${num(options.width ?? 1)} w`,
      `${num(x1)} ${num(this.height - y1)} m ${num(x2)} ${num(this.height - y2)} l S`,
    );
  }

  /** A filled rectangle, `y` being its top edge. */
  box(x: number, y: number, width: number, height: number, colour: PdfColour): void {
    this.ops.push(`${rgb(colour)} rg`, `${num(x)} ${num(this.height - y - height)} ${num(width)} ${num(height)} re f`);
  }

  /** A picture already added to the document, `y` being its top edge. */
  image(index: number, x: number, y: number, width: number, height: number): void {
    this.images.add(index);
    this.ops.push("q", `${num(width)} 0 0 ${num(height)} ${num(x)} ${num(this.height - y - height)} cm`, `/Im${index} Do`, "Q");
  }
}

/** Deflate, as PDF's FlateDecode expects it (zlib-wrapped). */
async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Inflate, the reverse. Used to read a PNG. */
export async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const latin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);

/** Text for the information dictionary, which may be any language: UTF-16 with a mark. */
function infoString(value: string): string {
  const units = [0xfe, 0xff];
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    units.push(c >> 8, c & 0xff);
  }
  return `<${hex(units)}>`;
}

/** "D:20260926143000Z", PDF's way of writing a moment. */
function pdfDate(date: Date): string {
  return `D:${date.toISOString().replace(/[-:T]/g, "").slice(0, 14)}Z`;
}

/** A document: some pages, some pictures, a title. */
export class PdfDocument {
  readonly pages: PdfPage[] = [];
  readonly images: PdfImage[] = [];

  constructor(
    readonly info: { title: string; author: string; subject?: string },
    readonly size = A4,
  ) {}

  addPage(): PdfPage {
    const page = new PdfPage(this.size.height);
    this.pages.push(page);
    return page;
  }

  addImage(image: PdfImage): number {
    this.images.push(image);
    return this.images.length - 1;
  }

  /** The finished file. */
  async save(now = new Date()): Promise<Uint8Array<ArrayBuffer>> {
    const objects: Array<Uint8Array> = [];
    const reserve = () => objects.push(new Uint8Array()) ; // returns new length = id
    const set = (id: number, body: string | Uint8Array[]) => {
      objects[id - 1] =
        typeof body === "string"
          ? latin1(`${id} 0 obj\n${body}\nendobj\n`)
          : concat([latin1(`${id} 0 obj\n`), ...body, latin1("\nendobj\n")]);
    };
    const stream = (dict: string, data: Uint8Array): Uint8Array[] => [
      latin1(`<< ${dict} /Length ${data.length} >>\nstream\n`),
      data,
      latin1("\nendstream"),
    ];

    const catalog = reserve();
    const pagesId = reserve();
    const regular = reserve();
    const bold = reserve();
    const infoId = reserve();

    set(regular, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    set(bold, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    set(
      infoId,
      `<< /Title ${infoString(this.info.title)} /Author ${infoString(this.info.author)}${
        this.info.subject ? ` /Subject ${infoString(this.info.subject)}` : ""
      } /Producer ${infoString("Kesmic Practice Manager")} /CreationDate (${pdfDate(now)}) >>`,
    );

    // Pictures, each with its transparency as a soft mask when it has any.
    const imageIds: number[] = [];
    for (const image of this.images) {
      const id = reserve();
      imageIds.push(id);
      if (image.kind === "jpeg") {
        const space = image.components === 1 ? "/DeviceGray" : image.components === 4 ? "/DeviceCMYK" : "/DeviceRGB";
        // Adobe writes CMYK JPEGs inverted; the decode array puts them right.
        const decode = image.components === 4 ? " /Decode [1 0 1 0 1 0 1 0]" : "";
        set(id, stream(`/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace ${space} /BitsPerComponent 8 /Filter /DCTDecode${decode}`, image.data));
      } else {
        let mask = "";
        if (image.alpha) {
          const maskId = reserve();
          set(maskId, stream(`/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`, await deflate(image.alpha)));
          mask = ` /SMask ${maskId} 0 R`;
        }
        set(id, stream(`/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode${mask}`, await deflate(image.rgb)));
      }
    }

    const pageIds: number[] = [];
    for (const page of this.pages) {
      const contentId = reserve();
      const pageId = reserve();
      pageIds.push(pageId);
      set(contentId, stream("/Filter /FlateDecode", await deflate(latin1(page.ops.join("\n")))));
      const xobjects = [...page.images].map((i) => `/Im${i} ${imageIds[i]} 0 R`).join(" ");
      set(
        pageId,
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(this.size.width)} ${num(this.size.height)}] ` +
          `/Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >>${xobjects ? ` /XObject << ${xobjects} >>` : ""} >> ` +
          `/Contents ${contentId} 0 R >>`,
      );
    }
    set(pagesId, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
    set(catalog, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

    // The header's second line is binary, so tools that sniff for text leave it alone.
    const header = concat([latin1("%PDF-1.4\n%"), Uint8Array.from([0xe2, 0xe3, 0xcf, 0xd3]), latin1("\n")]);
    const offsets: number[] = [];
    let at = header.length;
    for (const obj of objects) {
      offsets.push(at);
      at += obj.length;
    }
    const xref =
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
      offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("") +
      `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${infoId} 0 R >>\nstartxref\n${at}\n%%EOF\n`;
    return concat([header, ...objects, latin1(xref)]);
  }
}

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pictures
// ---------------------------------------------------------------------------

/**
 * A logo from its data URI, ready for a page - or null for a kind a PDF cannot show
 * without a renderer (SVG, WebP, GIF, an interlaced PNG), in which case the document
 * sets the firm's name in its place.
 */
export async function imageFromDataUri(uri: string): Promise<PdfImage | null> {
  const m = /^data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/=]+)$/.exec(uri.trim());
  if (!m) return null;
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
  try {
    return m[1] === "png" ? await readPng(bytes) : readJpeg(bytes);
  } catch {
    return null;
  }
}

/** A JPEG's size and colour, from its frame header. The data goes in unchanged. */
export function readJpeg(bytes: Uint8Array): PdfImage | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    // Start-of-frame markers: C0-CF, except C4 (tables), C8 (reserved), CC (arithmetic).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = (bytes[i + 5] << 8) | bytes[i + 6];
      const width = (bytes[i + 7] << 8) | bytes[i + 8];
      const components = bytes[i + 9];
      if (!width || !height || ![1, 3, 4].includes(components)) return null;
      return { kind: "jpeg", width, height, components: components as 1 | 3 | 4, data: bytes };
    }
    i += 2 + length;
  }
  return null;
}

/**
 * A PNG as plain pixels and, when it has any, its transparency. Handles what logos
 * are saved as - greyscale, colour and palette, with or without transparency, eight
 * bits a channel or fewer for a palette - and declines the rest.
 */
export async function readPng(bytes: Uint8Array): Promise<PdfImage | null> {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((b, i) => bytes[i] === b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0, depth = 0, colourType = 0, interlace = 0;
  let palette: Uint8Array | null = null;
  let paletteAlpha: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  for (let i = 8; i + 8 <= bytes.length; ) {
    const length = view.getUint32(i);
    const type = String.fromCharCode(...bytes.subarray(i + 4, i + 8));
    const data = bytes.subarray(i + 8, i + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(i + 8);
      height = view.getUint32(i + 12);
      depth = data[8];
      colourType = data[9];
      interlace = data[12];
    } else if (type === "PLTE") palette = data;
    else if (type === "tRNS") paletteAlpha = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    i += 12 + length;
  }
  if (!width || !height || interlace !== 0 || width * height > 4_000_000) return null;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colourType as 0 | 2 | 3 | 4 | 6];
  if (!channels) return null;
  if (colourType === 3 ? ![1, 2, 4, 8].includes(depth) || !palette : depth !== 8) return null;

  const raw = await inflate(concat(idat));
  const bitsPerPixel = channels * depth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const pixels = new Uint8Array(stride * height);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[x] = v & 0xff;
    }
    prev = out;
  }

  const rgb = new Uint8Array(width * height * 3);
  const alpha = new Uint8Array(width * height);
  let transparent = false;
  for (let y = 0; y < height; y++) {
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 3;
      let r: number, g: number, b: number, a = 255;
      if (colourType === 3) {
        const index = (row[(x * depth) >> 3] >> (8 - depth - ((x * depth) & 7))) & ((1 << depth) - 1);
        r = palette![index * 3] ?? 0;
        g = palette![index * 3 + 1] ?? 0;
        b = palette![index * 3 + 2] ?? 0;
        a = paletteAlpha && index < paletteAlpha.length ? paletteAlpha[index] : 255;
      } else if (colourType === 0) {
        r = g = b = row[x];
      } else if (colourType === 4) {
        r = g = b = row[x * 2];
        a = row[x * 2 + 1];
      } else if (colourType === 2) {
        r = row[x * 3]; g = row[x * 3 + 1]; b = row[x * 3 + 2];
      } else {
        r = row[x * 4]; g = row[x * 4 + 1]; b = row[x * 4 + 2];
        a = row[x * 4 + 3];
      }
      rgb[o] = r; rgb[o + 1] = g; rgb[o + 2] = b;
      alpha[y * width + x] = a;
      if (a !== 255) transparent = true;
    }
  }
  return { kind: "pixels", width, height, rgb, alpha: transparent ? alpha : null };
}
