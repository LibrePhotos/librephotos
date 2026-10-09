import CryptoJS from "crypto-js";

// < 1MB chunks, because of the nginx default client_max_body_size
export const CHUNK_SIZE = 1000000;

export function calculateMD5(file: File): Promise<string> {
  // An empty file has nothing to read; onload would see "" and never settle.
  if (file.size === 0) {
    return Promise.resolve(CryptoJS.algo.MD5.create().finalize().toString(CryptoJS.enc.Hex));
  }
  const reader = new FileReader();
  const blockSize = 25 * 1024 * 1024;
  let offset = 0;
  const md5 = CryptoJS.algo.MD5.create();
  return new Promise<string>((resolve, reject) => {
    function readNext() {
      reader.readAsBinaryString(file.slice(offset, offset + blockSize));
    }

    reader.onerror = () => {
      reader.abort();
      reject(new DOMException("Problem parsing input file."));
    };

    reader.onload = () => {
      const result = reader.result as string | null;
      if (result === null) return;
      // A short read (the file shrank while hashing) would otherwise wait forever.
      if (result.length === 0 && offset < file.size) {
        reject(new DOMException("Problem parsing input file."));
        return;
      }
      offset += result.length;
      md5.update(CryptoJS.enc.Latin1.parse(result));
      if (offset >= file.size) {
        resolve(md5.finalize().toString(CryptoJS.enc.Hex));
        return;
      }
      readNext();
    };

    readNext();
  });
}

export function calculateChunks(file: File, blockSize: number = CHUNK_SIZE): Blob[] {
  const count = Math.ceil(file.size / blockSize);
  return Array.from({ length: count }, (_unused, i) =>
    file.slice(i * blockSize, Math.min((i + 1) * blockSize, file.size))
  );
}
