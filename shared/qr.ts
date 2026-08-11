/**
 * QR code generation, byte mode, versions 1 to 10.
 *
 * This exists because enrolling a second factor by hand means reading 32 characters off
 * one screen and typing them into a phone, and the people doing it are partners at the
 * end of a working day. A wrong character produces a code that never verifies, with
 * nothing to say why. A QR code removes the transcription entirely.
 *
 * Written out rather than taken from a library because the artifact is served from a
 * Worker with a strict content policy and no CDN, and because a QR encoder is a closed
 * problem: the specification is fixed, and the output can be checked against an
 * independent implementation, which it has been for every version and mask this
 * supports.
 *
 * Scope is deliberate. Byte mode only, because the payload is a URI. Error correction L
 * and M only. Versions to 10, which is 271 bytes at level L, against the roughly 155 a
 * long firm name and email address produce, so there is room without the version
 * information blocks that begin at 7 being the only headroom.
 */

/** Error correction level. L recovers about 7%, M about 15%. */
export type EcLevel = "L" | "M";

/**
 * Total codewords, data plus error correction, for versions 1 to 10.
 *
 * Not used to encode anything: it is what the block table below is checked against, so
 * a mistyped row is caught here rather than as a QR code no scanner will read.
 */
export const TOTAL_CODEWORDS = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346];

interface BlockSpec {
  /** Error correction codewords in every block. */
  ecPerBlock: number;
  /** [blockCount, dataCodewordsPerBlock] for the first, shorter group. */
  group1: [number, number];
  /** The second group, one data codeword longer, where a version has one. */
  group2?: [number, number];
}

/**
 * Block structure per version and level, from the tables in ISO/IEC 18004.
 *
 * Each row is checked by the tests against the total codewords for its version: a typo
 * here would produce a QR code that scanners reject, and the arithmetic catches it.
 */
const BLOCKS: Record<EcLevel, BlockSpec[]> = {
  L: [
    { ecPerBlock: 7, group1: [1, 19] },
    { ecPerBlock: 10, group1: [1, 34] },
    { ecPerBlock: 15, group1: [1, 55] },
    { ecPerBlock: 20, group1: [1, 80] },
    { ecPerBlock: 26, group1: [1, 108] },
    { ecPerBlock: 18, group1: [2, 68] },
    { ecPerBlock: 20, group1: [2, 78] },
    { ecPerBlock: 24, group1: [2, 97] },
    { ecPerBlock: 30, group1: [2, 116] },
    { ecPerBlock: 18, group1: [2, 68], group2: [2, 69] },
  ],
  M: [
    { ecPerBlock: 10, group1: [1, 16] },
    { ecPerBlock: 16, group1: [1, 28] },
    { ecPerBlock: 26, group1: [1, 44] },
    { ecPerBlock: 18, group1: [2, 32] },
    { ecPerBlock: 24, group1: [2, 43] },
    { ecPerBlock: 16, group1: [4, 27] },
    { ecPerBlock: 18, group1: [4, 31] },
    { ecPerBlock: 22, group1: [2, 38], group2: [2, 39] },
    { ecPerBlock: 22, group1: [3, 36], group2: [2, 37] },
    { ecPerBlock: 26, group1: [4, 43], group2: [1, 44] },
  ],
};

/** Centres of the alignment patterns, per version. */
const ALIGNMENT: number[][] = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

/** The 18-bit version information, needed from version 7 upwards. */
const VERSION_INFO: Record<number, number> = {
  7: 0x07c94,
  8: 0x085bc,
  9: 0x09a99,
  10: 0x0a4d3,
};

function dataCodewords(version: number, level: EcLevel): number {
  const spec = BLOCKS[level][version - 1];
  const [count1, size1] = spec.group1;
  const [count2, size2] = spec.group2 ?? [0, 0];
  return count1 * size1 + count2 * size2;
}

