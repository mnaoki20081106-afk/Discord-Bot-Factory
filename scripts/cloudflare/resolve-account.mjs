const alias = String(process.argv[2] || "").trim();
const rawRegistry = process.env.CLOUDFLARE_ACCOUNTS_JSON || "";

if (!alias) {
  throw new Error("cloudflare_account is required in bot-factory.json.");
}
if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(alias)) {
  throw new Error("cloudflare_account must use lowercase letters, numbers, hyphen, or underscore.");
}
if (!rawRegistry) {
  throw new Error("GitHub Actions variable CLOUDFLARE_ACCOUNTS_JSON is not configured.");
}

let registry;
try {
  registry = JSON.parse(rawRegistry);
} catch {
  throw new Error("CLOUDFLARE_ACCOUNTS_JSON is not valid JSON.");
}

if (!registry || Array.isArray(registry) || typeof registry !== "object") {
  throw new Error("CLOUDFLARE_ACCOUNTS_JSON must be a JSON object.");
}

const entry = registry[alias];
if (!entry || Array.isArray(entry) || typeof entry !== "object") {
  throw new Error(`Cloudflare account alias "${alias}" is not registered in CLOUDFLARE_ACCOUNTS_JSON.`);
}

const accountId = String(entry.account_id || "").trim();
const tokenSecret = String(entry.token_secret || "").trim();

if (!/^[a-fA-F0-9]{32}$/.test(accountId)) {
  throw new Error(`Cloudflare account "${alias}" has an invalid account_id.`);
}
if (!/^[A-Z][A-Z0-9_]*$/.test(tokenSecret)) {
  throw new Error(`Cloudflare account "${alias}" has an invalid token_secret name.`);
}

process.stdout.write(`cloudflare_account<<FACTORY_EOF\n${alias}\nFACTORY_EOF\n`);
process.stdout.write(`cloudflare_account_id<<FACTORY_EOF\n${accountId}\nFACTORY_EOF\n`);
process.stdout.write(`cloudflare_token_secret<<FACTORY_EOF\n${tokenSecret}\nFACTORY_EOF\n`);
