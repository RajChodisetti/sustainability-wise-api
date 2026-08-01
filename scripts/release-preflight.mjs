#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  access,
  constants,
  lstat,
  open,
  realpath,
  stat,
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TOOL_NAME = "sustainability-wise-release-preflight";
const MANIFEST_VERSION = 1;
const TARGET_SCHEMA_VERSION = 1;
const STORAGE_APPS = ["ecoaudit", "solarsense", "installhub"];
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SHA_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const PLACEHOLDER_PATTERN =
  /(?:change[_-]?me|replace[_-]?with|example|placeholder|<[^>]+>)/i;
const TOOL_REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const HELP = `Usage:
  node scripts/release-preflight.mjs \\
    --env-file /protected/path/.env \\
    --target-file /protected/path/production-target.json \\
    --release-dir /opt/sw-releases/<sha-prefix> \\
    --expected-sha <full-git-sha>

Options:
  --env-file       Protected production environment file (required).
  --target-file    JSON target containing approved identities and SHA-256
                   fingerprints, never raw secrets (required).
  --release-dir    Immutable Git release directory to validate (required).
  --expected-sha   Exact full Git commit expected in the release (required).
  --help           Show this help.

The command performs local, read-only validation. It never connects to a
database, object storage, Microsoft Graph, or another network service. Standard
output is a single redacted JSON manifest; validation failures exit with code 1.
`;

class SafeError extends Error {
  constructor(code, field = null) {
    super(code);
    this.name = "SafeError";
    this.code = code;
    this.field = field;
  }
}

function sha256Fingerprint(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function identityFingerprint(value) {
  return sha256Fingerprint(stableJson(value));
}

function parseArgs(argv) {
  if (argv.includes("--help")) return { help: true };
  const allowed = new Set([
    "--env-file",
    "--target-file",
    "--release-dir",
    "--expected-sha",
  ]);
  const parsed = Object.create(null);
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (!allowed.has(option)) throw new SafeError("ARGUMENT_UNKNOWN");
    if (Object.hasOwn(parsed, option))
      throw new SafeError("ARGUMENT_DUPLICATE");
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new SafeError("ARGUMENT_VALUE_MISSING");
    }
    parsed[option] = value;
    index += 1;
  }
  for (const option of allowed) {
    if (!Object.hasOwn(parsed, option))
      throw new SafeError("ARGUMENT_REQUIRED");
  }
  return {
    help: false,
    envFile: path.resolve(parsed["--env-file"]),
    targetFile: path.resolve(parsed["--target-file"]),
    releaseDir: path.resolve(parsed["--release-dir"]),
    expectedSha: parsed["--expected-sha"].toLowerCase(),
  };
}

function parseStrictJson(text) {
  let cursor = 0;

  function fail() {
    throw new SafeError("TARGET_JSON_INVALID");
  }

  function whitespace() {
    while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
  }

  function stringValue() {
    if (text[cursor] !== '"') fail();
    const start = cursor;
    cursor += 1;
    let escaped = false;
    while (cursor < text.length) {
      const character = text[cursor];
      cursor += 1;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (character === '"') {
        try {
          return JSON.parse(text.slice(start, cursor));
        } catch {
          fail();
        }
      }
      if (character.charCodeAt(0) < 0x20) fail();
    }
    fail();
  }

  function numberValue() {
    const match = text
      .slice(cursor)
      .match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (!match) fail();
    cursor += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) fail();
    return value;
  }

  function arrayValue() {
    const result = [];
    cursor += 1;
    whitespace();
    if (text[cursor] === "]") {
      cursor += 1;
      return result;
    }
    while (cursor < text.length) {
      result.push(value());
      whitespace();
      if (text[cursor] === "]") {
        cursor += 1;
        return result;
      }
      if (text[cursor] !== ",") fail();
      cursor += 1;
      whitespace();
    }
    fail();
  }

  function objectValue() {
    const result = Object.create(null);
    const keys = new Set();
    cursor += 1;
    whitespace();
    if (text[cursor] === "}") {
      cursor += 1;
      return result;
    }
    while (cursor < text.length) {
      const key = stringValue();
      if (
        keys.has(key) ||
        ["__proto__", "prototype", "constructor"].includes(key)
      ) {
        throw new SafeError("TARGET_JSON_DUPLICATE_OR_UNSAFE_KEY");
      }
      keys.add(key);
      whitespace();
      if (text[cursor] !== ":") fail();
      cursor += 1;
      result[key] = value();
      whitespace();
      if (text[cursor] === "}") {
        cursor += 1;
        return result;
      }
      if (text[cursor] !== ",") fail();
      cursor += 1;
      whitespace();
    }
    fail();
  }

  function value() {
    whitespace();
    const character = text[cursor];
    if (character === '"') return stringValue();
    if (character === "{") return objectValue();
    if (character === "[") return arrayValue();
    if (text.startsWith("true", cursor)) {
      cursor += 4;
      return true;
    }
    if (text.startsWith("false", cursor)) {
      cursor += 5;
      return false;
    }
    if (text.startsWith("null", cursor)) {
      cursor += 4;
      return null;
    }
    return numberValue();
  }

  const result = value();
  whitespace();
  if (cursor !== text.length) fail();
  return result;
}

function parseEnv(text) {
  if (text.includes("\0")) throw new SafeError("ENV_SYNTAX_INVALID");
  const result = Object.create(null);
  const lines = text.replace(/\r\n?/g, "\n").split("\n");

  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    let line = lines[lineNumber].trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trimStart();
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (!match) throw new SafeError("ENV_SYNTAX_INVALID");
    const [, key] = match;
    if (Object.hasOwn(result, key))
      throw new SafeError("ENV_KEY_DUPLICATE", key);

    let raw = match[2].trimStart();
    let parsed;
    if (raw.startsWith("'")) {
      const closing = raw.indexOf("'", 1);
      if (closing === -1 || !/^(?:\s*#.*)?$/.test(raw.slice(closing + 1))) {
        throw new SafeError("ENV_SYNTAX_INVALID", key);
      }
      parsed = raw.slice(1, closing);
    } else if (raw.startsWith('"')) {
      let closing = -1;
      let escaped = false;
      for (let index = 1; index < raw.length; index += 1) {
        if (escaped) {
          escaped = false;
        } else if (raw[index] === "\\") {
          escaped = true;
        } else if (raw[index] === '"') {
          closing = index;
          break;
        }
      }
      if (closing === -1 || !/^(?:\s*#.*)?$/.test(raw.slice(closing + 1))) {
        throw new SafeError("ENV_SYNTAX_INVALID", key);
      }
      try {
        parsed = JSON.parse(raw.slice(0, closing + 1));
      } catch {
        throw new SafeError("ENV_SYNTAX_INVALID", key);
      }
      if (/\$\(|\$\{|`/.test(parsed)) {
        throw new SafeError("ENV_DYNAMIC_VALUE_REJECTED", key);
      }
    } else {
      const comment = raw.search(/\s+#/);
      if (comment !== -1) raw = raw.slice(0, comment);
      parsed = raw.trim();
      if (/\$\(|\$\{|`/.test(parsed)) {
        throw new SafeError("ENV_DYNAMIC_VALUE_REJECTED", key);
      }
    }
    result[key] = parsed;
  }
  return result;
}

function assertObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SafeError("TARGET_FIELD_INVALID", field);
  }
  return value;
}

function assertExactKeys(value, required, field) {
  const object = assertObject(value, field);
  const actual = Object.keys(object).sort();
  const expected = [...required].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new SafeError("TARGET_KEYS_INVALID", field);
  }
  return object;
}