/** How many bytes fit, allowing for the mode indicator and the length field. */
export function byteCapacity(version: number, level: EcLevel): number {
  // Four bits of mode, then 8 bits of length below version 10 and 16 from 10 up.
  const headerBits = 4 + (version >= 10 ? 16 : 8);
  return Math.floor((dataCodewords(version, level) * 8 - headerBits) / 8);
}

/** The smallest version that holds this much data, or null if none of them do. */
export function versionFor(byteLength: number, level: EcLevel): number | null {
  for (let version = 1; version <= 10; version++) {
    if (byteCapacity(version, level) >= byteLength) return version;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Reed-Solomon over GF(256)
// ---------------------------------------------------------------------------

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    // Multiply by 2 in the field of the QR specification, modulus 0x11d.
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

/** The generator polynomial for the given number of error correction codewords. */
function generatorPoly(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** The error correction codewords for one block. */
function ecCodewords(data: Uint8Array, count: number): Uint8Array {
  const generator = generatorPoly(count);
  const remainder = new Uint8Array(data.length + count);
  remainder.set(data);
  for (let i = 0; i < data.length; i++) {
    const factor = remainder[i];
    if (factor === 0) continue;
    for (let j = 0; j < generator.length; j++) {
      remainder[i + j] ^= gfMul(generator[j], factor);
    }
  }
  return remainder.slice(data.length);
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

/** Mode indicator, length, payload, terminator and padding, as a bit string. */
function encodeData(bytes: Uint8Array, version: number, level: EcLevel): Uint8Array {
  const capacityBits = dataCodewords(version, level) * 8;
  const bits: number[] = [];
  const push = (value: number, width: number) => {
    for (let i = width - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };

  push(0b0100, 4); // byte mode
  push(bytes.length, version >= 10 ? 16 : 8);
  for (const byte of bytes) push(byte, 8);

  // Terminator, up to four zero bits, then zeros to the next byte boundary.
  for (let i = 0; i < 4 && bits.length < capacityBits; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    codewords.push(byte);
  }

  // Pad bytes, alternating, as the specification requires.
  const pad = [0xec, 0x11];
  let index = 0;
  while (codewords.length < capacityBits / 8) {
    codewords.push(pad[index++ % 2]);
  }
  return new Uint8Array(codewords);
}

/** Splits into blocks, adds error correction, and interleaves both. */
function interleave(data: Uint8Array, version: number, level: EcLevel): Uint8Array {
  const spec = BLOCKS[level][version - 1];
  const [count1, size1] = spec.group1;
  const [count2, size2] = spec.group2 ?? [0, 0];

  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;
  for (let i = 0; i < count1 + count2; i++) {
    const size = i < count1 ? size1 : size2;
    const block = data.slice(offset, offset + size);
    offset += size;
    dataBlocks.push(block);
    ecBlocks.push(ecCodewords(block, spec.ecPerBlock));
  }

  const out: number[] = [];
  const longest = Math.max(size1, size2);
  for (let i = 0; i < longest; i++) {
    for (const block of dataBlocks) if (i < block.length) out.push(block[i]);
  }
  for (let i = 0; i < spec.ecPerBlock; i++) {
    for (const block of ecBlocks) out.push(block[i]);
  }
  return new Uint8Array(out);
}

// ---------------------------------------------------------------------------
// The module grid
// ---------------------------------------------------------------------------

/** -1 unset, 0 light, 1 dark. A second grid marks the function patterns. */
interface Grid {
  size: number;
  modules: Int8Array;
  reserved: Uint8Array;
}

function makeGrid(version: number): Grid {
  const size = version * 4 + 17;
  return {
    size,
    modules: new Int8Array(size * size).fill(-1),
    reserved: new Uint8Array(size * size),
  };
}

const at = (grid: Grid, x: number, y: number) => y * grid.size + x;

function setFunction(grid: Grid, x: number, y: number, dark: boolean) {
  grid.modules[at(grid, x, y)] = dark ? 1 : 0;
  grid.reserved[at(grid, x, y)] = 1;
}

function placeFinder(grid: Grid, x0: number, y0: number) {
  // The 7x7 finder, plus the separator around it where that falls inside the grid.
  for (let dy = -1; dy <= 7; dy++) {
    for (let dx = -1; dx <= 7; dx++) {
      const x = x0 + dx;
      const y = y0 + dy;
      if (x < 0 || y < 0 || x >= grid.size || y >= grid.size) continue;
      /*
        Distance from the centre, as a square ring. A finder is a 3x3 dark core, a 5x5
        light ring around it, and a 7x7 dark border, with the separator outside that:
        so rings 0 and 1 are the core, ring 2 is light, ring 3 is the border, and ring 4
        is the separator.
      */
      const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
      setFunction(grid, x, y, ring <= 1 || ring === 3);
    }
  }
}

function placeFunctionPatterns(grid: Grid, version: number) {
  placeFinder(grid, 0, 0);
  placeFinder(grid, grid.size - 7, 0);
  placeFinder(grid, 0, grid.size - 7);

  // Timing patterns, alternating along row and column 6.
  for (let i = 8; i < grid.size - 8; i++) {
    setFunction(grid, i, 6, i % 2 === 0);
    setFunction(grid, 6, i, i % 2 === 0);
  }

  // Alignment patterns, skipping the three that would sit on a finder.
  const centres = ALIGNMENT[version - 1];
  for (const cy of centres) {
    for (const cx of centres) {
      const onFinder =
        (cx === 6 && cy === 6) ||
        (cx === 6 && cy === grid.size - 7) ||
        (cx === grid.size - 7 && cy === 6);
      if (onFinder) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const ring = Math.max(Math.abs(dx), Math.abs(dy));
          setFunction(grid, cx + dx, cy + dy, ring !== 1);
        }
      }
    }
  }

  /*
    Reserve the format areas, written properly once the mask is chosen.

    The second copy of the format information is 8 modules along row 8 from the right
    edge, but only 7 up column 8 from the bottom. The eighth position up that column is
    the module that is always dark, which is why it is set afterwards: reserving 8 here
    instead of 7 overwrote it, and one wrong module in the format area is enough for a
    scanner to give up on the whole code.
  */
  for (let i = 0; i < 9; i++) {
    if (!grid.reserved[at(grid, i, 8)]) setFunction(grid, i, 8, false);
    if (!grid.reserved[at(grid, 8, i)]) setFunction(grid, 8, i, false);
  }
  for (let i = 0; i < 8; i++) setFunction(grid, grid.size - 1 - i, 8, false);
  for (let i = 0; i < 7; i++) setFunction(grid, 8, grid.size - 1 - i, false);

  // The one module that is always dark.
  setFunction(grid, 8, grid.size - 8, true);

  // And the version areas, from version 7 upwards.
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const a = Math.floor(i / 3);
      const b = (i % 3) + grid.size - 11;
      setFunction(grid, a, b, false);
      setFunction(grid, b, a, false);
    }
  }
}

/** Lays the codewords in the upward-downward zigzag, skipping function modules. */
function placeCodewords(grid: Grid, codewords: Uint8Array) {
  let bit = 0;
  const total = codewords.length * 8;
  let upward = true;

  for (let right = grid.size - 1; right >= 1; right -= 2) {
    // Column 6 is the vertical timing pattern and is not part of the zigzag.
    if (right === 6) right = 5;
    for (let step = 0; step < grid.size; step++) {
      const y = upward ? grid.size - 1 - step : step;
      for (let dx = 0; dx < 2; dx++) {
        const x = right - dx;
        if (grid.reserved[at(grid, x, y)]) continue;
        let dark = false;
        if (bit < total) {
          dark = ((codewords[bit >>> 3] >>> (7 - (bit & 7))) & 1) === 1;
          bit++;
        }
        // Anything past the data is a remainder bit, which stays light.
        grid.modules[at(grid, x, y)] = dark ? 1 : 0;
      }
    }
    upward = !upward;
  }
}

/** The eight mask conditions of the specification. */
function maskAt(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

function applyMask(grid: Grid, mask: number) {
  for (let y = 0; y < grid.size; y++) {
    for (let x = 0; x < grid.size; x++) {
      if (grid.reserved[at(grid, x, y)]) continue;
      if (maskAt(mask, x, y)) grid.modules[at(grid, x, y)] ^= 1;
    }
  }
}

/** The 15-bit format information: level, mask, BCH remainder, then the fixed XOR. */
function formatBits(level: EcLevel, mask: number): number {
  const levelBits = level === "L" ? 0b01 : 0b00;
  const data = (levelBits << 3) | mask;
  let value = data << 10;
  for (let i = 4; i >= 0; i--) {
    if (value & (1 << (i + 10))) value ^= 0b10100110111 << i;
  }
  return ((data << 10) | value) ^ 0b101010000010010;
}

function placeFormat(grid: Grid, level: EcLevel, mask: number) {
  const bits = formatBits(level, mask);
  const bit = (i: number) => ((bits >>> i) & 1) === 1;

  // First copy, around the top-left finder.
  for (let i = 0; i <= 5; i++) setFunction(grid, 8, i, bit(i));
  setFunction(grid, 8, 7, bit(6));
  setFunction(grid, 8, 8, bit(7));
  setFunction(grid, 7, 8, bit(8));
  for (let i = 9; i <= 14; i++) setFunction(grid, 14 - i, 8, bit(i));

  // Second copy, split between the other two finders.
  for (let i = 0; i <= 7; i++) setFunction(grid, grid.size - 1 - i, 8, bit(i));
  for (let i = 8; i <= 14; i++) setFunction(grid, 8, grid.size - 15 + i, bit(i));
}

function placeVersion(grid: Grid, version: number) {
  if (version < 7) return;
  const bits = VERSION_INFO[version];
  for (let i = 0; i < 18; i++) {
    const dark = ((bits >>> i) & 1) === 1;
    const a = Math.floor(i / 3);
    const b = (i % 3) + grid.size - 11;
    setFunction(grid, a, b, dark);
    setFunction(grid, b, a, dark);
  }
}

/**
 * The penalty score for a masked grid. The specification defines four rules, and the
 * mask with the lowest total is the one used. Choosing badly still scans, but scans
 * less reliably, which is exactly the failure that is hard to reproduce.
 */
function penalty(grid: Grid): number {
  const size = grid.size;
  const dark = (x: number, y: number) => grid.modules[at(grid, x, y)] === 1;
  let score = 0;

  // Rule 1: runs of five or more of the same colour, in rows and in columns.
  for (let i = 0; i < size; i++) {
    for (const byRow of [true, false]) {
      let run = 1;
      for (let j = 1; j < size; j++) {
        const a = byRow ? dark(j - 1, i) : dark(i, j - 1);
        const b = byRow ? dark(j, i) : dark(i, j);
        if (a === b) {
          run++;
        } else {
          if (run >= 5) score += run - 2;
          run = 1;
        }
      }
      if (run >= 5) score += run - 2;
    }
  }

  // Rule 2: every 2x2 block of one colour.
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = dark(x, y);
      if (c === dark(x + 1, y) && c === dark(x, y + 1) && c === dark(x + 1, y + 1)) {
        score += 3;
      }
    }
  }

  /*
    Rule 3: the finder-like 1:1:3:1:1 sequence with four light modules to one side.

    Counted as two separate eleven-module patterns rather than as one seven-module
    pattern with a light run on either side. The distinction matters: a sequence with
    four light modules on both sides matches both patterns and scores 80, which is what
    the specification's own wording and every implementation worth comparing against
    produce. Scoring it 40 picked a different mask on smaller versions.
  */
  const PATTERNS = [
    [true, false, true, true, true, false, true, false, false, false, false],
    [false, false, false, false, true, false, true, true, true, false, true],
  ];
  for (let i = 0; i < size; i++) {
    for (const byRow of [true, false]) {
      const cells: boolean[] = [];
      for (let j = 0; j < size; j++) cells.push(byRow ? dark(j, i) : dark(i, j));
      for (let j = 0; j + 11 <= size; j++) {
        for (const pattern of PATTERNS) {
          if (pattern.every((want, k) => cells[j + k] === want)) score += 40;
        }
      }
    }
  }

  // Rule 4: how far the proportion of dark modules is from half.
  let darkCount = 0;
  for (let i = 0; i < grid.modules.length; i++) if (grid.modules[i] === 1) darkCount++;
  const percent = (darkCount * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

export interface QrCode {
  version: number;
  level: EcLevel;
  mask: number;
  size: number;
  /** Row-major, true where the module is dark. Excludes the quiet zone. */
  modules: boolean[][];
}

/**
 * Encodes text as a QR code, choosing the smallest version that fits and the mask the
 * specification's own scoring prefers.
 *
 * Returns null rather than throwing when the text is too long for version 10: the
 * caller's fallback is to show the secret for typing, which is a worse experience but
 * not a failure, and an exception here would take the whole enrolment screen down.
 */
export function encodeQr(text: string, level: EcLevel = "L"): QrCode | null {
  const bytes = new TextEncoder().encode(text);
  const version = versionFor(bytes.length, level);
  if (version === null) return null;

  let best: { code: QrCode; score: number } | null = null;
  for (let mask = 0; mask < 8; mask++) {
    const built = buildQr(bytes, version, level, mask);
    if (!best || built.score < best.score) best = built;
  }
  return best ? best.code : null;
}

/**
 * The same encoding at a mask of the caller's choosing.
 *
 * Split out because `encodeQr` has to build all eight to score them, and because a mask
 * is then something that can be compared against another implementation one at a time.
 * Returns null only when the text does not fit the version asked for.
 */
export function encodeQrAtMask(
  text: string,
  level: EcLevel,
  version: number,
  mask: number,
): QrCode | null {
  const bytes = new TextEncoder().encode(text);
  if (version < 1 || version > 10 || mask < 0 || mask > 7) return null;
  if (bytes.length > byteCapacity(version, level)) return null;
  return buildQr(bytes, version, level, mask).code;
}

/** One complete grid, and what the specification's rules score it at. */
function buildQr(
  bytes: Uint8Array,
  version: number,
  level: EcLevel,
  mask: number,
): { code: QrCode; score: number } {
  const codewords = interleave(encodeData(bytes, version, level), version, level);
  const grid = makeGrid(version);
  placeFunctionPatterns(grid, version);
  placeCodewords(grid, codewords);
  applyMask(grid, mask);
  placeFormat(grid, level, mask);
  placeVersion(grid, version);

  const modules: boolean[][] = [];
  for (let y = 0; y < grid.size; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < grid.size; x++) row.push(grid.modules[at(grid, x, y)] === 1);
    modules.push(row);
  }

  return {
    code: { version, level, mask, size: grid.size, modules },
    score: penalty(grid),
  };
}

/**
 * The QR code as an SVG, with the four-module quiet zone the specification requires.
 *
 * One path of rectangles rather than one element per module: a version 7 code is 45
 * squared, so nearly two thousand elements, and the difference is visible when the
 * enrolment dialog opens. Colours are given explicitly because this is rendered on a
 * card that follows the reader's theme, and a QR code has to stay dark on light to
 * scan at all.
 */
export function qrSvg(code: QrCode, moduleSize = 6, quietZone = 4): string {
  const dimension = (code.size + quietZone * 2) * moduleSize;
  let path = "";
  for (let y = 0; y < code.size; y++) {
    for (let x = 0; x < code.size; x++) {
      if (!code.modules[y][x]) continue;
      const px = (x + quietZone) * moduleSize;
      const py = (y + quietZone) * moduleSize;
      path += `M${px} ${py}h${moduleSize}v${moduleSize}h-${moduleSize}z`;
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${dimension}" height="${dimension}" ` +
    `viewBox="0 0 ${dimension} ${dimension}" role="img" aria-label="Enrolment QR code">` +
    `<rect width="${dimension}" height="${dimension}" fill="#ffffff"/>` +
    `<path d="${path}" fill="#000000"/>` +
    `</svg>`
  );
}
