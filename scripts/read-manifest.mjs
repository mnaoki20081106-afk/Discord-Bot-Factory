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
    .slice(0, 63);
  if (!name) throw new Error("Could not derive a valid bot name.");
  return name;
}

function findFiles(dir, names, depth = 0) {
  if (depth > 3) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if ([".git", "node_modules", "dist", "build", ".wrangler"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isFile() && names.includes(entry.name)) out.push(full);
    if (entry.isDirectory()) out.push(...findFiles(full, names, depth + 1));
  }
  return out;
}

let config = {};

if (fs.existsSync(manifestPath)) {
  config = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
} else {
  const wranglers = findFiles(sourceRoot, ["wrangler.jsonc", "wrangler.json", "wrangler.toml"]);
  if (wranglers.length > 1) {
    throw new Error("Multiple Wrangler configs found. Add bot-factory.json to choose the deployment target.");
  }

  if (wranglers.length === 1) {
    config.runtime = "worker";
    config.provider = "cloudflare";
    config.working_directory = path.relative(sourceRoot, path.dirname(wranglers[0])) || ".";
    config.wrangler_config = path.basename(wranglers[0]);
  } else {
    const dockerfiles = findFiles(sourceRoot, ["Dockerfile"]);
    const packages = findFiles(sourceRoot, ["package.json"]);
    const roots = [...dockerfiles, ...packages]
      .map((file) => path.dirname(file))
      .filter((value, index, arr) => arr.indexOf(value) === index);

    if (roots.length !== 1) {
      throw new Error(
        roots.length === 0
          ? "No deployable Worker/Node project detected. Add bot-factory.json."
          : "Multiple Node project roots found. Add bot-factory.json to choose one.",
      );
    }

    config.runtime = "node";
    config.provider = "oracle";
    config.working_directory = path.relative(sourceRoot, roots[0]) || ".";
  }
}

const runtime = config.runtime || "auto";
const provider = config.provider || (runtime === "worker" ? "cloudflare" : runtime === "node" ? "oracle" : "auto");
const name = sanitizeName(config.name || repoName.replace(/^.*\//, ""));
const workingDirectory = config.working_directory || ".";
const workdir = path.resolve(sourceRoot, workingDirectory);

if (!fs.existsSync(workdir)) throw new Error(`working_directory does not exist: ${workingDirectory}`);
if (!["worker", "node"].includes(runtime)) throw new Error(`Unsupported runtime: ${runtime}`);
if (!["cloudflare", "oracle"].includes(provider)) throw new Error(`Unsupported provider: ${provider}`);
if (runtime === "worker" && provider !== "cloudflare") throw new Error("Worker runtime currently requires provider=cloudflare.");
if (runtime === "node" && provider !== "oracle") throw new Error("Node runtime currently requires provider=oracle.");

let wranglerConfig = config.wrangler_config || "auto";
if (runtime === "worker" && wranglerConfig === "auto") {
  const candidates = ["wrangler.jsonc", "wrangler.json", "wrangler.toml"].filter((file) =>
    fs.existsSync(path.join(workdir, file)),
  );
  if (candidates.length !== 1) {
    throw new Error("Worker deployment requires exactly one Wrangler config in working_directory.");
  }
  wranglerConfig = candidates[0];
}

const result = {
  name,
  runtime,
  provider,
  working_directory: workingDirectory,
  wrangler_config: wranglerConfig,
  health_url: config.health_url || "",
  start_command: config.start_command || "",
  d1_migrations: Array.isArray(config.d1_migrations) ? config.d1_migrations : [],
};

for (const [key, value] of Object.entries(result)) {
  const encoded = typeof value === "string" ? value : JSON.stringify(value);
  process.stdout.write(`${key}<<FACTORY_EOF\n${encoded}\nFACTORY_EOF\n`);
}