function assertString(
  value,
  field,
  { allowEmpty = false, absolute = false } = {},
) {
  if (typeof value !== "string" || (!allowEmpty && !value)) {
    throw new SafeError("TARGET_FIELD_INVALID", field);
  }
  if (!allowEmpty && PLACEHOLDER_PATTERN.test(value)) {
    throw new SafeError("TARGET_PLACEHOLDER_REJECTED", field);
  }
  if (absolute && !path.isAbsolute(value)) {
    throw new SafeError("TARGET_FIELD_INVALID", field);
  }
  return value;
}

function assertInteger(
  value,
  field,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new SafeError("TARGET_FIELD_INVALID", field);
  }
  return value;
}

function assertBoolean(value, field) {
  if (typeof value !== "boolean")
    throw new SafeError("TARGET_FIELD_INVALID", field);
  return value;
}

function assertFingerprint(value, field, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) {
    throw new SafeError("TARGET_FINGERPRINT_INVALID", field);
  }
  const digest = value.slice("sha256:".length);
  if (/^(.)\1+$/.test(digest))
    throw new SafeError("TARGET_FINGERPRINT_INVALID", field);
  return value;
}

function assertNoRawSecrets(value, field = "target") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const childField = `${field}.${key}`;
    if (
      typeof child === "string" &&
      !HASH_PATTERN.test(child) &&
      /(?:password|secret|access.?key)/i.test(key) &&
      !/(?:sha256|fingerprint|required)/i.test(key)
    ) {
      throw new SafeError("TARGET_RAW_SECRET_KEY_REJECTED", childField);
    }
    assertNoRawSecrets(child, childField);
  }
}

function validateDestinationTarget(value, field) {
  const target = assertExactKeys(
    value,
    [
      "provider",
      "localRoot",
      "region",
      "endpoint",
      "bucket",
      "accessKeyIdSha256",
      "secretAccessKeySha256",
    ],
    field,
  );
  if (!["local", "spaces"].includes(target.provider)) {
    throw new SafeError("TARGET_FIELD_INVALID", `${field}.provider`);
  }
  if (target.provider === "local") {
    assertString(target.localRoot, `${field}.localRoot`, { absolute: true });
    for (const key of [
      "region",
      "endpoint",
      "bucket",
      "accessKeyIdSha256",
      "secretAccessKeySha256",
    ]) {
      if (target[key] !== null)
        throw new SafeError("TARGET_FIELD_INVALID", `${field}.${key}`);
    }
  } else {
    if (target.localRoot !== null)
      throw new SafeError("TARGET_FIELD_INVALID", `${field}.localRoot`);
    assertString(target.region, `${field}.region`);
    assertString(target.endpoint, `${field}.endpoint`);
    assertString(target.bucket, `${field}.bucket`);
    assertFingerprint(target.accessKeyIdSha256, `${field}.accessKeyIdSha256`);
    assertFingerprint(
      target.secretAccessKeySha256,
      `${field}.secretAccessKeySha256`,
    );
    let endpoint;
    try {
      endpoint = new URL(target.endpoint);
    } catch {
      throw new SafeError("TARGET_FIELD_INVALID", `${field}.endpoint`);
    }
    if (
      endpoint.protocol !== "https:" ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      endpoint.pathname !== "/" ||
      target.endpoint.endsWith("/")
    ) {
      throw new SafeError("TARGET_FIELD_INVALID", `${field}.endpoint`);
    }
  }
  return target;
}

function validateProtectedFileTarget(value, field) {
  const target = assertExactKeys(
    value,
    ["mode", "ownerUid", "ownerGid", "mustBeOutsideRelease"],
    field,
  );
  if (!["0400", "0600"].includes(target.mode)) {
    throw new SafeError("TARGET_FIELD_INVALID", `${field}.mode`);
  }
  assertInteger(target.ownerUid, `${field}.ownerUid`);
  assertInteger(target.ownerGid, `${field}.ownerGid`);
  if (target.mustBeOutsideRelease !== true) {
    throw new SafeError(
      "TARGET_FIELD_INVALID",
      `${field}.mustBeOutsideRelease`,
    );
  }
  return target;
}

function validateTargetFileSecurityTarget(value) {
  const target = assertExactKeys(
    value,
    [
      "root",
      "mode",
      "ownerUid",
      "ownerGid",
      "mustBeOutsideRelease",
      "mustBeOutsideRepository",
    ],
    "targetFile",
  );
  assertString(target.root, "targetFile.root", { absolute: true });
  if (!["0400", "0600"].includes(target.mode)) {
    throw new SafeError("TARGET_FIELD_INVALID", "targetFile.mode");
  }
  assertInteger(target.ownerUid, "targetFile.ownerUid");
  assertInteger(target.ownerGid, "targetFile.ownerGid");
  if (
    target.mustBeOutsideRelease !== true ||
    target.mustBeOutsideRepository !== true
  ) {
    throw new SafeError("TARGET_FIELD_INVALID", "targetFile");
  }
  return target;
}

