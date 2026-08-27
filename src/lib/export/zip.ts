/**
 * A minimal ZIP writer.
 *
 * Exists so that "export my campaign" produces one file the user can put
 * somewhere safe, without adding a compression library to an app whose entire
 * payload is prose. Everything is stored uncompressed (method 0), which is a
 * legal ZIP that every extractor opens — Explorer, Finder, `unzip`, and the
 * file pickers people will drag the result back into.
 *
 * Uncompressed is the right trade here. Markdown compresses well, but the cost
 * of the alternative is a deflate implementation or a dependency, and the
 * benefit is disk space for a folder of text files. The format below is the
 * whole of what a reader needs: a local header per file, then a central
 * directory naming them, then a record saying where that directory starts.
 */

/** One entry in the archive. */
export interface ZipEntry {
  /** Path inside the zip, using forward slashes. */
  path: string;
  content: string;
}

/**
 * CRC-32, which every ZIP entry carries so extractors can detect corruption.
 *
 * The table is built once on first use rather than shipped as a literal; it is
 * 256 entries and takes microseconds.
 */
let crcTable: Uint32Array | null = null;

function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crcTable[i] = c >>> 0;
    }
  }

  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Growable little-endian byte buffer. */
class ByteWriter {
  private parts: Uint8Array[] = [];
  private length = 0;

  get offset(): number {
    return this.length;
  }

  bytes(value: Uint8Array): void {
    this.parts.push(value);
    this.length += value.length;
  }

  u16(value: number): void {
    this.bytes(new Uint8Array([value & 0xff, (value >>> 8) & 0xff]));
  }

  u32(value: number): void {
    this.bytes(
      new Uint8Array([
        value & 0xff,
        (value >>> 8) & 0xff,
        (value >>> 16) & 0xff,
        (value >>> 24) & 0xff,
      ]),
    );
  }

  toBlob(type: string): Blob {
    return new Blob(this.parts as BlobPart[], { type });
  }
}

/**
 * DOS date and time, which is what the ZIP header format stores.
 *
 * Two-second resolution and a 1980 epoch, both inherited from the format. A
 * fixed timestamp is used rather than the clock: it makes an export of
 * unchanged content byte-identical, which is what lets someone diff two
 * backups and see only what actually changed.
 */
const DOS_TIME = 0;
const DOS_DATE = 0x21; // 1 January 1980.

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_DIRECTORY = 0x06054b50;

/** UTF-8 flag: without it, non-ASCII names are mojibake in some extractors. */
const UTF8_FLAG = 0x0800;

/** Builds a ZIP archive from text entries. */
export function createZip(entries: ZipEntry[]): Blob {
  const encoder = new TextEncoder();
  const out = new ByteWriter();

  const directory: {
    nameBytes: Uint8Array;
    crc: number;
    size: number;
    offset: number;
  }[] = [];

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.path);
    const data = encoder.encode(entry.content);
    const crc = crc32(data);
    const offset = out.offset;

    out.u32(LOCAL_HEADER);
    out.u16(20); // Version needed to extract.
    out.u16(UTF8_FLAG);
    out.u16(0); // Stored, not deflated.
    out.u16(DOS_TIME);
    out.u16(DOS_DATE);
    out.u32(crc);
    out.u32(data.length); // Compressed size — the same, since it is stored.
    out.u32(data.length);
    out.u16(nameBytes.length);
    out.u16(0); // No extra field.
    out.bytes(nameBytes);
    out.bytes(data);

    directory.push({ nameBytes, crc, size: data.length, offset });
  }

  const directoryStart = out.offset;

  for (const file of directory) {
    out.u32(CENTRAL_HEADER);
    out.u16(20); // Version made by.
    out.u16(20); // Version needed.
    out.u16(UTF8_FLAG);
    out.u16(0);
    out.u16(DOS_TIME);
    out.u16(DOS_DATE);
    out.u32(file.crc);
    out.u32(file.size);
    out.u32(file.size);
    out.u16(file.nameBytes.length);
    out.u16(0); // Extra field length.
    out.u16(0); // Comment length.
    out.u16(0); // Disk number.
    out.u16(0); // Internal attributes.
    out.u32(0); // External attributes.
    out.u32(file.offset);
    out.bytes(file.nameBytes);
  }

  const directorySize = out.offset - directoryStart;

  out.u32(END_OF_DIRECTORY);
  out.u16(0); // This disk.
  out.u16(0); // Disk with the directory.
  out.u16(directory.length);
  out.u16(directory.length);
  out.u32(directorySize);
  out.u32(directoryStart);
  out.u16(0); // No archive comment.

  return out.toBlob("application/zip");
}

export { crc32 };
