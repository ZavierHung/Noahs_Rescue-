import {
  readFile,
  mkdir,
  writeFile,
  rename,
  lstat,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
export const ARCHIVE_DIR = fileURLToPath(
  new URL("../../data/academic/originals/", import.meta.url),
);
const MAX_BYTES = 30 * 1024 * 1024;
function filePath(id, directory) {
  if (!/^[a-z][a-z0-9-]+$/.test(id)) throw new Error("invalid_source_id");
  return path.join(directory, `${id}.pdf`);
}
function publicUrl(value) {
  if (typeof value !== "string") throw new Error("unsafe_archive_url");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("unsafe_archive_url");
  }
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("unsafe_archive_url");
  return url.href;
}
function sourceUrls(source) {
  if (source.archiveUrls !== undefined && !Array.isArray(source.archiveUrls))
    throw new Error("invalid_archive_urls");
  return [
    ...new Set(
      [source.originalUrl, ...(source.archiveUrls || [])].map(publicUrl),
    ),
  ];
}
async function fetchDocument(url, fetchImpl, timeoutMs) {
  const signal = AbortSignal.timeout(timeoutMs);
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await fetchImpl(url, {
      signal,
      redirect: "manual",
      headers: {
        "User-Agent": "Noahs-Rescue-Research/1.0 (local academic archive)",
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => {});
      if (!location) throw new Error("invalid_archive_redirect");
      url = publicUrl(new URL(location, url).href);
      continue;
    }
    return { response, downloadUrl: publicUrl(response.url || url) };
  }
  throw new Error("archive_redirect_limit");
}
async function jsonFile(filename) {
  try {
    const stat = await lstat(filename);
    if (!stat.isFile() || stat.size > 1024 * 1024) return null;
    return JSON.parse(await readFile(filename, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}
async function atomicWrite(filename, data) {
  const temporary = `${filename}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, data, { mode: 0o600 });
    await rename(temporary, filename);
  } finally {
    await rm(temporary, { force: true });
  }
}
function knownProvenance(record, source, allowLegacy) {
  if (!record || record.id !== source.id || record.status !== "available")
    return null;
  try {
    if (record.downloadUrl && record.provenance !== "unknown") {
      return {
        downloadUrl: publicUrl(record.downloadUrl),
        requestedUrl: publicUrl(record.requestedUrl || record.downloadUrl),
        provenance: record.provenance || "recorded_download",
        ...(record.downloadedAt ? { downloadedAt: record.downloadedAt } : {}),
        attempts: Array.isArray(record.attempts)
          ? record.attempts.map((attempt) => ({
              url: publicUrl(attempt.url),
              ...(attempt.downloadUrl
                ? { downloadUrl: publicUrl(attempt.downloadUrl) }
                : {}),
              status: attempt.status === "available" ? "available" : "pending",
              ...(attempt.reason ? { reason: String(attempt.reason) } : {}),
              ...(Number.isInteger(attempt.httpStatus)
                ? { httpStatus: attempt.httpStatus }
                : {}),
            }))
          : [],
      };
    }
    // The former archiver only fetched originalUrl. Its successful manifest is
    // evidence of that request, unlike an unrecorded PDF found on disk.
    if (
      allowLegacy &&
      !record.provenance &&
      !record.downloadUrl &&
      record.originalUrl === source.originalUrl
    )
      return {
        requestedUrl: publicUrl(record.originalUrl),
        downloadUrl: publicUrl(record.originalUrl),
        provenance: "legacy_manifest_original_url",
        attempts: [],
      };
  } catch {
    return null;
  }
  return null;
}
async function cachedResult(source, existing, directory) {
  const sidecar = await jsonFile(
    path.join(directory, `${source.id}.archive.json`),
  );
  const manifest = await jsonFile(path.join(directory, "manifest.json"));
  const manifestRecord = Array.isArray(manifest?.results)
    ? manifest.results.find((record) => record.id === source.id)
    : null;
  let mismatch = false;
  for (const [record, allowLegacy] of [
    [sidecar, false],
    [manifestRecord, !manifest?.archiveFormat],
  ]) {
    const provenance = knownProvenance(record, source, allowLegacy);
    if (!provenance) continue;
    if (record.sha256 !== existing.sha256 || record.bytes !== existing.bytes) {
      mismatch = true;
      continue;
    }
    const result = {
      status: "available",
      sha256: existing.sha256,
      bytes: existing.bytes,
      cached: true,
      ...provenance,
    };
    // Keep a per-document record even when migrating the old aggregate manifest,
    // so a later failed run cannot erase the last verified hash/provenance.
    if (record !== sidecar) {
      await atomicWrite(
        path.join(directory, `${source.id}.archive.json`),
        JSON.stringify(
          {
            archiveFormat: 2,
            id: source.id,
            originalUrl: source.originalUrl,
            ...result,
          },
          null,
          2,
        ) + "\n",
      );
    }
    return result;
  }
  return {
    status: mismatch ? "pending" : "available",
    sha256: existing.sha256,
    bytes: existing.bytes,
    cached: true,
    provenance: "unknown",
    reason: mismatch ? "cache_integrity_mismatch" : "cache_provenance_unknown",
    attempts: [],
  };
}
export async function originalDocument(source, directory = ARCHIVE_DIR) {
  try {
    const filename = filePath(source.id, directory);
    if (["web", "link"].includes(source.originalFormat)) return null;
    const metadata = await lstat(filename);
    if (!metadata.isFile() || metadata.size > MAX_BYTES) return null;
    const data = await readFile(filename);
    if (data.length > MAX_BYTES || data.subarray(0, 5).toString() !== "%PDF-")
      return null;
    return {
      data,
      sha256: createHash("sha256").update(data).digest("hex"),
      bytes: data.length,
    };
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}
export async function archiveSource(
  source,
  { directory = ARCHIVE_DIR, fetchImpl = fetch, timeoutMs = 15000 } = {},
) {
  let urls;
  try {
    filePath(source.id, directory);
    urls = sourceUrls(source);
    if (["web", "link"].includes(source.originalFormat))
      return {
        status: "external",
        reason: "linked_original_not_archived",
        attempts: [],
      };
    const existing = await originalDocument(source, directory);
    if (existing) return await cachedResult(source, existing, directory);
  } catch (error) {
    return {
      status: "pending",
      reason: [
        "invalid_source_id",
        "unsafe_archive_url",
        "invalid_archive_urls",
      ].includes(error.message)
        ? error.message
        : "archive_read_failed",
      attempts: [],
    };
  }
  const attempts = [];
  for (const url of urls) {
    let response;
    let data;
    let downloadUrl;
    try {
      ({ response, downloadUrl } = await fetchDocument(
        url,
        fetchImpl,
        timeoutMs,
      ));
      if (!response.ok) throw new Error(`http_${response.status}`);
      if (Number(response.headers.get("content-length")) > MAX_BYTES)
        throw new Error("pdf_too_large");
      const parts = [];
      let size = 0;
      for await (const part of response.body) {
        size += part.length;
        if (size > MAX_BYTES) throw new Error("pdf_too_large");
        parts.push(part);
      }
      data = Buffer.concat(parts);
      if (data.subarray(0, 5).toString() !== "%PDF-")
        throw new Error("not_pdf_or_access_challenge");
    } catch (error) {
      await response?.body?.cancel().catch(() => {});
      const reason =
        /^(http_\d+|pdf_too_large|not_pdf_or_access_challenge|unsafe_archive_url|invalid_archive_redirect|archive_redirect_limit)$/.test(
          error.message,
        )
          ? error.message
          : "network_or_timeout";
      attempts.push({
        url,
        ...(downloadUrl ? { downloadUrl } : {}),
        status: "pending",
        reason,
        ...(response ? { httpStatus: response.status } : {}),
      });
      continue;
    }
    attempts.push({
      url,
      downloadUrl,
      status: "available",
      httpStatus: response.status,
    });
    const result = {
      status: "available",
      sha256: createHash("sha256").update(data).digest("hex"),
      bytes: data.length,
      requestedUrl: url,
      downloadUrl,
      downloadedAt: new Date().toISOString(),
      provenance: "recorded_download",
      cached: false,
      attempts,
    };
    try {
      await mkdir(directory, { recursive: true });
      await atomicWrite(filePath(source.id, directory), data);
      await atomicWrite(
        path.join(directory, `${source.id}.archive.json`),
        JSON.stringify(
          {
            archiveFormat: 2,
            id: source.id,
            originalUrl: source.originalUrl,
            ...result,
          },
          null,
          2,
        ) + "\n",
      );
      return result;
    } catch {
      return { ...result, status: "pending", reason: "archive_write_failed" };
    }
  }
  return {
    status: "pending",
    reason: attempts.at(-1)?.reason || "no_archive_url",
    attempts,
  };
}