function validateTarget(raw) {
  assertNoRawSecrets(raw);
  const target = assertExactKeys(
    raw,
    [
      "schemaVersion",
      "targetName",
      "templateNotice",
      "targetFile",
      "environmentFile",
      "release",
      "api",
      "portal",
      "database",
      "storage",
      "oneDrive",
      "security",
    ],
    "target",
  );
  if (
    target.schemaVersion !== TARGET_SCHEMA_VERSION ||
    target.targetName !== "production"
  ) {
    throw new SafeError("TARGET_IDENTITY_INVALID");
  }
  assertString(target.templateNotice, "templateNotice");

  target.targetFile = validateTargetFileSecurityTarget(target.targetFile);
  target.environmentFile = validateProtectedFileTarget(
    target.environmentFile,
    "environmentFile",
  );

  target.release = assertExactKeys(
    target.release,
    ["root", "directoryShaPrefixLength", "requireDetachedHead"],
    "release",
  );
  assertString(target.release.root, "release.root", { absolute: true });
  assertInteger(
    target.release.directoryShaPrefixLength,
    "release.directoryShaPrefixLength",
    7,
    40,
  );
  if (target.release.requireDetachedHead !== true) {
    throw new SafeError("TARGET_FIELD_INVALID", "release.requireDetachedHead");
  }

  target.api = assertExactKeys(
    target.api,
    [
      "nodeEnv",
      "host",
      "port",
      "publicBaseUrl",
      "maxUploadBytes",
      "rateLimitMax",
      "rateLimitWindowMs",
      "puppeteerExecutablePath",
    ],
    "api",
  );
  if (target.api.nodeEnv !== "production" || target.api.host !== "127.0.0.1") {
    throw new SafeError("TARGET_FIELD_INVALID", "api");
  }
  assertInteger(target.api.port, "api.port", 1, 65535);
  assertString(target.api.publicBaseUrl, "api.publicBaseUrl");
  assertInteger(target.api.maxUploadBytes, "api.maxUploadBytes", 1, 1024 ** 3);
  assertInteger(target.api.rateLimitMax, "api.rateLimitMax", 1, 1_000_000);
  assertInteger(
    target.api.rateLimitWindowMs,
    "api.rateLimitWindowMs",
    1,
    86_400_000,
  );
  assertString(
    target.api.puppeteerExecutablePath,
    "api.puppeteerExecutablePath",
    {
      absolute: true,
    },
  );
  validatePublicOrigin(target.api.publicBaseUrl, "api.publicBaseUrl");

  target.portal = assertExactKeys(
    target.portal,
    [
      "internalApiUrl",
      "publicApiUrl",
      "port",
      "registrationEnabled",
      "allowRegistration",
    ],
    "portal",
  );
  assertString(target.portal.internalApiUrl, "portal.internalApiUrl");
  assertString(target.portal.publicApiUrl, "portal.publicApiUrl");
  assertInteger(target.portal.port, "portal.port", 1, 65535);
  assertBoolean(
    target.portal.registrationEnabled,
    "portal.registrationEnabled",
  );
  assertBoolean(target.portal.allowRegistration, "portal.allowRegistration");
  if (target.portal.registrationEnabled && !target.portal.allowRegistration) {
    throw new SafeError(
      "TARGET_DANGEROUS_COMBINATION",
      "portal.registrationEnabled",
    );
  }
  validateInternalOrigin(target.portal.internalApiUrl, target.api.port);
  validatePublicOrigin(target.portal.publicApiUrl, "portal.publicApiUrl");
  if (
    target.portal.publicApiUrl !== target.api.publicBaseUrl ||
    target.portal.port === target.api.port
  ) {
    throw new SafeError("TARGET_FIELD_INVALID", "portal");
  }

  target.database = assertExactKeys(
    target.database,
    [
      "protocol",
      "hostname",
      "port",
      "database",
      "username",
      "parameters",
      "passwordSha256",
    ],
    "database",
  );
  if (!["postgres:", "postgresql:"].includes(target.database.protocol)) {
    throw new SafeError("TARGET_FIELD_INVALID", "database.protocol");
  }
  assertString(target.database.hostname, "database.hostname");
  assertInteger(target.database.port, "database.port", 1, 65535);
  assertString(target.database.database, "database.database");
  assertString(target.database.username, "database.username");
  assertFingerprint(target.database.passwordSha256, "database.passwordSha256");
  const parameters = assertObject(
    target.database.parameters,
    "database.parameters",
  );
  for (const [key, value] of Object.entries(parameters)) {
    assertString(key, "database.parameters.key");
    assertString(value, `database.parameters.${key}`, { allowEmpty: true });
  }

  target.storage = assertExactKeys(
    target.storage,
    [
      "writeMode",
      "allowLegacyMode",
      "allowLocalProvider",
      "localFallbackRoot",
      "legacy",
      "apps",
    ],
    "storage",
  );
  if (!["legacy", "dual", "isolated"].includes(target.storage.writeMode)) {
    throw new SafeError("TARGET_FIELD_INVALID", "storage.writeMode");
  }
  assertBoolean(target.storage.allowLegacyMode, "storage.allowLegacyMode");
  assertBoolean(
    target.storage.allowLocalProvider,
    "storage.allowLocalProvider",
  );
  assertString(target.storage.localFallbackRoot, "storage.localFallbackRoot", {
    absolute: true,
  });
  if (
    target.storage.writeMode === "legacy" &&
    !target.storage.allowLegacyMode
  ) {
    throw new SafeError("TARGET_DANGEROUS_COMBINATION", "storage.writeMode");
  }
  target.storage.legacy = validateDestinationTarget(
    target.storage.legacy,
    "storage.legacy",
  );
  target.storage.apps = assertExactKeys(
    target.storage.apps,
    STORAGE_APPS,
    "storage.apps",
  );
  for (const app of STORAGE_APPS) {
    target.storage.apps[app] = validateDestinationTarget(
      target.storage.apps[app],
      `storage.apps.${app}`,
    );
  }
  const destinations = [
    target.storage.legacy,
    ...STORAGE_APPS.map((app) => target.storage.apps[app]),
  ];
  if (destinations.some((destination) => destination.provider === "local")) {
    if (!target.storage.allowLocalProvider) {
      throw new SafeError(
        "TARGET_DANGEROUS_COMBINATION",
        "storage.allowLocalProvider",
      );
    }
    if (
      target.storage.writeMode !== "legacy" &&
      STORAGE_APPS.some((app) => target.storage.apps[app].provider === "local")
    ) {
      throw new SafeError("TARGET_DANGEROUS_COMBINATION", "storage.apps");
    }
  }
  assertDistinctTargetDestinations(destinations);

  target.oneDrive = assertExactKeys(
    target.oneDrive,
    [
      "enabled",
      "allowDisabled",
      "backupRequired",
      "tenantId",
      "clientId",
      "clientSecretSha256",
      "userEmail",
      "photosFolder",
      "backupRemotePath",
    ],
    "oneDrive",
  );
  for (const key of ["enabled", "allowDisabled", "backupRequired"]) {
    assertBoolean(target.oneDrive[key], `oneDrive.${key}`);
  }
  if (!target.oneDrive.enabled && !target.oneDrive.allowDisabled) {
    throw new SafeError("TARGET_DANGEROUS_COMBINATION", "oneDrive.enabled");
  }
  if (!target.oneDrive.enabled && target.oneDrive.backupRequired) {
    throw new SafeError(
      "TARGET_DANGEROUS_COMBINATION",
      "oneDrive.backupRequired",
    );
  }
  for (const key of [
    "tenantId",
    "clientId",
    "userEmail",
    "photosFolder",
    "backupRemotePath",
  ]) {
    assertString(target.oneDrive[key], `oneDrive.${key}`, {
      allowEmpty: !target.oneDrive.enabled,
    });
  }
  assertFingerprint(
    target.oneDrive.clientSecretSha256,
    "oneDrive.clientSecretSha256",
    {
      nullable: !target.oneDrive.enabled,
    },
  );

  target.security = assertExactKeys(
    target.security,
    [
      "secretSha256",
      "registrationSecretSha256",
      "uploadCapabilityTtlSeconds",
      "fileCapabilityTtlSeconds",
      "allowLegacyUnsignedUploads",
      "allowLegacyPublicFiles",
      "enableApiDocs",
      "protectApiDocs",
      "corsOrigins",
      "allowLocalBootstrap",
      "allowLegacyBootstrapUpsert",
      "allowLegacySharedRegistrationSecret",
      "approveDangerousCompatibilityFlags",
    ],
    "security",
  );
  target.security.secretSha256 = assertExactKeys(
    target.security.secretSha256,
    [
      "JWT_SECRET",
      "JWT_REFRESH_SECRET",
      "UPLOAD_CAPABILITY_SECRET",
      "FILE_CAPABILITY_SECRET",
    ],
    "security.secretSha256",
  );
  for (const [key, value] of Object.entries(target.security.secretSha256)) {
    assertFingerprint(value, `security.secretSha256.${key}`);
  }
  target.security.registrationSecretSha256 = assertExactKeys(
    target.security.registrationSecretSha256,
    [
      "REGISTRATION_SECRET",
      "ECOAUDIT_REGISTRATION_SECRET",
      "SOLARSENSE_REGISTRATION_SECRET",
      "INSTALLHUB_REGISTRATION_SECRET",
    ],
    "security.registrationSecretSha256",
  );
  for (const [key, value] of Object.entries(
    target.security.registrationSecretSha256,
  )) {
    assertFingerprint(value, `security.registrationSecretSha256.${key}`, {
      nullable: true,
    });
  }
  assertInteger(
    target.security.uploadCapabilityTtlSeconds,
    "security.uploadCapabilityTtlSeconds",
    1,
    3600,
  );
  assertInteger(
    target.security.fileCapabilityTtlSeconds,
    "security.fileCapabilityTtlSeconds",
    1,
    3600,
  );
  for (const key of [
    "allowLegacyUnsignedUploads",
    "allowLegacyPublicFiles",
    "enableApiDocs",
    "protectApiDocs",
    "allowLocalBootstrap",
    "allowLegacyBootstrapUpsert",
    "allowLegacySharedRegistrationSecret",
    "approveDangerousCompatibilityFlags",
  ]) {
    assertBoolean(target.security[key], `security.${key}`);
  }
  if (!Array.isArray(target.security.corsOrigins)) {
    throw new SafeError("TARGET_FIELD_INVALID", "security.corsOrigins");
  }
  target.security.corsOrigins.forEach((origin, index) => {
    assertString(origin, `security.corsOrigins.${index}`);
    validatePublicOrigin(origin, `security.corsOrigins.${index}`);
  });
  if (
    new Set(target.security.corsOrigins).size !==
    target.security.corsOrigins.length
  ) {
    throw new SafeError("TARGET_FIELD_INVALID", "security.corsOrigins");
  }
  const dangerousFlags = [
    target.security.allowLegacyUnsignedUploads,
    target.security.allowLegacyPublicFiles,
    target.security.enableApiDocs,
    target.security.allowLocalBootstrap,
    target.security.allowLegacyBootstrapUpsert,
    target.security.allowLegacySharedRegistrationSecret,
  ];
  if (
    dangerousFlags.some(Boolean) &&
    !target.security.approveDangerousCompatibilityFlags
  ) {
    throw new SafeError("TARGET_DANGEROUS_COMBINATION", "security");
  }
  if (!target.security.protectApiDocs) {
    throw new SafeError(
      "TARGET_DANGEROUS_COMBINATION",
      "security.protectApiDocs",
    );
  }
  if (target.portal.registrationEnabled) {
    const appFingerprints = [
      target.security.registrationSecretSha256.ECOAUDIT_REGISTRATION_SECRET,
      target.security.registrationSecretSha256.SOLARSENSE_REGISTRATION_SECRET,
    ];
    if (appFingerprints.every((value) => value === null)) {
      throw new SafeError(
        "TARGET_DANGEROUS_COMBINATION",
        "security.registrationSecretSha256",
      );
    }
  }

  return target;
}

