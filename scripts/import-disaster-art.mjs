// Explicit asset import. The running game never reads the author's Word file.
// macOS unzip/sips extract original media and preserve native aspect ratios.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const source = process.argv[2];
if (!source) throw new Error('Usage: node scripts/import-disaster-art.mjs /absolute/path/卡牌.docx');
const root = fileURLToPath(new URL('../', import.meta.url));
const catalog = JSON.parse(await readFile(path.join(root, 'server/data/disasters.json'), 'utf8'));
const web = path.join(root, 'app/public/images/disasters');
await mkdir(web, { recursive: true });
const temp = await mkdtemp(path.join(tmpdir(), 'noah-card-import-'));
const assets = {};
try {
  for (const card of catalog.cards) {
    const bytes = execFileSync('unzip', ['-p', path.resolve(source), `word/media/${card.sourceImage}`], { maxBuffer: 8 * 1024 * 1024 });
    if (bytes.subarray(1, 4).toString() !== 'PNG') throw new Error('Expected embedded PNG');
    const originalWidth = bytes.readUInt32BE(16), originalHeight = bytes.readUInt32BE(20);
    const input = path.join(temp, card.sourceImage);
    const file = `${card.id}.jpg`;
    await writeFile(input, bytes);
    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '65', '-Z', '1000', input, '--out', path.join(web, file)], { stdio: 'pipe' });
    const dimensions = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', path.join(web, file)], { encoding: 'utf8' });
    const jpeg = await readFile(path.join(web, file));
    assets[card.id] = { file, width: Number(dimensions.match(/pixelWidth: (\d+)/)[1]), height: Number(dimensions.match(/pixelHeight: (\d+)/)[1]), originalWidth, originalHeight, sourceImage: card.sourceImage, sourceSha256: createHash('sha256').update(bytes).digest('hex'), sha256: createHash('sha256').update(jpeg).digest('hex'), bytes: jpeg.length };
  }
  await writeFile(path.join(root, 'server/data/disaster-art.json'), JSON.stringify({ source: catalog.source, assets }, null, 2) + '\n');
  console.log(`Imported ${Object.keys(assets).length} original cards, ${Math.round(Object.values(assets).reduce((n, a) => n + a.bytes, 0) / 1024)} KB per client.`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
