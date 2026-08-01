import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmod,
  mkdtemp,
  mkdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  parseStrictJson,
  runPreflight,
  sha256Fingerprint,
} from "./release-preflight.mjs";

const scriptPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "release-preflight.mjs",
);

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function destination(name) {
  return {
    provider: "spaces",
    localRoot: null,
    region: "syd1",
    endpoint: "https://syd1.digitaloceanspaces.com",
    bucket: `sw-${name}-prod`,
    accessKeyIdSha256: sha256Fingerprint(`access-key-${name}-production`),
    secretAccessKeySha256: sha256Fingerprint(
      `secret-key-${name}-production-0123456789`,
    ),
  };
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "sw-release-preflight-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const source = path.join(root, "source");
  const releases = path.join(root, "releases");
  const chromium = path.join(root, "chromium");
  const envFile = path.join(root, "production.env");
  const targetFile = path.join(root, "production-target.json");
  await mkdir(source);
  await mkdir(releases);
  await writeFile(chromium, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  git(source, "init", "--quiet");
  git(source, "config", "user.name", "Release Test");
  git(source, "config", "user.email", "release-test@example.invalid");
  await writeFile(path.join(source, "release.txt"), "immutable\n");
  git(source, "add", "release.txt");
  git(source, "commit", "--quiet", "-m", "fixture");
  const expectedSha = git(source, "rev-parse", "HEAD");
  git(source, "checkout", "--quiet", "--detach", expectedSha);
  const releaseDir = path.join(releases, expectedSha.slice(0, 7));
  await rename(source, releaseDir);

  const values = {
    databasePassword: "database-password-production-0123456789",
    jwt: "jwt-secret-production-012345678901234567890123",
    refresh: "refresh-secret-production-012345678901234567",
    upload: "upload-secret-production-0123456789012345678",
    file: "file-secret-production-012345678901234567890",
    azure: "azure-secret-production-01234567890123456789",
    legacyAccess: "access-key-legacy-production",
    legacySecret: "secret-key-legacy-production-0123456789",
    ecoAccess: "access-key-ecoaudit-production",
    ecoSecret: "secret-key-ecoaudit-production-0123456789",
    solarAccess: "access-key-solarsense-production",
    solarSecret: "secret-key-solarsense-production-0123456789",
    installAccess: "access-key-installhub-production",
    installSecret: "secret-key-installhub-production-0123456789",
  };
  const env = [
    "NODE_ENV=production",
    "HOST=127.0.0.1",
    "PORT=3000",
    "PUBLIC_BASE_URL=https://api.prod.invalid",
    `DATABASE_URL=postgresql://sw_api:${values.databasePassword}@db.prod.invalid:25060/sustainability_wise?sslmode=require`,
    `JWT_SECRET=${values.jwt}`,
    `JWT_REFRESH_SECRET=${values.refresh}`,
    `UPLOAD_CAPABILITY_SECRET=${values.upload}`,
    "UPLOAD_CAPABILITY_TTL_SECONDS=900",
    "ALLOW_LEGACY_UNSIGNED_UPLOADS=false",
    `FILE_CAPABILITY_SECRET=${values.file}`,
    "FILE_CAPABILITY_TTL_SECONDS=300",
    "ALLOW_LEGACY_PUBLIC_FILES=false",
    "STORAGE_PROVIDER=spaces",
    "STORAGE_WRITE_MODE=isolated",
    "LOCAL_FILE_STORAGE_ROOT=/var/lib/sustainability-wise-api/uploads",
    "MAX_UPLOAD_BYTES=52428800",
    "SPACES_REGION=syd1",
    "SPACES_ENDPOINT=https://syd1.digitaloceanspaces.com",
    "SPACES_BUCKET=sw-legacy-prod",
    `SPACES_ACCESS_KEY_ID=${values.legacyAccess}`,
    `SPACES_SECRET_ACCESS_KEY=${values.legacySecret}`,
    "ECOAUDIT_STORAGE_PROVIDER=spaces",
    "ECOAUDIT_SPACES_REGION=syd1",
    "ECOAUDIT_SPACES_ENDPOINT=https://syd1.digitaloceanspaces.com",
    "ECOAUDIT_SPACES_BUCKET=sw-ecoaudit-prod",
    `ECOAUDIT_SPACES_ACCESS_KEY_ID=${values.ecoAccess}`,
    `ECOAUDIT_SPACES_SECRET_ACCESS_KEY=${values.ecoSecret}`,
    "SOLARSENSE_STORAGE_PROVIDER=spaces",
    "SOLARSENSE_SPACES_REGION=syd1",
    "SOLARSENSE_SPACES_ENDPOINT=https://syd1.digitaloceanspaces.com",
    "SOLARSENSE_SPACES_BUCKET=sw-solarsense-prod",
    `SOLARSENSE_SPACES_ACCESS_KEY_ID=${values.solarAccess}`,
    `SOLARSENSE_SPACES_SECRET_ACCESS_KEY=${values.solarSecret}`,
    "INSTALLHUB_STORAGE_PROVIDER=spaces",
    "INSTALLHUB_SPACES_REGION=syd1",
    "INSTALLHUB_SPACES_ENDPOINT=https://syd1.digitaloceanspaces.com",
    "INSTALLHUB_SPACES_BUCKET=sw-installhub-prod",
    `INSTALLHUB_SPACES_ACCESS_KEY_ID=${values.installAccess}`,
    `INSTALLHUB_SPACES_SECRET_ACCESS_KEY=${values.installSecret}`,
    "ENABLE_API_DOCS=false",
    "PROTECT_API_DOCS=true",
    "CORS_ORIGINS=",
    "ALLOW_LOCAL_BOOTSTRAP=false",
    "ALLOW_LEGACY_BOOTSTRAP_UPSERT=false",
    "ALLOW_LEGACY_SHARED_REGISTRATION_SECRET=false",
    "RATE_LIMIT_MAX=300",
    "RATE_LIMIT_WINDOW_MS=60000",
    "REGISTRATION_SECRET=",
    "ECOAUDIT_REGISTRATION_SECRET=",
    "SOLARSENSE_REGISTRATION_SECRET=",
    "INSTALLHUB_REGISTRATION_SECRET=",
    "AZURE_TENANT_ID=tenant-production",
    "AZURE_CLIENT_ID=client-production",
    `AZURE_CLIENT_SECRET=${values.azure}`,
    "ONEDRIVE_USER_EMAIL=backups@prod.invalid",
    "ONEDRIVE_PHOTO_BACKUP_ENABLED=true",
    "ONEDRIVE_PHOTOS_FOLDER=SustainabilityWise/photos",
    "ONEDRIVE_BACKUP_REQUIRED=false",
    "BACKUP_REMOTE_PATH=onedrive:SustainabilityWise/backups",
    "NEXT_PUBLIC_API_URL=https://api.prod.invalid",
    "INTERNAL_API_URL=http://127.0.0.1:3000",
    "ECOSENSE_PORTAL_PORT=3210",
    "PORTAL_REGISTRATION_ENABLED=false",
    `PUPPETEER_EXECUTABLE_PATH=${chromium}`,
    "",
  ].join("\n");
  await writeFile(envFile, env, { mode: 0o600 });
  await chmod(envFile, 0o600);
  const envInfo = await stat(envFile);

  const target = {
    schemaVersion: 1,
    targetName: "production",
    templateNotice:
      "All fixture fingerprint and identity fields are populated.",
    targetFile: {
      root,
      mode: "0600",
      ownerUid: envInfo.uid,
      ownerGid: envInfo.gid,
      mustBeOutsideRelease: true,
      mustBeOutsideRepository: true,
    },
    environmentFile: {
      mode: "0600",
      ownerUid: envInfo.uid,
      ownerGid: envInfo.gid,
      mustBeOutsideRelease: true,
    },
    release: {
      root: releases,
      directoryShaPrefixLength: 7,
      requireDetachedHead: true,
    },
    api: {
      nodeEnv: "production",
      host: "127.0.0.1",
      port: 3000,
      publicBaseUrl: "https://api.prod.invalid",
      maxUploadBytes: 52_428_800,
      rateLimitMax: 300,
      rateLimitWindowMs: 60_000,
      puppeteerExecutablePath: chromium,
    },
    portal: {
      internalApiUrl: "http://127.0.0.1:3000",
      publicApiUrl: "https://api.prod.invalid",
      port: 3210,
      registrationEnabled: false,
      allowRegistration: false,
    },
    database: {
      protocol: "postgresql:",
      hostname: "db.prod.invalid",
      port: 25060,
      database: "sustainability_wise",
      username: "sw_api",
      parameters: { sslmode: "require" },
      passwordSha256: sha256Fingerprint(values.databasePassword),
    },
    storage: {
      writeMode: "isolated",
      allowLegacyMode: false,
      allowLocalProvider: false,
      localFallbackRoot: "/var/lib/sustainability-wise-api/uploads",
      legacy: destination("legacy"),
      apps: {
        ecoaudit: destination("ecoaudit"),
        solarsense: destination("solarsense"),
        installhub: destination("installhub"),
      },
    },
    oneDrive: {
      enabled: true,
      allowDisabled: false,
      backupRequired: false,
      tenantId: "tenant-production",
      clientId: "client-production",
      clientSecretSha256: sha256Fingerprint(values.azure),
      userEmail: "backups@prod.invalid",
      photosFolder: "SustainabilityWise/photos",
      backupRemotePath: "onedrive:SustainabilityWise/backups",
    },
    security: {
      secretSha256: {
        JWT_SECRET: sha256Fingerprint(values.jwt),
        JWT_REFRESH_SECRET: sha256Fingerprint(values.refresh),
        UPLOAD_CAPABILITY_SECRET: sha256Fingerprint(values.upload),
        FILE_CAPABILITY_SECRET: sha256Fingerprint(values.file),
      },
      registrationSecretSha256: {
        REGISTRATION_SECRET: null,
        ECOAUDIT_REGISTRATION_SECRET: null,
        SOLARSENSE_REGISTRATION_SECRET: null,
        INSTALLHUB_REGISTRATION_SECRET: null,
      },
      uploadCapabilityTtlSeconds: 900,
      fileCapabilityTtlSeconds: 300,
      allowLegacyUnsignedUploads: false,
      allowLegacyPublicFiles: false,
      enableApiDocs: false,
      protectApiDocs: true,
      corsOrigins: [],
      allowLocalBootstrap: false,
      allowLegacyBootstrapUpsert: false,
      allowLegacySharedRegistrationSecret: false,
      approveDangerousCompatibilityFlags: false,
    },
  };
  await writeFile(targetFile, `${JSON.stringify(target, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(targetFile, 0o600);

  return {
    args: { envFile, targetFile, releaseDir, expectedSha },
    env,
    envFile,
    releaseDir,
    target,
    targetFile,
    values,
  };
}

test("passes an exact protected production target and emits fingerprints only", async (t) => {
  const current = await fixture(t);
  const manifest = await runPreflight(current.args);
  assert.equal(manifest.status, "pass");
  assert.deepEqual(manifest.failures, []);
  const serialized = JSON.stringify(manifest);
  for (const value of Object.values(current.values)) {
    assert.equal(serialized.includes(value), false);
  }
  assert.equal(serialized.includes("backups@prod.invalid"), false);
  assert.equal(serialized.includes("db.prod.invalid"), false);
});

test("supports explicitly approved legacy writes while validating configured app destinations", async (t) => {
  const current = await fixture(t);
  const target = structuredClone(current.target);
  target.storage.writeMode = "legacy";
  target.storage.allowLegacyMode = true;
  await writeFile(current.targetFile, `${JSON.stringify(target, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(current.targetFile, 0o600);
  await writeFile(
    current.envFile,
    current.env.replace(
      "STORAGE_WRITE_MODE=isolated",
      "STORAGE_WRITE_MODE=legacy",
    ),
    { mode: 0o600 },
  );
  await chmod(current.envFile, 0o600);

  const manifest = await runPreflight(current.args);
  assert.equal(manifest.status, "pass");
  assert.deepEqual(manifest.failures, []);
});

test("rejects an unprotected target file before reading its identities", async (t) => {
  const current = await fixture(t);
  await chmod(current.targetFile, 0o644);
  await assert.rejects(runPreflight(current.args), {
    code: "TARGET_FILE_MODE_UNSAFE",
  });
});

test("fails closed for a changed OneDrive requirement without exposing the environment", async (t) => {
  const current = await fixture(t);
  await writeFile(
    current.envFile,
    current.env.replace(
      "ONEDRIVE_BACKUP_REQUIRED=false",
      "ONEDRIVE_BACKUP_REQUIRED=true",
    ),
    { mode: 0o600 },
  );
  await chmod(current.envFile, 0o600);
  const manifest = await runPreflight(current.args);
  assert.equal(manifest.status, "fail");
  assert.equal(
    manifest.failures.some(
      (failure) => failure.code === "ONEDRIVE_REQUIRED_MISMATCH",
    ),
    true,
  );
  const serialized = JSON.stringify(manifest);
  for (const value of Object.values(current.values)) {
    assert.equal(serialized.includes(value), false);
  }
});

test("rejects a dirty or non-immutable release", async (t) => {
  const current = await fixture(t);
  await writeFile(path.join(current.releaseDir, "untracked.txt"), "dirty\n");
  const manifest = await runPreflight(current.args);
  assert.equal(manifest.status, "fail");
  assert.equal(
    manifest.failures.some((failure) => failure.code === "RELEASE_DIRTY"),
    true,
  );
});

test("strict target parsing rejects duplicate keys", () => {
  assert.throws(
    () => parseStrictJson('{"schemaVersion":1,"schemaVersion":1}'),
    { code: "TARGET_JSON_DUPLICATE_OR_UNSAFE_KEY" },
  );
});

test("CLI prints exactly one JSON manifest on validation failure", async (t) => {
  const current = await fixture(t);
  const result = spawnSync(
    process.execPath,
    [
      scriptPath,
      "--env-file",
      current.envFile,
      "--target-file",
      current.targetFile,
      "--release-dir",
      current.releaseDir,
      "--expected-sha",
      "0".repeat(40),
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stderr, "");
  const manifest = JSON.parse(result.stdout);
  assert.equal(manifest.status, "fail");
  assert.equal(
    manifest.failures.some(
      (failure) => failure.code === "RELEASE_DIRECTORY_NAME_MISMATCH",
    ),
    true,
  );
});