function assertDistinctTargetDestinations(destinations) {
  const identities = destinations.map((destination) =>
    destination.provider === "spaces"
      ? `spaces:${destination.endpoint}:${destination.bucket}`
      : `local:${path.resolve(destination.localRoot)}`,
  );
  if (new Set(identities).size !== identities.length) {
    throw new SafeError("TARGET_STORAGE_DESTINATIONS_NOT_DISTINCT");
  }
  const spaces = destinations.filter(
    (destination) => destination.provider === "spaces",
  );
  const accessIds = spaces.map((destination) => destination.accessKeyIdSha256);
  const secrets = spaces.map(
    (destination) => destination.secretAccessKeySha256,
  );
  if (
    new Set(accessIds).size !== accessIds.length ||
    new Set(secrets).size !== secrets.length
  ) {
    throw new SafeError("TARGET_STORAGE_CREDENTIALS_NOT_DISTINCT");
  }
}

function validatePublicOrigin(value, field) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new SafeError("TARGET_FIELD_INVALID", field);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    value.endsWith("/") ||
    ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
  ) {
    throw new SafeError("TARGET_FIELD_INVALID", field);
  }
}

function validateInternalOrigin(value, apiPort) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new SafeError("TARGET_FIELD_INVALID", "portal.internalApiUrl");
  }
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    Number(url.port) !== apiPort ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    value.endsWith("/")
  ) {
    throw new SafeError("TARGET_FIELD_INVALID", "portal.internalApiUrl");
  }
}

class Report {
  constructor() {
    this.checks = [];
    this.failures = [];
    this.fingerprints = Object.create(null);
  }

  fail(code, field = null) {
    const failure = field ? { code, field } : { code };
    if (
      !this.failures.some((item) => item.code === code && item.field === field)
    ) {
      this.failures.push(failure);
    }
  }

  require(condition, code, field = null) {
    if (!condition) this.fail(code, field);
    return Boolean(condition);
  }

  async group(id, work) {
    const before = this.failures.length;
    try {
      await work();
    } catch (error) {
      if (error instanceof SafeError) this.fail(error.code, error.field);
      else this.fail("CHECK_INTERNAL_ERROR", id);
    }
    this.checks.push({
      id,
      status: this.failures.length === before ? "pass" : "fail",
    });
  }
}

function envRequired(env, report, key) {
  const present = Object.hasOwn(env, key);
  report.require(present, "ENV_REQUIRED", key);
  return present ? env[key] : "";
}

function compareEnv(env, report, key, expected) {
  const actual = envRequired(env, report, key);
  report.require(actual === String(expected), "ENV_IDENTITY_MISMATCH", key);
  return actual;
}

function parseEnvBoolean(env, report, key) {
  const value = envRequired(env, report, key);
  report.require(
    value === "true" || value === "false",
    "ENV_BOOLEAN_INVALID",
    key,
  );
  return value === "true";
}

function parseEnvInteger(env, report, key, minimum, maximum) {
  const value = envRequired(env, report, key);
  const valid = /^\d+$/.test(value);
  const parsed = valid ? Number(value) : Number.NaN;
  report.require(
    valid &&
      Number.isSafeInteger(parsed) &&
      parsed >= minimum &&
      parsed <= maximum,
    "ENV_INTEGER_INVALID",
    key,
  );
  return parsed;
}

function compareFingerprint(env, report, key, expected, minimumLength = 16) {
  const value = envRequired(env, report, key);
  const fingerprint = sha256Fingerprint(value);
  const strong =
    value.length >= minimumLength && !PLACEHOLDER_PATTERN.test(value);
  const matches = strong && fingerprint === expected;
  report.require(strong, "ENV_SECRET_WEAK_OR_PLACEHOLDER", key);
  report.require(matches, "ENV_FINGERPRINT_MISMATCH", key);
  if (matches) report.fingerprints[key] = expected;
  return value;
}

