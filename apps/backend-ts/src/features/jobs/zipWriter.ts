// A minimal streaming ZIP writer (deflate, ZIP64 when needed), the part of
// the `zip` crate lp_api::jobs_zip_services::zip uses. Each entry is
// deflated from a read stream straight into the archive; its local header is
// patched with the CRC and sizes afterwards (the file is seekable), as
// Python's zipfile does.
import { createReadStream } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import zlib from "node:zlib";

const U32 = 0xffffffff;

interface Entry {
  name: Buffer;
  crc: number;
  csize: number;
  usize: number;
  offset: number;
  time: number;
  date: number;
}

/** MS-DOS time/date of a local datetime (zip's last_modified_time). */
function dosDateTime(d: Date): { time: number; date: number } {
  const year = d.getFullYear();
  if (year < 1980 || year > 2107) return { time: 0, date: (1 << 5) | 1 };
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export class ZipWriter {
  private entries: Entry[] = [];
  private pos = 0;
  private constructor(private fh: FileHandle) {}

  static async create(path: string): Promise<ZipWriter> {
    return new ZipWriter(await open(path, "w"));
  }

  private async write(buf: Buffer, at?: number) {
    if (at === undefined) {
      await this.fh.write(buf, 0, buf.length, this.pos);
      this.pos += buf.length;
    } else {
      await this.fh.write(buf, 0, buf.length, at);
    }
  }

  /** Add the file at `src` as `name`, deflated. `size` decides ZIP64 up front. */
  async addFile(name: string, src: string, size: number, mtime: Date): Promise<void> {
    const nameBuf = Buffer.from(name, "utf8");
    const zip64 = size >= U32;
    const { time, date } = dosDateTime(mtime);
    const offset = this.pos;
    const header = Buffer.alloc(30 + nameBuf.length + (zip64 ? 20 : 0));
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(zip64 ? 45 : 20, 4);
    header.writeUInt16LE(0x0800, 6); // UTF-8 names
    header.writeUInt16LE(8, 8); // deflate
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt16LE(nameBuf.length, 26);
    header.writeUInt16LE(zip64 ? 20 : 0, 28);
    nameBuf.copy(header, 30);
    await this.write(header);

    let crc = 0;
    let usize = 0;
    let csize = 0;
    const input = createReadStream(src);
    input.on("data", (c) => {
      const b = c as Buffer;
      crc = Bun.hash.crc32(b, crc);
      usize += b.length;
    });
    const deflate = zlib.createDeflateRaw();
    input.on("error", (e) => deflate.destroy(e));
    input.pipe(deflate);
    for await (const chunk of deflate) {
      const b = chunk as Buffer;
      csize += b.length;
      await this.write(b);
    }
    if (!zip64 && (usize >= U32 || csize >= U32)) throw new Error(`${src} grew past 4 GiB while it was zipped`);

    // Patch CRC and sizes into the local header.
    const fix = Buffer.alloc(12);
    fix.writeUInt32LE(crc >>> 0, 0);
    fix.writeUInt32LE(zip64 ? U32 : csize, 4);
    fix.writeUInt32LE(zip64 ? U32 : usize, 8);
    await this.write(fix, offset + 14);
    if (zip64) {
      const ext = Buffer.alloc(20);
      ext.writeUInt16LE(1, 0);
      ext.writeUInt16LE(16, 2);
      ext.writeBigUInt64LE(BigInt(usize), 4);
      ext.writeBigUInt64LE(BigInt(csize), 12);
      await this.write(ext, offset + 30 + nameBuf.length);
    }
    this.entries.push({ name: nameBuf, crc: crc >>> 0, csize, usize, offset, time, date });
  }

  /** Central directory, end records, fsync, close. */
  async finish(): Promise<void> {
    const cdStart = this.pos;
    for (const e of this.entries) {
      const big = [e.usize >= U32, e.csize >= U32, e.offset >= U32];
      const extLen = big.some(Boolean) ? 4 + 8 * big.filter(Boolean).length : 0;
      const h = Buffer.alloc(46 + e.name.length + extLen);
      h.writeUInt32LE(0x02014b50, 0);
      h.writeUInt16LE((3 << 8) | 45, 4); // made by: unix, 4.5
      h.writeUInt16LE(extLen ? 45 : 20, 6);
      h.writeUInt16LE(0x0800, 8);
      h.writeUInt16LE(8, 10);
      h.writeUInt16LE(e.time, 12);
      h.writeUInt16LE(e.date, 14);
      h.writeUInt32LE(e.crc, 16);
      h.writeUInt32LE(big[1] ? U32 : e.csize, 20);
      h.writeUInt32LE(big[0] ? U32 : e.usize, 24);
      h.writeUInt16LE(e.name.length, 28);
      h.writeUInt16LE(extLen, 30);
      h.writeUInt32LE((0o100644 << 16) >>> 0, 38);
      h.writeUInt32LE(big[2] ? U32 : e.offset, 42);
      e.name.copy(h, 46);
      if (extLen) {
        let p = 46 + e.name.length;
        h.writeUInt16LE(1, p);
        h.writeUInt16LE(extLen - 4, p + 2);
        p += 4;
        for (const [i, v] of [e.usize, e.csize, e.offset].entries()) {
          if (!big[i]) continue;
          h.writeBigUInt64LE(BigInt(v), p);
          p += 8;
        }
      }
      await this.write(h);
    }
    const cdSize = this.pos - cdStart;
    const n = this.entries.length;
    if (n >= 0xffff || cdStart >= U32 || cdSize >= U32) {
      const eocd64At = this.pos;
      const z = Buffer.alloc(56 + 20);
      z.writeUInt32LE(0x06064b50, 0);
      z.writeBigUInt64LE(44n, 4);
      z.writeUInt16LE(45, 12);
      z.writeUInt16LE(45, 14);
      z.writeBigUInt64LE(BigInt(n), 24);
      z.writeBigUInt64LE(BigInt(n), 32);
      z.writeBigUInt64LE(BigInt(cdSize), 40);
      z.writeBigUInt64LE(BigInt(cdStart), 48);
      z.writeUInt32LE(0x07064b50, 56);
      z.writeBigUInt64LE(BigInt(eocd64At), 64);
      z.writeUInt32LE(1, 72);
      await this.write(z);
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(Math.min(n, 0xffff), 8);
    end.writeUInt16LE(Math.min(n, 0xffff), 10);
    end.writeUInt32LE(Math.min(cdSize, U32), 12);
    end.writeUInt32LE(Math.min(cdStart, U32), 16);
    await this.write(end);
    await this.fh.sync();
    await this.fh.close();
  }

  /** Close without finishing (the caller removes the partial file). */
  async abort(): Promise<void> {
    await this.fh.close().catch(() => {});
  }
}
