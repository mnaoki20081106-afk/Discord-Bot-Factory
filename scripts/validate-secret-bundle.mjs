import fs from "node:fs";

const [outputPath] = process.argv.slice(2);
if (!outputPath) {
  throw new Error("Output path is required.");
}

const raw = process.env.BOT_SECRET_BUNDLE ?? "{}";

let input;
try {
  input = JSON.parse(raw);
} catch {
  throw new Error("BOT secret bundle is not valid JSON.");
}

if (!input || Array.isArray(input) || typeof input !== "object") {
  throw new Error("BOT secret bundle must be a JSON object.");
}

const output = {};
for (const [key, value] of Object.entries(input)) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    throw new Error(`Invalid secret/environment variable name: ${key}`);
  }
  if (!["string", "number", "boolean"].includes(typeof value)) {
    throw new Error(`Secret ${key} must be a string, number, or boolean.`);
  }
  const normalized = String(value);
  if (/[
\0]/.test(normalized)) {
    throw new Error(`Secret ${key} contains a newline or NUL character.`);
  }
  output[key] = normalized;
}

fs.writeFileSync(outputPath, JSON.stringify(output), { mode: 0o600 });
process.stdout.write(String(Object.keys(output).length));
