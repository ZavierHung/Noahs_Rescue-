import { spawn, execFileSync } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PROXY_KEYS = ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy"];
const LOOPBACKS = ["localhost", "127.0.0.1", "::1"];
const HELP = `Usage: node scripts/with-system-proxy.mjs <script.mjs | scripts/script.mjs> [args...]

Run an existing repository scripts/*.mjs entry with command-scoped proxy settings.
Explicit HTTP(S)_PROXY takes precedence; otherwise macOS manual HTTP(S) settings apply.
PAC and SOCKS are not converted. No .env, system settings, or shell files are changed.
Node must support --use-env-proxy when a proxy is configured.
`;

export function parseArguments(args) {
  if (
    !args.length ||
    (args.length === 1 && ["--help", "-h"].includes(args[0]))
  ) {
    return { help: true };
  }
  const name = args[0].replace(/^scripts\//, "");
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.mjs$/.test(name) ||
    name === "with-system-proxy.mjs"
  ) {
    throw new Error(
      "入口必须是仓库 scripts 目录中的现有 .mjs 文件，不能是启动器本身。",
    );
  }
  return { help: false, name, args: args.slice(1) };
}

export function hasExplicitProxy(env) {
  return PROXY_KEYS.some((key) => Object.hasOwn(env, key));
}

function validateProxy(value) {
  if (value === "") return "";
  try {
    if (typeof value !== "string" || /\s/.test(value)) throw new Error();
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !url.hostname ||
      url.port === "0" ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error();
    return value;
  } catch {
    // Never include a supplied value: proxy URLs can contain credentials.
    throw new Error(
      "HTTP(S) 代理地址无效：只支持 http/https URL 和有效端口，不支持 SOCKS、路径或查询参数。",
    );
  }
}

export function parseSystemProxy(text) {
  const fields = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z]+)\s*:\s*(.*?)\s*$/);
    if (match) fields.set(match[1], match[2]);
  }
  const proxies = {};
  for (const type of ["HTTP", "HTTPS"]) {
    if (fields.get(`${type}Enable`) !== "1") continue;
    const host = fields.get(`${type}Proxy`) ?? "";
    const portText = fields.get(`${type}Port`) ?? "";
    const port = Number(portText);
    if (
      !host ||
      /[\s/@?#]/.test(host) ||
      !/^\d+$/.test(portText) ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535
    )
      throw new Error("macOS 手动代理的地址或端口无效。");
    const address =
      host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
    // macOS HTTPSProxy describes the target protocol, not TLS to the proxy itself.
    proxies[`${type}_PROXY`] = validateProxy(`http://${address}:${port}`);
  }
  return {
    proxies,
    ignoredPac:
      fields.get("ProxyAutoConfigEnable") === "1" ||
      fields.get("ProxyAutoDiscoveryEnable") === "1",
    ignoredSocks: fields.get("SOCKSEnable") === "1",
  };
}

export function buildProxyEnvironment(
  env,
  { platform = process.platform, systemText = "", supportsProxy = false } = {},
) {
  const childEnv = { ...env };
  let source = "none";
  let ignoredPac = false;
  let ignoredSocks = false;
  if (hasExplicitProxy(env)) {
    source = "environment";
    for (const type of ["HTTP", "HTTPS"]) {
      const upper = `${type}_PROXY`;
      const lower = upper.toLowerCase();
      const value = Object.hasOwn(env, upper) ? env[upper] : env[lower];
      if (value !== undefined) {
        childEnv[upper] = validateProxy(value);
        childEnv[lower] = childEnv[upper];
      }
    }
  } else if (platform === "darwin") {
    const settings = parseSystemProxy(systemText);
    ignoredPac = settings.ignoredPac;
    ignoredSocks = settings.ignoredSocks;
    Object.assign(childEnv, settings.proxies);
    if (Object.keys(settings.proxies).length) source = "system";
  }
  const active = Boolean(childEnv.HTTP_PROXY || childEnv.HTTPS_PROXY);
  if (active && !supportsProxy) {
    throw new Error(
      "当前 Node 不支持 --use-env-proxy，代理尚未启用。请升级到支持该选项的 Node 后重试。",
    );
  }
  const exclusions = [env.NO_PROXY, env.no_proxy]
    .filter(Boolean)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  childEnv.NO_PROXY = [...new Set([...exclusions, ...LOOPBACKS])].join(",");
  childEnv.no_proxy = childEnv.NO_PROXY;
  if (active) {
    // Propagate to Node processes started by dev.mjs/npm, not just this one child.
    childEnv.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ""} --use-env-proxy`.trim();
  }
  return { env: childEnv, active, source, ignoredPac, ignoredSocks };
}

export async function main(args = process.argv.slice(2)) {
  const parsed = parseArguments(args);
  if (parsed.help) {
    process.stdout.write(HELP);
    return 0;
  }
  const scriptsDir = realpathSync(path.join(ROOT, "scripts"));
  const entry = path.join(scriptsDir, parsed.name);
  try {
    if (
      !lstatSync(entry).isFile() ||
      path.dirname(realpathSync(entry)) !== scriptsDir
    )
      throw new Error();
  } catch {
    throw new Error("入口不存在或不是 scripts 目录内的常规 .mjs 文件。");
  }
  let systemText = "";
  if (process.platform === "darwin" && !hasExplicitProxy(process.env)) {
    try {
      systemText = execFileSync("/usr/sbin/scutil", ["--proxy"], {
        encoding: "utf8",
        timeout: 3000,
        maxBuffer: 128 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      throw new Error(
        "读取 macOS 代理设置失败；请为本次命令显式提供 HTTP_PROXY/HTTPS_PROXY 后重试。",
      );
    }
  }
  const settings = buildProxyEnvironment(process.env, {
    systemText,
    supportsProxy: process.allowedNodeEnvironmentFlags.has("--use-env-proxy"),
  });
  process.stderr.write(
    settings.active
      ? `[proxy] 已启用${settings.source === "system" ? "系统手动" : "环境变量"}代理，仅作用于本次命令。\n`
      : "[proxy] 未配置 HTTP(S) 代理，按原网络方式运行。\n",
  );
  if (settings.ignoredPac || settings.ignoredSocks) {
    process.stderr.write(
      "[proxy] 未转换 PAC/SOCKS 设置；需要时请显式提供 HTTP(S)_PROXY。\n",
    );
  }
  const child = spawn(
    process.execPath,
    [...(settings.active ? ["--use-env-proxy"] : []), entry, ...parsed.args],
    { cwd: ROOT, env: settings.env, stdio: "inherit", shell: false },
  );
  const forwardInt = () => child.kill("SIGINT");
  const forwardTerm = () => child.kill("SIGTERM");
  process.on("SIGINT", forwardInt);
  process.on("SIGTERM", forwardTerm);
  const result = await new Promise((resolve) => {
    child.once("error", () => resolve({ failed: true }));
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  process.off("SIGINT", forwardInt);
  process.off("SIGTERM", forwardTerm);
  if (result.failed) throw new Error("无法启动指定 Node 脚本。");
  if (result.signal) {
    process.kill(process.pid, result.signal);
    return 1;
  }
  return result.code ?? 1;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    process.exitCode = await main();
  } catch (error) {
    process.stderr.write(`[proxy] ${error.message}\n`);
    process.exitCode = 1;
  }
}