function compareNullableFingerprint(
  env,
  report,
  key,
  expected,
  minimumLength = 16,
) {
  const value = envRequired(env, report, key);
  if (expected === null) {
    report.require(value === "", "ENV_EXPECTED_EMPTY", key);
    return value;
  }
  return compareFingerprint(env, report, key, expected, minimumLength);
}

async function readProtectedTargetFile(args) {
  const info = await lstat(args.targetFile).catch(() => null);
  if (!info) throw new SafeError("TARGET_FILE_NOT_FOUND");
  if (!info.isFile()) throw new SafeError("TARGET_FILE_NOT_REGULAR");
  if (info.isSymbolicLink())
    throw new SafeError("TARGET_FILE_SYMLINK_REJECTED");
  const mode = info.mode & 0o777;
  if (!["0400", "0600"].includes(mode.toString(8).padStart(4, "0"))) {
    throw new SafeError("TARGET_FILE_MODE_UNSAFE");
  }
  if ((mode & 0o077) !== 0) {
    throw new SafeError("TARGET_FILE_PERMISSIONS_UNSAFE");
  }
  if (typeof process.getuid === "function" && info.uid !== process.getuid()) {
    throw new SafeError("TARGET_FILE_NOT_OWNED_BY_CALLER");
  }

  const handle = await open(
    args.targetFile,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  ).catch(() => null);
  if (!handle) throw new SafeError("TARGET_FILE_OPEN_FAILED");
  try {
    const openedInfo = await handle.stat();
    if (openedInfo.dev !== info.dev || openedInfo.ino !== info.ino) {
      throw new SafeError("TARGET_FILE_CHANGED_DURING_CHECK");
    }
    return {
      info,
      text: await handle.readFile({ encoding: "utf8" }),
    };
  } finally {
    await handle.close();
  }
}

function validateTargetFileMetadata(info, target) {
  const expectedMode = Number.parseInt(target.targetFile.mode, 8);
  if ((info.mode & 0o777) !== expectedMode) {
    throw new SafeError("TARGET_FILE_MODE_MISMATCH");
  }
  if (info.uid !== target.targetFile.ownerUid) {
    throw new SafeError("TARGET_FILE_OWNER_MISMATCH");
  }
  if (info.gid !== target.targetFile.ownerGid) {
    throw new SafeError("TARGET_FILE_GROUP_MISMATCH");
  }
}

async function readProtectedEnv(args, target, report) {
  const info = await lstat(args.envFile).catch(() => null);
  report.require(Boolean(info), "ENV_FILE_NOT_FOUND");
  if (!info) return Object.create(null);
  report.require(info.isFile(), "ENV_FILE_NOT_REGULAR");
  report.require(!info.isSymbolicLink(), "ENV_FILE_SYMLINK_REJECTED");
  const expectedMode = Number.parseInt(target.environmentFile.mode, 8);
  const actualMode = info.mode & 0o777;
  report.require(actualMode === expectedMode, "ENV_FILE_MODE_MISMATCH");
  report.require((actualMode & 0o077) === 0, "ENV_FILE_PERMISSIONS_UNSAFE");
  report.require(
    info.uid === target.environmentFile.ownerUid,
    "ENV_FILE_OWNER_MISMATCH",
  );
  report.require(
    info.gid === target.environmentFile.ownerGid,
    "ENV_FILE_GROUP_MISMATCH",
  );

  const handle = await open(
    args.envFile,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  ).catch(() => null);
  report.require(Boolean(handle), "ENV_FILE_OPEN_FAILED");
  if (!handle) return Object.create(null);
  try {
    const openedInfo = await handle.stat();
    report.require(
      openedInfo.dev === info.dev && openedInfo.ino === info.ino,
      "ENV_FILE_CHANGED_DURING_CHECK",
    );
    const text = await handle.readFile({ encoding: "utf8" });
    return parseEnv(text);
  } finally {
    await handle.close();
  }
}

function compareDestinationEnv(env, report, target, prefix, field) {
  const providerKey = `${prefix}STORAGE_PROVIDER`;
  const provider = compareEnv(env, report, providerKey, target.provider);
  if (target.provider === "local") {
    const rootKey = `${prefix}LOCAL_FILE_STORAGE_ROOT`;
    compareEnv(env, report, rootKey, target.localRoot);
    return {
      provider,
      identity: `local:${path.resolve(env[rootKey] || "/")}`,
      accessKeyId: null,
      secretAccessKey: null,
    };
  }

  const regionKey = `${prefix}SPACES_REGION`;
  const endpointKey = `${prefix}SPACES_ENDPOINT`;
  const bucketKey = `${prefix}SPACES_BUCKET`;
  const accessKey = `${prefix}SPACES_ACCESS_KEY_ID`;
  const secretKey = `${prefix}SPACES_SECRET_ACCESS_KEY`;
  const region = compareEnv(env, report, regionKey, target.region);
  const endpoint = compareEnv(env, report, endpointKey, target.endpoint);
  const bucket = compareEnv(env, report, bucketKey, target.bucket);
  const accessKeyId = compareFingerprint(
    env,
    report,
    accessKey,
    target.accessKeyIdSha256,
    8,
  );
  const secretAccessKey = compareFingerprint(
    env,
    report,
    secretKey,
    target.secretAccessKeySha256,
    16,
  );
  report.require(
    endpoint.startsWith("https://"),
    "STORAGE_ENDPOINT_INSECURE",
    endpointKey,
  );
  if (report.failures.every((failure) => !failure.field?.startsWith(field))) {
    report.fingerprints[`${field}.identity`] = identityFingerprint({
      provider,
      region,
      endpoint,
      bucket,
    });
  }
  return {
    provider,
    identity: `spaces:${endpoint}:${bucket}`,
    accessKeyId,
    secretAccessKey,
  };
}

function git(args, releaseDir) {
  const result = spawnSync("git", ["-C", releaseDir, ...args], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      LANG: "C",
      LC_ALL: "C",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    },
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) throw new SafeError("RELEASE_GIT_CHECK_FAILED");
  return result.stdout.trim();
}

