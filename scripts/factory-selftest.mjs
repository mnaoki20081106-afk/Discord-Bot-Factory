import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const root = path.resolve(process.cwd());
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "factory-selftest-"));

function runNode(script, args = [], env = {}) {
  return execFileSync(process.execPath, [path.join(root, script), ...args], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

try {
  // read-manifest: valid Worker config and safe Worker-name truncation.
  const source = path.join(tmp, "source");
  const worker = path.join(source, "apps", "worker");
  fs.mkdirSync(worker, { recursive: true });
  fs.writeFileSync(path.join(worker, "wrangler.jsonc"), "{}\n");
  fs.writeFileSync(
    path.join(source, "bot-factory.json"),
    JSON.stringify({
      name: "a".repeat(62) + "-tail",
      provider: "cloudflare",
      runtime: "worker",
      working_directory: "apps/worker",
      wrangler_config: "wrangler.jsonc",
      d1_migrations: [],
    }),
  );

  const manifestOutput = runNode("scripts/read-manifest.mjs", [source, "owner/repo"]);
  const nameMatch = manifestOutput.match(/name<<FACTORY_EOF\n([^\n]+)\nFACTORY_EOF/);
  assert(nameMatch, "manifest name output missing");
  assert(nameMatch[1].length <= 63, "Worker name exceeded 63 chars");
  assert(!nameMatch[1].endsWith("-"), "Worker name ends with a hyphen");

  // read-manifest: traversal must be rejected.
  fs.writeFileSync(
    path.join(source, "bot-factory.json"),
    JSON.stringify({
      provider: "cloudflare",
      runtime: "worker",
      working_directory: "../outside",
    }),
  );
  const traversal = spawnSync(
    process.execPath,
    [path.join(root, "scripts/read-manifest.mjs"), source, "owner/repo"],
    { cwd: root, encoding: "utf8" },
  );
  assert.notEqual(traversal.status, 0, "path traversal manifest was accepted");

  // validate-secret-bundle: valid values are materialized exactly.
  const secretFile = path.join(tmp, "secrets.json");
  const secretCount = runNode(
    "scripts/validate-secret-bundle.mjs",
    [secretFile],
    { BOT_SECRET_BUNDLE: JSON.stringify({ DISCORD_BOT_TOKEN: "token-value", FLAG: true }) },
  ).trim();
  assert.equal(secretCount, "2");
  assert.deepEqual(JSON.parse(fs.readFileSync(secretFile, "utf8")), {
    DISCORD_BOT_TOKEN: "token-value",
    FLAG: "true",
  });

  // claim-job: credentials reach GITHUB_ENV and metadata reaches GITHUB_OUTPUT.
  const jobFile = path.join(tmp, "job.json");
  const githubEnv = path.join(tmp, "github-env");
  const githubOutput = path.join(tmp, "github-output");
  fs.writeFileSync(
    jobFile,
    JSON.stringify({
      repository: "owner/test-bot",
      ref: "main",
      cloudflare_account_alias: "cf-test",
      cloudflare_account_id: "0123456789abcdef0123456789abcdef",
      cloudflare_api_token: "cf-token",
      github_token: "github-token",
      bot_secret_bundle: { DISCORD_BOT_TOKEN: "discord-token" },
      bot_secret_delete_keys: ["OLD_SECRET"],
    }),
  );
  runNode("scripts/claim-job.mjs", [jobFile], {
    GITHUB_ENV: githubEnv,
    GITHUB_OUTPUT: githubOutput,
  });
  const envText = fs.readFileSync(githubEnv, "utf8");
  const outputText = fs.readFileSync(githubOutput, "utf8");
  assert.match(envText, /FACTORY_GITHUB_PAT=github-token/);
  assert.match(envText, /CLOUDFLARE_API_TOKEN=cf-token/);
  assert.match(envText, /BOT_SECRET_BUNDLE=/);
  assert.match(envText, /BOT_SECRET_DELETE_KEYS=\["OLD_SECRET"\]/);
  assert.match(outputText, /repository=owner\/test-bot/);
  assert.match(outputText, /ref=main/);

  // deploy.sh: smoke-test Wrangler invocation and secret-file handoff with a fake npx.
  const deploySource = path.join(tmp, "deploy-source");
  const deployWorker = path.join(deploySource, "worker");
  const fakeBin = path.join(tmp, "bin");
  const argsCapture = path.join(tmp, "npx-args.txt");
  const secretsCapture = path.join(tmp, "wrangler-secrets.json");
  const deletesCapture = path.join(tmp, "wrangler-secret-deletes.json");
  fs.mkdirSync(deployWorker, { recursive: true });
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.writeFileSync(path.join(deployWorker, "wrangler.jsonc"), "{}\n");

  const fakeNpx = path.join(fakeBin, "npx");
  fs.writeFileSync(
    fakeNpx,
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$FACTORY_TEST_ARGS"
args=("$@")
for ((i=0; i<\${#args[@]}; i++)); do
  if [[ "\${args[$i]}" == "--secrets-file" ]]; then
    cp "\${args[$((i+1))]}" "$FACTORY_TEST_SECRETS"
  fi
done
if [[ "\${args[0]:-}" == "wrangler" && "\${args[1]:-}" == "secret" && "\${args[2]:-}" == "bulk" ]]; then
  cp "\${args[3]}" "$FACTORY_TEST_SECRET_DELETES"
fi
`,
    { mode: 0o755 },
  );

  execFileSync(
    "bash",
    [
      path.join(root, "scripts/cloudflare/deploy.sh"),
      deploySource,
      "worker",
      "selftest-worker",
      "wrangler.jsonc",
      "",
      "[]",
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        PATH: fakeBin + path.delimiter + process.env.PATH,
        CLOUDFLARE_API_TOKEN: "cf-token",
        CLOUDFLARE_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
        FACTORY_ROOT: root,
        BOT_SECRET_BUNDLE: JSON.stringify({ DISCORD_BOT_TOKEN: "discord-token" }),
        BOT_SECRET_DELETE_KEYS: JSON.stringify(["OLD_SECRET"]),
        FACTORY_TEST_ARGS: argsCapture,
        FACTORY_TEST_SECRETS: secretsCapture,
        FACTORY_TEST_SECRET_DELETES: deletesCapture,
      },
      stdio: "pipe",
    },
  );

  assert.match(fs.readFileSync(argsCapture, "utf8"), /wrangler@4\.142\.0 deploy/);
  assert.deepEqual(JSON.parse(fs.readFileSync(secretsCapture, "utf8")), {
    DISCORD_BOT_TOKEN: "discord-token",
  });
  assert.deepEqual(JSON.parse(fs.readFileSync(deletesCapture, "utf8")), {
    OLD_SECRET: null,
  });
  assert.match(fs.readFileSync(argsCapture, "utf8"), /wrangler@4\.142\.0 secret bulk/);

  process.stdout.write("Factory self-test passed.\n");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
