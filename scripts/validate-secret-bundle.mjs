import fs from "node:fs";

const outputPath = process.argv[2];
if (!outputPath) throw new Error("Output path is required.");

let input;
try {
  input = JSON.parse(process.env.BOT_SECRET_BUNDLE || "{}");
} catch {
  throw new Error("Bot secret bundle is not valid JSON.");
}

if (!input || Array.isArray(input) || typeof input !== "object") {
  throw new Error("Bot secret bundle must be a JSON object.");
}

const output = {};
for (const [key, raw] of Object.entries(input)) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`Invalid secret name: ${key}`);
  if (!["string", "number", "boolean"].includes(typeof raw)) {
    throw new Error(`Secret ${key} must be a string, number, or boolean.`);
  }
  const value = String(raw);
  const invalid = [...value].some((c) => [0, 10, 13].includes(c.charCodeAt(0)));
  if (invalid) throw new Error(`Secret ${key} contains a newline or NUL.`);
  output[key] = value;
}

fs.writeFileSync(outputPath, JSON.stringify(output), { mode: 0o600 });
process.stdout.write(String(Object.keys(output).length));
