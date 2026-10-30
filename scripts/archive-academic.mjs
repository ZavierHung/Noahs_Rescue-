import { createAcademicRetriever } from "../server/src/academic/retriever.js";
import { archiveSource, ARCHIVE_DIR } from "../server/src/academic/archive.js";
import { writeFile, mkdir, rename } from "node:fs/promises";
import path from "node:path";
const retriever = await createAcademicRetriever();
const timeoutMs = Number(process.env.ACADEMIC_DOWNLOAD_TIMEOUT_MS || 15000);
if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000)
  throw new Error("timeout must be 100–60000 ms");
const results = [];
// Only curated, public source URLs; no credentials, cookies, env-file loading or live games.
for (let i = 0; i < retriever.library.sources.length; i += 2) {
  const batch = await Promise.all(
    retriever.library.sources.slice(i, i + 2).map(async (s) => {
      try {
        return {
          id: s.id,
          originalUrl: s.originalUrl,
          ...(await archiveSource(s, { timeoutMs })),
        };
      } catch {
        // One bad source or filesystem error must not discard other results.
        return {
          id: s.id,
          originalUrl: s.originalUrl,
          status: "pending",
          reason: "archive_source_failed",
          attempts: [],
        };
      }
    }),
  );
  results.push(...batch);
  for (const item of batch)
    console.log(
      `${item.id}: ${item.status}${item.reason ? ` (${item.reason})` : ""}`,
    );
}
await mkdir(ARCHIVE_DIR, { recursive: true });
const destination = path.join(ARCHIVE_DIR, "manifest.json");
await writeFile(
  `${destination}.tmp`,
  JSON.stringify(
    {
      archiveFormat: 2,
      at: new Date().toISOString(),
      libraryHash: retriever.hash,
      results,
    },
    null,
    2,
  ) + "\n",
);
await rename(`${destination}.tmp`, destination);
if (results.some((r) => !["available", "external"].includes(r.status)))
  process.exitCode = 2;
