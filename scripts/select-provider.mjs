import fs from "node:fs";
import path from "node:path";

const [
  requestedProvider = "auto",
  requestedRuntime = "auto",
  sourceRoot = ".",
  workingDirectory = ".",
] = process.argv.slice(2);

const workdir = path.resolve(sourceRoot, workingDirectory);

function exists(name) {
  return fs.existsSync(path.join(workdir, name));
}

if (!fs.existsSync(workdir)) {
  throw new Error(`Working directory does not exist: ${workdir}`);
}

let runtime = requestedRuntime;
if (runtime === "auto") {
  if (exists("wrangler.jsonc") || exists("wrangler.json") || exists("wrangler.toml")) {
    runtime = "worker";
  } else if (exists("Dockerfile") || exists("package.json")) {
    runtime = "node";
  } else {
    throw new Error(
      `Could not detect runtime in ${workdir}. Expected Wrangler config, Dockerfile, or package.json.`,
    );
  }
}

if (!["worker", "node"].includes(runtime)) {
  throw new Error(`Unsupported runtime: ${runtime}`);
}

let provider = requestedProvider;
if (provider === "auto") {
  provider = runtime === "worker" ? "cloudflare" : "oracle";
}

if (!["cloudflare", "oracle"].includes(provider)) {
  throw new Error(`Unsupported provider: ${provider}`);
}

if (provider === "cloudflare" && runtime !== "worker") {
  throw new Error(
    "Cloudflare provider requires runtime=worker. Use Oracle for a persistent Node/Gateway process.",
  );
}

if (provider === "oracle" && runtime !== "node") {
  throw new Error(
    "Oracle provider requires runtime=node. Cloudflare Worker APIs such as Durable Objects and D1 are not portable to a generic VM.",
  );
}

process.stdout.write(`provider=${provider}\nruntime=${runtime}\n`);
