import fs from "node:fs";
import path from "node:path";

const sourceRoot = path.resolve(process.argv[2] || ".");
const repoName = process.argv[3] || path.basename(sourceRoot);
const manifestPath = path.join(sourceRoot, "bot-factory.json");

function sanitizeName(value) {
  const name = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");

  if (!name) throw new Error("Could not derive a valid Worker name.");
  return name;
}

if (!fs.existsSync(manifestPath)) {
  throw new Error("bot-factory.json is required.");
}

let config;
try {
  config = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
} catch {
  throw new Error("bot-factory.json is not valid JSON.");
}

if (!config || Array.isArray(config) || typeof config !== "object") {
  throw new Error("bot-factory.json must contain a JSON object.");
}

if (config.provider && config.provider !== "cloudflare") {
  throw new Error("Discord-Bot-Factory supports Cloudflare only.");
}
if (config.runtime && config.runtime !== "worker") {
  throw new Error("Discord-Bot-Factory supports Cloudflare Worker runtime only.");
}

const name = sanitizeName(config.name || repoName.replace(/^.*\//, ""));
const workingDirectory = String(config.working_directory || ".").trim();
const workdir = path.resolve(sourceRoot, workingDirectory);

if (!workdir.startsWith(sourceRoot + path.sep) && workdir !== sourceRoot) {
  throw new Error("working_directory must stay inside the source repository.");
}
if (!fs.existsSync(workdir) || !fs.statSync(workdir).isDirectory()) {
  throw new Error(`working_directory does not exist: ${workingDirectory}`);
}

let wranglerConfig = String(config.wrangler_config || "auto").trim();
if (wranglerConfig === "auto") {
  const candidates = ["wrangler.jsonc", "wrangler.json", "wrangler.toml"].filter((file) =>
    fs.existsSync(path.join(workdir, file)),
  );
  if (candidates.length !== 1) {
    throw new Error(
      "Cloudflare deployment requires exactly one Wrangler config in working_directory, or wrangler_config must be set explicitly.",
    );
  }
  wranglerConfig = candidates[0];
}

const wranglerPath = path.resolve(workdir, wranglerConfig);
if (!wranglerPath.startsWith(workdir + path.sep) && wranglerPath !== workdir) {
  throw new Error("wrangler_config must stay inside working_directory.");
}
if (!fs.existsSync(wranglerPath)) {
  throw new Error(`Wrangler config does not exist: ${wranglerConfig}`);
}

const d1Migrations = config.d1_migrations ?? [];
if (!Array.isArray(d1Migrations) || d1Migrations.some((value) => typeof value !== "string" || !value.trim())) {
  throw new Error("d1_migrations must be an array of non-empty binding names.");
}

const d1SchemaFiles = config.d1_schema_files ?? [];
if (!Array.isArray(d1SchemaFiles)) {
  throw new Error("d1_schema_files must be an array.");
}

const normalizedSchemaFiles = d1SchemaFiles.map((entry, index) => {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`d1_schema_files[${index}] must be an object.`);
  }

  const binding = String(entry.binding || "").trim();
  const file = String(entry.file || "").trim();
  if (!binding) throw new Error(`d1_schema_files[${index}].binding is required.`);
  if (!file) throw new Error(`d1_schema_files[${index}].file is required.`);

  const schemaPath = path.resolve(workdir, file);
  if (!schemaPath.startsWith(workdir + path.sep) && schemaPath !== workdir) {
    throw new Error(`d1_schema_files[${index}].file must stay inside working_directory.`);
  }
  if (!fs.existsSync(schemaPath) || !fs.statSync(schemaPath).isFile()) {
    throw new Error(`D1 schema file does not exist: ${file}`);
  }

  return { binding, file };
});

const result = {
  name,
  runtime: "worker",
  provider: "cloudflare",
  working_directory: workingDirectory,
  wrangler_config: wranglerConfig,
  health_url: String(config.health_url || "").trim(),
  d1_migrations: d1Migrations,
  d1_schema_files: normalizedSchemaFiles,
};

for (const [key, value] of Object.entries(result)) {
  const encoded = typeof value === "string" ? value : JSON.stringify(value);
  process.stdout.write(`${key}<<FACTORY_EOF\n${encoded}\nFACTORY_EOF\n`);
}
