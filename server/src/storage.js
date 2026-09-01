import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function createJsonStore(dataDirectory) {
  async function read(name, fallback) {
    try {
      return JSON.parse(await readFile(path.join(dataDirectory, name), 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await write(name, fallback);
      return structuredClone(fallback);
    }
  }

  async function write(name, value) {
    await mkdir(dataDirectory, { recursive: true });
    const target = path.join(dataDirectory, name);
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await rename(temporary, target);
    return value;
  }

  return { read, write };
}
