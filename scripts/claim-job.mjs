import fs from "node:fs";

const file = process.argv[2];
if (!file) throw new Error("Claimed job file is required.");

const payload = JSON.parse(fs.readFileSync(file, "utf8"));
const required = [
  "repository",
  "ref",
  "cloudflare_account_alias",
  "cloudflare_account_id",
  "cloudflare_api_token",
  "github_token",
];

for (const key of required) {
  if (!payload[key]) throw new Error(`Claimed job is missing ${key}.`);
}

const bundle = payload.bot_secret_bundle && typeof payload.bot_secret_bundle === "object"
  ? payload.bot_secret_bundle
  : {};

for (const secret of [
  payload.cloudflare_api_token,
  payload.github_token,
  ...Object.values(bundle),
]) {
  const value = String(secret ?? "");
  if (value) process.stdout.write(`::add-mask::${value}\n`);
}

const envLines = [
  `FACTORY_GITHUB_PAT=${payload.github_token}`,
  `CLOUDFLARE_API_TOKEN=${payload.cloudflare_api_token}`,
  `CLOUDFLARE_ACCOUNT_ID=${payload.cloudflare_account_id}`,
  `BOT_SECRET_BUNDLE=${JSON.stringify(bundle)}`,
];

fs.appendFileSync(process.env.GITHUB_ENV, envLines.join("\n") + "\n");

const outputs = {
  repository: String(payload.repository),
  ref: String(payload.ref),
  cloudflare_account_alias: String(payload.cloudflare_account_alias),
  cloudflare_account_id: String(payload.cloudflare_account_id),
};

for (const [key, value] of Object.entries(outputs)) {
  if (/[\r\n]/.test(value)) throw new Error(`Invalid newline in ${key}.`);
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}
