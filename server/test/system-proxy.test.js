import assert from "node:assert/strict";
import test from "node:test";
import {
  parseArguments,
  hasExplicitProxy,
  parseSystemProxy,
  buildProxyEnvironment,
} from "../../scripts/with-system-proxy.mjs";

const SYSTEM = `<dictionary> {
  HTTPEnable : 1
  HTTPProxy : 127.0.0.1
  HTTPPort : 12450
  HTTPSEnable : 1
  HTTPSProxy : 127.0.0.1
  HTTPSPort : 12450
  SOCKSEnable : 1
  SOCKSProxy : 127.0.0.1
  SOCKSPort : 12450
}`;
const options = { platform: "darwin", systemText: SYSTEM, supportsProxy: true };

test("proxy launcher arguments only allow scripts entries and pass arguments without shell parsing", () => {
  assert.deepEqual(parseArguments([]), { help: true });
  assert.deepEqual(parseArguments(["--help"]), { help: true });
  assert.deepEqual(
    parseArguments(["scripts/dev.mjs", "--mock", "$(not-a-command)"]),
    {
      help: false,
      name: "dev.mjs",
      args: ["--mock", "$(not-a-command)"],
    },
  );
  for (const input of [
    "../outside.mjs",
    "/tmp/outside.mjs",
    "scripts/../outside.mjs",
    "dev.js",
    "--eval",
    "with-system-proxy.mjs",
    "scripts/with-system-proxy.mjs",
  ]) {
    assert.throws(() => parseArguments([input]));
  }
});

test("macOS manual HTTP(S) proxies apply only to the child environment", () => {
  const original = { NODE_OPTIONS: "--trace-warnings", KEEP_ME: "unchanged" };
  const result = buildProxyEnvironment(original, options);
  assert.equal(result.source, "system");
  assert.equal(result.active, true);
  assert.equal(result.env.HTTPS_PROXY, "http://127.0.0.1:12450");
  assert.equal(result.env.NODE_OPTIONS, "--trace-warnings --use-env-proxy");
  assert.equal(result.env.KEEP_ME, "unchanged");
  assert.deepEqual(original, {
    NODE_OPTIONS: "--trace-warnings",
    KEEP_ME: "unchanged",
  });
});

test("explicit proxies take precedence, uppercase resolves ambiguity, and empty values opt out", () => {
  assert.equal(hasExplicitProxy({ HTTPS_PROXY: "" }), true);
  const explicit = buildProxyEnvironment(
    {
      HTTP_PROXY: "http://upper.example:3128",
      http_proxy: "http://lower.example:8080",
      https_proxy: "https://secure.example:8443",
    },
    options,
  );
  assert.equal(explicit.source, "environment");
  assert.equal(explicit.env.http_proxy, "http://upper.example:3128");
  assert.equal(explicit.env.HTTPS_PROXY, "https://secure.example:8443");
  const disabled = buildProxyEnvironment(
    { HTTP_PROXY: "", HTTPS_PROXY: "" },
    options,
  );
  assert.equal(disabled.active, false);
  assert.equal(disabled.env.NODE_OPTIONS, undefined);
});

test("local exclusions preserve existing uppercase/lowercase entries", () => {
  const result = buildProxyEnvironment(
    {
      NO_PROXY: "internal.example,localhost",
      no_proxy: "other.example, localhost",
    },
    options,
  );
  assert.equal(
    result.env.NO_PROXY,
    "internal.example,localhost,other.example,127.0.0.1,::1",
  );
  assert.equal(result.env.no_proxy, result.env.NO_PROXY);
});

test("invalid proxy addresses/ports fail without disclosing input or proxy credentials", () => {
  for (const value of [
    "not a URL",
    "socks5://private-user:private-password@localhost:1080",
    "http://host:70000",
    "http://host:0",
    "http://host/path",
    "http://host?q=secret",
  ]) {
    assert.throws(
      () => buildProxyEnvironment({ HTTPS_PROXY: value }, options),
      (error) => {
        assert.equal(error.message.includes(value), false);
        assert.equal(error.message.includes("private-password"), false);
        return true;
      },
    );
  }
  const credentialProxy = buildProxyEnvironment(
    { HTTPS_PROXY: "http://user:password@proxy.example:3128" },
    options,
  );
  assert.equal(credentialProxy.active, true);
  for (const port of ["0", "65536", "abc", "1.5", "-1"]) {
    assert.throws(() => parseSystemProxy(SYSTEM.replaceAll("12450", port)));
  }
  assert.throws(() =>
    parseSystemProxy(SYSTEM.replaceAll("127.0.0.1", "bad/host")),
  );
  assert.equal(
    parseSystemProxy(SYSTEM.replaceAll("127.0.0.1", "::1")).proxies.HTTPS_PROXY,
    "http://[::1]:12450",
  );
});

test("PAC and SOCKS are not guessed or converted into HTTP proxies", () => {
  const result = parseSystemProxy(
    "ProxyAutoConfigEnable : 1\nProxyAutoConfigURLString : https://example.test/proxy.pac\nSOCKSEnable : 1\nSOCKSProxy : localhost\nSOCKSPort : 1080",
  );
  assert.deepEqual(result, {
    proxies: {},
    ignoredPac: true,
    ignoredSocks: true,
  });
  const child = buildProxyEnvironment(
    {},
    {
      ...options,
      systemText:
        "ProxyAutoDiscoveryEnable : 1\nHTTPEnable : 0\nHTTPProxy : ignored\nHTTPPort : 123",
    },
  );
  assert.equal(child.active, false);
  assert.equal(child.ignoredPac, true);
});

test("non-macOS never inherits macOS settings, but honors explicit environment proxies", () => {
  assert.equal(
    buildProxyEnvironment({}, { ...options, platform: "linux" }).active,
    false,
  );
  assert.equal(
    buildProxyEnvironment(
      { HTTPS_PROXY: "http://proxy.example:3128" },
      { ...options, platform: "linux" },
    ).active,
    true,
  );
});

test("configured proxies require runtime support while direct connections do not", () => {
  assert.throws(
    () => buildProxyEnvironment({}, { ...options, supportsProxy: false }),
    /--use-env-proxy/,
  );
  assert.equal(
    buildProxyEnvironment({}, { platform: "linux", supportsProxy: false })
      .active,
    false,
  );
});
