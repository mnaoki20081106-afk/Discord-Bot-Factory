import fs from "node:fs";
import path from "node:path";

const file = process.argv[2];
if (!file) throw new Error("Claimed job file is required.");

const payload = JSON.parse(fs.readFileSync(file, "utf8"));
if (payload.provider !== "vps") throw new Error("Claimed job is not a VPS job.");

for (const key of ["repository", "ref", "github_token"]) {
  if (!payload[key]) throw new Error(`Claimed job is missing ${key}.`);
}
const vps = payload.vps || {};
const bot = payload.bot || {};
for (const key of ["host", "port", "username", "auth_type", "secret"]) {
  if (!vps[key]) throw new Error(`Claimed job is missing vps.${key}.`);
}
for (const key of ["name", "runtime", "entrypoint"]) {
  if (!bot[key]) throw new Error(`Claimed job is missing bot.${key}.`);
}

const envVars = payload.env && typeof payload.env === "object" ? payload.env : {};

// Same quoting rules the Control Plane uses for the m-ws .env (python-dotenv / systemd compatible).
function dotenv(vars) {
  return Object.entries(vars).map(([key, value]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`Invalid env key: ${key}`);
    const text = String(value).replace(/\r?\n/g, " ");
    return /^[A-Za-z0-9_.:/@+=,~-]*$/.test(text)
      ? `${key}=${text}`
      : `${key}="${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }).join("\n") + "\n";
}

for (const secret of [payload.github_token, vps.secret, ...Object.values(envVars)]) {
  const value = String(secret ?? "");
  // Multi-line secrets (SSH keys) are masked line by line.
  for (const line of value.split(/\r?\n/)) {
    if (line.trim().length >= 4) process.stdout.write(`::add-mask::${line.trim()}\n`);
  }
}

const temp = process.env.RUNNER_TEMP;
if (!temp) throw new Error("RUNNER_TEMP is not set.");

const lines = [];
const set = (key, value) => {
  const text = String(value);
  if (/[\r\n]/.test(text)) throw new Error(`Invalid newline in ${key}.`);
  lines.push(`${key}=${text}`);
};

set("FACTORY_GITHUB_PAT", payload.github_token);
set("VPS_HOST", vps.host);
set("VPS_PORT", vps.port);
set("VPS_USER", vps.username);
set("VPS_AUTH", vps.auth_type);
if (vps.auth_type === "key") {
  const keyFile = path.join(temp, "factory_vps_key");
  fs.writeFileSync(keyFile, vps.secret.endsWith("\n") ? vps.secret : vps.secret + "\n", { mode: 0o600 });
  set("VPS_KEY_FILE", keyFile);
} else {
  set("SSHPASS", vps.secret);
}
if (vps.host_key) set("VPS_KNOWN_HOST", vps.host_key);
set("BOT_NAME", bot.name);
set("BOT_RUNTIME", bot.runtime);
set("BOT_ENTRYPOINT", bot.entrypoint);
set("BOT_SWAP_MB", bot.swap_mb ?? 0);
set("BOT_PIP_EXTRA", (Array.isArray(bot.pip_extra) ? bot.pip_extra : []).join(" "));
set("BOT_ENV_B64", Buffer.from(dotenv(envVars), "utf8").toString("base64"));

fs.appendFileSync(process.env.GITHUB_ENV, lines.join("\n") + "\n");

for (const [key, value] of Object.entries({ repository: payload.repository, ref: payload.ref })) {
  if (/[\r\n]/.test(String(value))) throw new Error(`Invalid newline in ${key}.`);
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}
