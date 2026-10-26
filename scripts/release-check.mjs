import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const PLAYER_VERSION = (
  await readFile(new URL("../app/lib/expedition.ts", import.meta.url), "utf8")
).match(/WEB_VERSION\s*=\s*["']([^"']+)["']/)[1];

export const PROTECTED_FILES = [
  ".env",
  "server/data/state.json",
  "server/data/judgments.json",
  "server/data/rooms.json",
  "server/data/expeditions.json",
  "miniprogram/project.private.config.json",
  "miniprogram/config.local.js",
];
export function checkReleaseFiles({
  tracked,
  ignored,
  version,
  playerVersion,
  template,
}) {
  const failures = [];
  for (const file of tracked) {
    const env =
      /(^|\/)\.env(?:\..*)?$/.test(file) && !file.endsWith(".env.example");
    if (env || PROTECTED_FILES.includes(file))
      failures.push(`不应追踪的本地文件：${file}`);
  }
  for (const file of PROTECTED_FILES)
    if (!ignored.includes(file)) failures.push(`缺少 Git 忽略规则：${file}`);
  if (version !== playerVersion)
    failures.push("根目录版本与玩家界面版本不一致。");
  const key = template.match(/^MINIMAX_API_KEY=(.*)$/m);
  if (!key || !["", '""', "''"].includes(key[1].trim()))
    failures.push(".env.example 的模型密钥必须留空。");
  return failures;
}

async function main() {
  const root = fileURLToPath(new URL("../", import.meta.url));
  // Only filenames and the public template are inspected. Never load .env or
  // print real credentials / live player archives in local or CI logs.
  const tracked = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
  let ignored = [];
  try {
    ignored = execFileSync("git", ["check-ignore", "--no-index", "--stdin"], {
      cwd: root,
      encoding: "utf8",
      input: PROTECTED_FILES.join("\n") + "\n",
    })
      .trim()
      .split("\n");
  } catch (error) {
    if (error.status !== 1) throw error;
  }
  const manifest = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  const failures = checkReleaseFiles({
    tracked,
    ignored,
    version: manifest.version,
    playerVersion: PLAYER_VERSION,
    template: await readFile(path.join(root, ".env.example"), "utf8"),
  });
  if (failures.length) {
    failures.forEach((message) => process.stderr.write(`${message}\n`));
    process.exitCode = 1;
  } else {
    process.stdout.write(`本地内测 ${PLAYER_VERSION} 文件与配置检查通过。\n`);
    process.stdout.write(
      "这不是公开发行许可：网页账号/对局鉴权、部署安全、限流与数据库备份仍待完成；小程序已归档。\n",
    );
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