async function validateRelease(args, target, report) {
  report.require(SHA_PATTERN.test(args.expectedSha), "EXPECTED_SHA_INVALID");
  if (!SHA_PATTERN.test(args.expectedSha)) return;

  const [releaseInfo, releaseReal, rootReal] = await Promise.all([
    lstat(args.releaseDir).catch(() => null),
    realpath(args.releaseDir).catch(() => null),
    realpath(target.release.root).catch(() => null),
  ]);
  report.require(
    Boolean(releaseInfo?.isDirectory()),
    "RELEASE_DIRECTORY_INVALID",
  );
  report.require(
    !releaseInfo?.isSymbolicLink(),
    "RELEASE_DIRECTORY_SYMLINK_REJECTED",
  );
  report.require(Boolean(releaseReal && rootReal), "RELEASE_PATH_UNRESOLVED");
  if (!releaseReal || !rootReal) return;
  report.require(
    path.dirname(releaseReal) === rootReal,
    "RELEASE_OUTSIDE_APPROVED_ROOT",
  );
  const expectedName = args.expectedSha.slice(
    0,
    target.release.directoryShaPrefixLength,
  );
  report.require(
    path.basename(releaseReal) === expectedName,
    "RELEASE_DIRECTORY_NAME_MISMATCH",
  );
  const topLevel = git(["rev-parse", "--show-toplevel"], releaseReal);
  report.require(
    path.resolve(topLevel) === releaseReal,
    "RELEASE_GIT_ROOT_MISMATCH",
  );
  const head = git(["rev-parse", "HEAD"], releaseReal).toLowerCase();
  report.require(head === args.expectedSha, "RELEASE_SHA_MISMATCH");
  const statusOutput = git(
    ["status", "--porcelain=v1", "--untracked-files=all"],
    releaseReal,
  );
  report.require(statusOutput === "", "RELEASE_DIRTY");
  if (target.release.requireDetachedHead) {
    const symbolic = spawnSync(
      "git",
      ["-C", releaseReal, "symbolic-ref", "-q", "HEAD"],
      {
        encoding: "utf8",
        env: {
          PATH: process.env.PATH,
          LANG: "C",
          LC_ALL: "C",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_TERMINAL_PROMPT: "0",
        },
      },
    );
    report.require(symbolic.status === 1, "RELEASE_NOT_DETACHED");
  }
  if (head === args.expectedSha && statusOutput === "") {
    report.fingerprints.release = {
      commitSha: head,
      directoryIdentitySha256: identityFingerprint({
        root: target.release.root,
        directory: expectedName,
      }),
    };
  }
}

