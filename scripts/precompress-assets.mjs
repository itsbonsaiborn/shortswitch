import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { brotliCompress, constants, gzip } from 'node:zlib';
import { promisify } from 'node:util';

const brotli = promisify(brotliCompress);
const gzipAsync = promisify(gzip);
const root = path.resolve('dist/client');
const compressibleExtensions = new Set(['.css', '.html', '.js', '.json', '.svg', '.webmanifest']);
const minimumBytes = 1_024;

const walk = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const absolutePath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolutePath) : [absolutePath];
  }));
  return files.flat();
};

let sourceBytes = 0;
let brotliBytes = 0;
let gzipBytes = 0;
let compressedFiles = 0;

for (const filePath of await walk(root)) {
  if (!compressibleExtensions.has(path.extname(filePath).toLowerCase())) continue;
  const input = await readFile(filePath);
  if (input.byteLength < minimumBytes) continue;

  const [brotliOutput, gzipOutput] = await Promise.all([
    brotli(input, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 11,
        [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT
      }
    }),
    gzipAsync(input, { level: 9 })
  ]);

  await Promise.all([
    writeFile(`${filePath}.br`, brotliOutput),
    writeFile(`${filePath}.gz`, gzipOutput)
  ]);
  sourceBytes += input.byteLength;
  brotliBytes += brotliOutput.byteLength;
  gzipBytes += gzipOutput.byteLength;
  compressedFiles += 1;
}

console.log(JSON.stringify({ compressedFiles, sourceBytes, brotliBytes, gzipBytes }));