function within(parent, child) {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function canonicalDatabaseIdentity(url, parameters) {
  return {
    protocol: url.protocol,
    hostname: url.hostname,
    port: Number(url.port),
    database: decodeURIComponent(url.pathname.slice(1)),
    username: decodeURIComponent(url.username),
    parameters,
  };
}

async function validateEnvironment(args, target, env, report) {
  await report.group("protected-file-boundaries", async () => {
    const envReal = await realpath(args.envFile).catch(() => null);
    const targetReal = await realpath(args.targetFile).catch(() => null);
    const releaseReal = await realpath(args.releaseDir).catch(() => null);
    const targetRootReal = await realpath(target.targetFile.root).catch(
      () => null,
    );
    const toolRepositoryReal = await realpath(TOOL_REPOSITORY_ROOT).catch(
      () => null,
    );
    report.require(
      Boolean(
        envReal &&
        targetReal &&
        releaseReal &&
        targetRootReal &&
        toolRepositoryReal,
      ),
      "PROTECTED_FILE_PATH_UNRESOLVED",
    );
    if (envReal && releaseReal) {
      report.require(!within(releaseReal, envReal), "ENV_FILE_INSIDE_RELEASE");
    }
    if (targetReal && releaseReal && targetRootReal && toolRepositoryReal) {
      report.require(
        !within(releaseReal, targetReal),
        "TARGET_FILE_INSIDE_RELEASE",
      );
      report.require(
        !within(toolRepositoryReal, targetReal),
        "TARGET_FILE_INSIDE_REPOSITORY",
      );
      report.require(
        path.dirname(targetReal) === targetRootReal,
        "TARGET_FILE_OUTSIDE_APPROVED_ROOT",
      );
    }
  });

  await report.group("api-and-portal-identities", async () => {
    const apiActual = {
      nodeEnv: compareEnv(env, report, "NODE_ENV", target.api.nodeEnv),
      host: compareEnv(env, report, "HOST", target.api.host),
      port: parseEnvInteger(env, report, "PORT", 1, 65535),
      publicBaseUrl: compareEnv(
        env,
        report,
        "PUBLIC_BASE_URL",
        target.api.publicBaseUrl,
      ),
      maxUploadBytes: parseEnvInteger(
        env,
        report,
        "MAX_UPLOAD_BYTES",
        1,
        1024 ** 3,
      ),
      rateLimitMax: parseEnvInteger(
        env,
        report,
        "RATE_LIMIT_MAX",
        1,
        1_000_000,
      ),
      rateLimitWindowMs: parseEnvInteger(
        env,
        report,
        "RATE_LIMIT_WINDOW_MS",
        1,
        86_400_000,
      ),
      puppeteerExecutablePath: compareEnv(
        env,
        report,
        "PUPPETEER_EXECUTABLE_PATH",
        target.api.puppeteerExecutablePath,
      ),
    };
    report.require(
      apiActual.nodeEnv === "production",
      "NODE_ENV_NOT_PRODUCTION",
      "NODE_ENV",
    );
    report.require(
      apiActual.host === "127.0.0.1",
      "API_HOST_NOT_LOOPBACK",
      "HOST",
    );
    report.require(
      apiActual.port === target.api.port &&
        apiActual.maxUploadBytes === target.api.maxUploadBytes &&
        apiActual.rateLimitMax === target.api.rateLimitMax &&
        apiActual.rateLimitWindowMs === target.api.rateLimitWindowMs,
      "API_NUMERIC_IDENTITY_MISMATCH",
    );
    try {
      validatePublicOrigin(apiActual.publicBaseUrl, "PUBLIC_BASE_URL");
    } catch (error) {
      report.fail(error.code, "PUBLIC_BASE_URL");
    }
    const insecureOverride = env.ALLOW_INSECURE_PUBLIC_BASE_URL;
    report.require(
      insecureOverride === undefined || insecureOverride === "false",
      "INSECURE_PUBLIC_BASE_OVERRIDE",
      "ALLOW_INSECURE_PUBLIC_BASE_URL",
    );

    const portalActual = {
      internalApiUrl: compareEnv(
        env,
        report,
        "INTERNAL_API_URL",
        target.portal.internalApiUrl,
      ),
      publicApiUrl: compareEnv(
        env,
        report,
        "NEXT_PUBLIC_API_URL",
        target.portal.publicApiUrl,
      ),
      port: parseEnvInteger(env, report, "ECOSENSE_PORTAL_PORT", 1, 65535),
      registrationEnabled: parseEnvBoolean(
        env,
        report,
        "PORTAL_REGISTRATION_ENABLED",
      ),
    };
    report.require(
      portalActual.port === target.portal.port,
      "PORTAL_PORT_MISMATCH",
    );
    report.require(
      portalActual.registrationEnabled === target.portal.registrationEnabled,
      "PORTAL_REGISTRATION_MISMATCH",
    );
    try {
      validateInternalOrigin(portalActual.internalApiUrl, target.api.port);
      validatePublicOrigin(portalActual.publicApiUrl, "NEXT_PUBLIC_API_URL");
    } catch (error) {
      report.fail(error.code, error.field);
    }
    for (const key of Object.keys(env)) {
      if (/^NEXT_PUBLIC_.*SECRET/i.test(key)) {
        report.fail("PUBLIC_SECRET_ENV_REJECTED", key);
      }
    }
    const executableMatches =
      apiActual.puppeteerExecutablePath === target.api.puppeteerExecutablePath;
    if (executableMatches) {
      const executableInfo = await stat(
        apiActual.puppeteerExecutablePath,
      ).catch(() => null);
      report.require(
        Boolean(executableInfo?.isFile()),
        "PUPPETEER_EXECUTABLE_MISSING",
      );
      if (executableInfo?.isFile()) {
        const executable = await access(
          apiActual.puppeteerExecutablePath,
          constants.X_OK,
        ).then(
          () => true,
          () => false,
        );
        report.require(executable, "PUPPETEER_NOT_EXECUTABLE");
      }
    }
    if (
      report.failures.every(
        (failure) =>
          ![
            "NODE_ENV",
            "HOST",
            "PORT",
            "PUBLIC_BASE_URL",
            "MAX_UPLOAD_BYTES",
            "RATE_LIMIT_MAX",
            "RATE_LIMIT_WINDOW_MS",
            "PUPPETEER_EXECUTABLE_PATH",
            "INTERNAL_API_URL",
            "NEXT_PUBLIC_API_URL",
            "ECOSENSE_PORTAL_PORT",
            "PORTAL_REGISTRATION_ENABLED",
          ].includes(failure.field),
      )
    ) {
      report.fingerprints.apiIdentity = identityFingerprint(apiActual);
      report.fingerprints.portalIdentity = identityFingerprint(portalActual);
    }
  });

  await report.group("database-identity", async () => {
    const databaseUrlValue = envRequired(env, report, "DATABASE_URL");
    let url;
    try {
      url = new URL(databaseUrlValue);
    } catch {
      report.fail("DATABASE_URL_INVALID", "DATABASE_URL");
      return;
    }
    const parameters = Object.create(null);
    let duplicateParameter = false;
    for (const [key, value] of url.searchParams) {
      if (Object.hasOwn(parameters, key)) duplicateParameter = true;
      parameters[key] = value;
    }
    report.require(
      !duplicateParameter,
      "DATABASE_PARAMETERS_DUPLICATE",
      "DATABASE_URL",
    );
    const actual = canonicalDatabaseIdentity(url, parameters);
    const expected = {
      protocol: target.database.protocol,
      hostname: target.database.hostname,
      port: target.database.port,
      database: target.database.database,
      username: target.database.username,
      parameters: target.database.parameters,
    };
    report.require(
      stableJson(actual) === stableJson(expected),
      "DATABASE_IDENTITY_MISMATCH",
    );
    const password = decodeURIComponent(url.password);
    const passwordMatches =
      password.length >= 16 &&
      !PLACEHOLDER_PATTERN.test(password) &&
      sha256Fingerprint(password) === target.database.passwordSha256;
    report.require(passwordMatches, "DATABASE_PASSWORD_FINGERPRINT_MISMATCH");
    report.require(
      parameters.sslmode === "require" || parameters.sslmode === "verify-full",
      "DATABASE_SSL_REQUIRED",
    );
    if (stableJson(actual) === stableJson(expected) && passwordMatches) {
      report.fingerprints.databaseIdentity = identityFingerprint(actual);
      report.fingerprints.DATABASE_PASSWORD = target.database.passwordSha256;
    }
  });

  await report.group("storage-identities", async () => {
    const writeMode = compareEnv(
      env,
      report,
      "STORAGE_WRITE_MODE",
      target.storage.writeMode,
    );
    report.require(
      ["legacy", "dual", "isolated"].includes(writeMode),
      "STORAGE_WRITE_MODE_INVALID",
    );
    if (writeMode === "legacy") {
      report.require(
        target.storage.allowLegacyMode,
        "STORAGE_LEGACY_MODE_UNAPPROVED",
      );
    }
    compareEnv(
      env,
      report,
      "LOCAL_FILE_STORAGE_ROOT",
      target.storage.localFallbackRoot,
    );
    const destinations = [
      compareDestinationEnv(
        env,
        report,
        target.storage.legacy,
        "",
        "storage.legacy",
      ),
    ];
    for (const app of STORAGE_APPS) {
      destinations.push(
        compareDestinationEnv(
          env,
          report,
          target.storage.apps[app],
          `${app.toUpperCase()}_`,
          `storage.apps.${app}`,
        ),
      );
    }
    const actualIdentities = destinations.map(
      (destination) => destination.identity,
    );
    const actualAccessIds = destinations
      .filter((destination) => destination.provider === "spaces")
      .map((destination) => destination.accessKeyId);
    const actualSecrets = destinations
      .filter((destination) => destination.provider === "spaces")
      .map((destination) => destination.secretAccessKey);
    report.require(
      new Set(actualIdentities).size === actualIdentities.length,
      "STORAGE_DESTINATIONS_NOT_DISTINCT",
    );
    report.require(
      new Set(actualAccessIds).size === actualAccessIds.length,
      "STORAGE_ACCESS_KEYS_NOT_DISTINCT",
    );
    report.require(
      new Set(actualSecrets).size === actualSecrets.length,
      "STORAGE_SECRET_KEYS_NOT_DISTINCT",
    );
    if (writeMode === "dual" || writeMode === "isolated") {
      report.require(
        destinations
          .slice(1)
          .every((destination) => destination.provider === "spaces"),
        "STORAGE_APP_PROVIDER_UNSAFE",
      );
    }
  });

  await report.group("onedrive-identities", async () => {
    const enabled = parseEnvBoolean(
      env,
      report,
      "ONEDRIVE_PHOTO_BACKUP_ENABLED",
    );
    const backupRequired = parseEnvBoolean(
      env,
      report,
      "ONEDRIVE_BACKUP_REQUIRED",
    );
    report.require(
      enabled === target.oneDrive.enabled,
      "ONEDRIVE_ENABLED_MISMATCH",
    );
    report.require(
      backupRequired === target.oneDrive.backupRequired,
      "ONEDRIVE_REQUIRED_MISMATCH",
    );
    report.require(
      !(backupRequired && !enabled),
      "ONEDRIVE_REQUIRED_BUT_DISABLED",
    );
    if (!enabled)
      report.require(
        target.oneDrive.allowDisabled,
        "ONEDRIVE_DISABLED_UNAPPROVED",
      );
    const actual = {
      enabled,
      backupRequired,
      tenantId: compareEnv(
        env,
        report,
        "AZURE_TENANT_ID",
        target.oneDrive.tenantId,
      ),
      clientId: compareEnv(
        env,
        report,
        "AZURE_CLIENT_ID",
        target.oneDrive.clientId,
      ),
      userEmail: compareEnv(
        env,
        report,
        "ONEDRIVE_USER_EMAIL",
        target.oneDrive.userEmail,
      ),
      photosFolder: compareEnv(
        env,
        report,
        "ONEDRIVE_PHOTOS_FOLDER",
        target.oneDrive.photosFolder,
      ),
      backupRemotePath: compareEnv(
        env,
        report,
        "BACKUP_REMOTE_PATH",
        target.oneDrive.backupRemotePath,
      ),
    };
    compareNullableFingerprint(
      env,
      report,
      "AZURE_CLIENT_SECRET",
      target.oneDrive.clientSecretSha256,
      16,
    );
    if (enabled) {
      report.require(
        [
          actual.tenantId,
          actual.clientId,
          actual.userEmail,
          actual.photosFolder,
          actual.backupRemotePath,
        ].every(Boolean),
        "ONEDRIVE_CONFIGURATION_INCOMPLETE",
      );
    }
    const identityMatches =
      actual.tenantId === target.oneDrive.tenantId &&
      actual.clientId === target.oneDrive.clientId &&
      actual.userEmail === target.oneDrive.userEmail &&
      actual.photosFolder === target.oneDrive.photosFolder &&
      actual.backupRemotePath === target.oneDrive.backupRemotePath &&
      enabled === target.oneDrive.enabled &&
      backupRequired === target.oneDrive.backupRequired;
    if (identityMatches)
      report.fingerprints.oneDriveIdentity = identityFingerprint(actual);
  });

  await report.group("security-posture", async () => {
    const coreSecrets = [];
    for (const [key, expected] of Object.entries(
      target.security.secretSha256,
    )) {
      coreSecrets.push(compareFingerprint(env, report, key, expected, 32));
    }
    report.require(
      new Set(coreSecrets).size === coreSecrets.length,
      "CORE_SECRETS_NOT_DISTINCT",
    );
    for (const [key, expected] of Object.entries(
      target.security.registrationSecretSha256,
    )) {
      compareNullableFingerprint(env, report, key, expected, 32);
    }
    const uploadTtl = parseEnvInteger(
      env,
      report,
      "UPLOAD_CAPABILITY_TTL_SECONDS",
      1,
      3600,
    );
    const fileTtl = parseEnvInteger(
      env,
      report,
      "FILE_CAPABILITY_TTL_SECONDS",
      1,
      3600,
    );
    report.require(
      uploadTtl === target.security.uploadCapabilityTtlSeconds,
      "UPLOAD_TTL_MISMATCH",
    );
    report.require(
      fileTtl === target.security.fileCapabilityTtlSeconds,
      "FILE_TTL_MISMATCH",
    );

    const booleanFields = {
      ALLOW_LEGACY_UNSIGNED_UPLOADS: target.security.allowLegacyUnsignedUploads,
      ALLOW_LEGACY_PUBLIC_FILES: target.security.allowLegacyPublicFiles,
      ENABLE_API_DOCS: target.security.enableApiDocs,
      PROTECT_API_DOCS: target.security.protectApiDocs,
      ALLOW_LOCAL_BOOTSTRAP: target.security.allowLocalBootstrap,
      ALLOW_LEGACY_BOOTSTRAP_UPSERT: target.security.allowLegacyBootstrapUpsert,
      ALLOW_LEGACY_SHARED_REGISTRATION_SECRET:
        target.security.allowLegacySharedRegistrationSecret,
    };
    const actualFlags = Object.create(null);
    for (const [key, expected] of Object.entries(booleanFields)) {
      actualFlags[key] = parseEnvBoolean(env, report, key);
      report.require(
        actualFlags[key] === expected,
        "SECURITY_FLAG_MISMATCH",
        key,
      );
    }
    const dangerousEnabled = [
      actualFlags.ALLOW_LEGACY_UNSIGNED_UPLOADS,
      actualFlags.ALLOW_LEGACY_PUBLIC_FILES,
      actualFlags.ENABLE_API_DOCS,
      actualFlags.ALLOW_LOCAL_BOOTSTRAP,
      actualFlags.ALLOW_LEGACY_BOOTSTRAP_UPSERT,
      actualFlags.ALLOW_LEGACY_SHARED_REGISTRATION_SECRET,
    ].some(Boolean);
    report.require(
      !dangerousEnabled || target.security.approveDangerousCompatibilityFlags,
      "DANGEROUS_COMPATIBILITY_FLAGS_UNAPPROVED",
    );
    report.require(actualFlags.PROTECT_API_DOCS, "API_DOCS_UNPROTECTED");

    const corsOrigins = envRequired(env, report, "CORS_ORIGINS")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    report.require(
      stableJson(corsOrigins) === stableJson(target.security.corsOrigins),
      "CORS_ORIGINS_MISMATCH",
    );
    report.require(!corsOrigins.includes("*"), "CORS_WILDCARD_REJECTED");
    if (
      uploadTtl === target.security.uploadCapabilityTtlSeconds &&
      fileTtl === target.security.fileCapabilityTtlSeconds &&
      stableJson(corsOrigins) === stableJson(target.security.corsOrigins)
    ) {
      report.fingerprints.securityPosture = identityFingerprint({
        uploadTtl,
        fileTtl,
        flags: actualFlags,
        corsOrigins,
      });
    }
  });
}

function sortedManifest(
  report,
  targetFileFingerprint,
  targetName = "production",
) {
  const failures = [...report.failures].sort((left, right) =>
    `${left.code}:${left.field ?? ""}`.localeCompare(
      `${right.code}:${right.field ?? ""}`,
    ),
  );
  const checks = [...report.checks].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  return {
    manifestVersion: MANIFEST_VERSION,
    tool: TOOL_NAME,
    target: targetName,
    status: failures.length === 0 ? "pass" : "fail",
    generatedAt: new Date().toISOString(),
    checks,
    failures,
    fingerprints: {
      targetFile: targetFileFingerprint,
      ...report.fingerprints,
    },
  };
}

function fatalManifest(error) {
  const safe =
    error instanceof SafeError
      ? { code: error.code, ...(error.field ? { field: error.field } : {}) }
      : { code: "PREFLIGHT_INTERNAL_ERROR" };
  return {
    manifestVersion: MANIFEST_VERSION,
    tool: TOOL_NAME,
    target: "production",
    status: "fail",
    generatedAt: new Date().toISOString(),
    checks: [],
    failures: [safe],
    fingerprints: {},
  };
}

async function runPreflight(args) {
  if (!SHA_PATTERN.test(args.expectedSha))
    throw new SafeError("EXPECTED_SHA_INVALID");

  const protectedTarget = await readProtectedTargetFile(args);
  const targetFileFingerprint = sha256Fingerprint(protectedTarget.text);
  const target = validateTarget(parseStrictJson(protectedTarget.text));
  validateTargetFileMetadata(protectedTarget.info, target);
  const report = new Report();
  let env = Object.create(null);

  await report.group("protected-environment-file", async () => {
    env = await readProtectedEnv(args, target, report);
  });
  await report.group("immutable-release", async () => {
    await validateRelease(args, target, report);
  });
  await validateEnvironment(args, target, env, report);

  return sortedManifest(report, targetFileFingerprint, target.targetName);
}

async function cli(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv);
    if (args.help) {
      process.stdout.write(HELP);
      return 0;
    }
    const manifest = await runPreflight(args);
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
    return manifest.status === "pass" ? 0 : 1;
  } catch (error) {
    process.stdout.write(`${JSON.stringify(fatalManifest(error), null, 2)}\n`);
    return 1;
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  process.exitCode = await cli();
}

export { cli, parseEnv, parseStrictJson, runPreflight, sha256Fingerprint };
