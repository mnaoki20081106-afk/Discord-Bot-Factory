const encoder = new TextEncoder();
const decoder = new TextDecoder();

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

function nowIso() {
  return new Date().toISOString();
}

function bytesToBase64(bytes) {
  let value = "";
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (const byte of array) value += String.fromCharCode(byte);
  return btoa(value);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64Url(bytes) {
  return bytesToBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function getCookie(request, name) {
  const cookie = request.headers.get("cookie") || "";
  for (const part of cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}

async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function secureEqual(a, b) {
  return sameBytes(await digest(String(a)), await digest(String(b)));
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

async function createSession(env) {
  const exp = Date.now() + 8 * 60 * 60 * 1000;
  const nonce = crypto.randomUUID();
  const body = `${exp}.${nonce}`;
  const signature = base64Url(await hmac(env.FACTORY_SESSION_SECRET, body));
  return `${body}.${signature}`;
}

async function verifySession(request, env) {
  const value = getCookie(request, "factory_session");
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  const [expRaw, nonce, signature] = parts;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < Date.now() || !nonce) return false;
  const expected = base64Url(await hmac(env.FACTORY_SESSION_SECRET, `${expRaw}.${nonce}`));
  return secureEqual(signature, expected);
}

function sessionCookie(value) {
  return `factory_session=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`;
}

function clearSessionCookie() {
  return "factory_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0";
}

function assertSameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const expected = new URL(request.url).origin;
  if (origin !== expected) throw new Error("Cross-origin request rejected.");
}

async function masterKey(env) {
  if (!env.FACTORY_MASTER_KEY) throw new Error("FACTORY_MASTER_KEY is not configured.");
  const bytes = base64ToBytes(String(env.FACTORY_MASTER_KEY).replace(/\s+/g, ""));
  if (bytes.byteLength !== 32) throw new Error("FACTORY_MASTER_KEY must be a base64-encoded 32-byte key.");
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptValue(env, value) {
  const key = await masterKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(typeof value === "string" ? value : JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return JSON.stringify({
    v: 1,
    iv: bytesToBase64(iv),
    ct: bytesToBase64(ciphertext),
  });
}

async function decryptValue(env, packed) {
  const parsed = JSON.parse(packed);
  if (parsed.v !== 1) throw new Error("Unsupported encrypted value format.");
  const key = await masterKey(env);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(parsed.iv) },
    key,
    base64ToBytes(parsed.ct),
  );
  return decoder.decode(plaintext);
}

async function audit(env, action, detail = {}) {
  try {
    await env.DB.prepare(
      "INSERT INTO audit_log(action, detail_json, created_at) VALUES(?, ?, ?)",
    ).bind(action, JSON.stringify(detail), nowIso()).run();
  } catch (error) {
    // Audit logging must never make a successful control-plane operation fail.
    console.error("audit log write failed", action, error?.message || error);
  }
}

async function getSetting(env, key) {
  const row = await env.DB.prepare("SELECT encrypted_value, metadata_json FROM settings WHERE key = ?")
    .bind(key).first();
  if (!row) return null;
  return {
    value: await decryptValue(env, row.encrypted_value),
    metadata: JSON.parse(row.metadata_json || "{}"),
  };
}

async function setSetting(env, key, value, metadata = {}) {
  const encrypted = await encryptValue(env, value);
  await env.DB.prepare(
    `INSERT INTO settings(key, encrypted_value, metadata_json, updated_at)
     VALUES(?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       encrypted_value = excluded.encrypted_value,
       metadata_json = excluded.metadata_json,
       updated_at = excluded.updated_at`,
  ).bind(key, encrypted, JSON.stringify(metadata), nowIso()).run();
}

async function githubFetch(token, path, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2026-03-10",
      "user-agent": "discord-bot-factory-control-plane",
      ...(options.headers || {}),
    },
  });
  return response;
}

function decodeGitHubContent(content) {
  const bytes = base64ToBytes(String(content).replace(/\s+/g, ""));
  return decoder.decode(bytes);
}

function validateRepoName(value, env) {
  const repo = String(value || "").trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error("Invalid repository name.");
  }
  if (env.ALLOWED_REPO_OWNER && repo.split("/")[0] !== env.ALLOWED_REPO_OWNER) {
    throw new Error("Repository owner is not allowed.");
  }
  return repo;
}

function normalizeWorkerName(value) {
  const name = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");

  if (!name) throw new Error("有効なWorker名を作成できません。");
  return name;
}

async function fetchManifest(env, token, repository, ref = "main") {
  const repo = validateRepoName(repository, env);
  const response = await githubFetch(
    token,
    `/repos/${repo}/contents/bot-factory.json?ref=${encodeURIComponent(ref)}`,
  );
  if (response.status === 404) {
    throw new Error("bot-factory.json が見つかりません。このBOTはFactoryサイト用のセットアップ定義が必要です。");
  }
  if (!response.ok) {
    throw new Error(`GitHubからbot-factory.jsonを取得できませんでした (${response.status})`);
  }
  const payload = await response.json();
  let manifest;
  try {
    manifest = JSON.parse(decodeGitHubContent(payload.content));
  } catch {
    throw new Error("bot-factory.json が正しいJSONではありません。");
  }
  if (!manifest || Array.isArray(manifest) || typeof manifest !== "object") {
    throw new Error("bot-factory.json の形式が不正です。");
  }
  return manifest;
}

function normalizeHttpUrl(value, label) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${label} のURLが不正です。`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`${label} のURLはhttp/httpsのみ使用できます。`);
  }
  return parsed.toString();
}

function normalizeSetup(manifest) {
  const setup = manifest.setup && typeof manifest.setup === "object" ? manifest.setup : {};
  const fields = Array.isArray(setup.fields) ? setup.fields : [];
  const discord = setup.discord && typeof setup.discord === "object" ? setup.discord : {};
  const seenFieldKeys = new Set();

  const normalizedFields = fields.map((field) => {
    if (!field || typeof field !== "object") throw new Error("setup.fields に不正な項目があります。");
    const key = String(field.key || "").trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
      throw new Error(`入力項目 key "${key}" は環境変数形式(A-Z, 0-9, _)にしてください。`);
    }
    if (seenFieldKeys.has(key)) throw new Error(`入力項目 key "${key}" が重複しています。`);
    seenFieldKeys.add(key);
    const type = String(field.type || "text");
    if (!["text", "secret", "number", "url", "select", "boolean"].includes(type)) {
      throw new Error(`入力項目 ${key} のtypeが未対応です。`);
    }
    const source = field.source && typeof field.source === "object" ? field.source : {};
    const generator = field.generate && typeof field.generate === "object" ? field.generate : null;
    let generate = null;

    if (generator) {
      if (!["text", "secret"].includes(type)) {
        throw new Error(`入力項目 ${key} の自動生成はtext/secret型のみ使用できます。`);
      }
      const strategy = String(generator.strategy || "hex");
      if (!["hex", "base64", "base64url", "uuid"].includes(strategy)) {
        throw new Error(`入力項目 ${key} のgenerate.strategyが未対応です。`);
      }
      const bytes = strategy === "uuid" ? 0 : Number(generator.bytes || 32);
      if (strategy !== "uuid" && (!Number.isInteger(bytes) || bytes < 16 || bytes > 128)) {
        throw new Error(`入力項目 ${key} のgenerate.bytesは16〜128にしてください。`);
      }
      generate = { strategy, bytes };
    }

    return {
      key,
      label: String(field.label || key),
      type,
      required: field.required !== false,
      placeholder: String(field.placeholder || ""),
      help: String(field.help || ""),
      pattern: field.pattern ? String(field.pattern) : "",
      options: Array.isArray(field.options) ? field.options : [],
      runtime_env: field.runtime_env !== false,
      source: {
        title: String(source.title || "取得方法"),
        steps: Array.isArray(source.steps) ? source.steps.map(String) : [],
        url: normalizeHttpUrl(source.url, `入力項目 ${key}`),
        link_label: String(source.link_label || "設定画面を開く ↗"),
      },
      generate,
    };
  });

  function normalizeRequirements(values, prefix) {
    if (!Array.isArray(values)) return [];
    return values.map((item, index) => {
      if (typeof item === "string") {
        return { id: `${prefix}-${index}`, label: item, required: true, description: "" };
      }
      return {
        id: String(item.id || `${prefix}-${index}`),
        label: String(item.label || item.name || "設定"),
        required: item.required !== false,
        description: String(item.description || item.reason || ""),
        path: String(item.path || ""),
        url: normalizeHttpUrl(item.url, `Discord設定 ${item.label || item.name || item.id || `${prefix}-${index}`}`),
      };
    });
  }

  const intents = normalizeRequirements(discord.intents, "intent");
  const permissions = normalizeRequirements(discord.permissions, "permission");
  const checks = normalizeRequirements(discord.checks, "check");
  const requirementIds = new Set();

  for (const item of [...intents, ...permissions, ...checks]) {
    if (!item.id) throw new Error("Discord設定のidは空にできません。");
    if (requirementIds.has(item.id)) throw new Error(`Discord設定 id "${item.id}" が重複しています。`);
    requirementIds.add(item.id);
  }

  return {
    title: String(setup.title || manifest.name || "Discord BOT"),
    description: String(setup.description || ""),
    fields: normalizedFields,
    discord: {
      intents,
      permissions,
      checks,
      notes: Array.isArray(discord.notes) ? discord.notes.map(String) : [],
    },
  };
}

function validateFieldValue(field, raw) {
  if (field.type === "boolean") {
    if (raw == null || raw === "") {
      if (field.required) throw new Error(`${field.label} は必須です。`);
      return "";
    }
    if (typeof raw !== "boolean") throw new Error(`${field.label} はON/OFFで指定してください。`);
    return raw ? "true" : "false";
  }

  const value = raw == null ? "" : String(raw).trim();
  if (field.required && !value) throw new Error(`${field.label} は必須です。`);
  if (!value) return "";

  if (field.type === "number" && !Number.isFinite(Number(value))) {
    throw new Error(`${field.label} は数値で入力してください。`);
  }
  if (field.type === "url") {
    try {
      const parsed = new URL(value);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
    } catch {
      throw new Error(`${field.label} は有効なURLを入力してください。`);
    }
  }
  if (field.type === "select" && field.options.length) {
    const allowed = field.options.map((option) =>
      typeof option === "string" ? option : String(option.value ?? ""),
    );
    if (!allowed.includes(value)) throw new Error(`${field.label} の選択値が不正です。`);
  }
  if (field.pattern) {
    let regex;
    try {
      regex = new RegExp(field.pattern);
    } catch {
      throw new Error(`${field.label} の検証ルールが不正です。`);
    }
    if (!regex.test(value)) throw new Error(`${field.label} の形式が正しくありません。`);
  }
  return value;
}

function randomBytes(length) {
  return crypto.getRandomValues(new Uint8Array(length));
}

function generateManagedValue(generate) {
  if (generate.strategy === "uuid") return crypto.randomUUID();
  const bytes = randomBytes(generate.bytes);
  if (generate.strategy === "hex") {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  const base64 = bytesToBase64(bytes);
  if (generate.strategy === "base64url") {
    return base64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
  }
  return base64;
}

async function getOrCreateManagedValue(env, repository, accountAlias, field) {
  const generatorJson = JSON.stringify(field.generate);
  const existing = await env.DB.prepare(
    "SELECT encrypted_value, generator_json FROM managed_values WHERE repository = ? AND account_alias = ? AND field_key = ?",
  ).bind(repository, accountAlias, field.key).first();

  if (existing && existing.generator_json === generatorJson) {
    return decryptValue(env, existing.encrypted_value);
  }

  const value = generateManagedValue(field.generate);
  const encrypted = await encryptValue(env, value);
  const now = nowIso();

  if (existing) {
    await env.DB.prepare(
      `UPDATE managed_values
       SET encrypted_value = ?, generator_json = ?, updated_at = ?
       WHERE repository = ? AND account_alias = ? AND field_key = ?`,
    ).bind(encrypted, generatorJson, now, repository, accountAlias, field.key).run();
    await audit(env, "managed_value_rotated", {
      repository,
      account_alias: accountAlias,
      field_key: field.key,
    });
    return value;
  }

  await env.DB.prepare(
    `INSERT INTO managed_values(
       repository, account_alias, field_key, encrypted_value, generator_json, created_at, updated_at
     ) VALUES(?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(repository, account_alias, field_key) DO NOTHING`,
  ).bind(
    repository,
    accountAlias,
    field.key,
    encrypted,
    generatorJson,
    now,
    now,
  ).run();

  const stored = await env.DB.prepare(
    "SELECT encrypted_value FROM managed_values WHERE repository = ? AND account_alias = ? AND field_key = ?",
  ).bind(repository, accountAlias, field.key).first();

  if (!stored) throw new Error(`${field.label} の自動生成値を保存できませんでした。`);
  return decryptValue(env, stored.encrypted_value);
}

function parseSecretKeys(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.map(String).filter((key) => /^[A-Z][A-Z0-9_]*$/.test(key)))].sort();
  } catch {
    return [];
  }
}

async function commitDeploymentSecretState(env, deploymentId) {
  const row = await env.DB.prepare(
    `SELECT d.account_alias, d.worker_name, s.secret_keys_json
     FROM deployments d
     JOIN deployment_secret_sets s ON s.deployment_id = d.id
     WHERE d.id = ? AND d.status = 'completed'`,
  ).bind(deploymentId).first();

  if (!row) return false;

  const keys = parseSecretKeys(row.secret_keys_json);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO worker_secret_state(account_alias, worker_name, secret_keys_json, updated_at)
       VALUES(?, ?, ?, ?)
       ON CONFLICT(account_alias, worker_name) DO UPDATE SET
         secret_keys_json = excluded.secret_keys_json,
         updated_at = excluded.updated_at`,
    ).bind(row.account_alias, row.worker_name, JSON.stringify(keys), nowIso()),
    env.DB.prepare(
      "DELETE FROM deployment_secret_sets WHERE deployment_id = ?",
    ).bind(deploymentId),
  ]);
  return true;
}

async function verifyCloudflareAccount(accountId, token) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!response.ok) {
    throw new Error(`Cloudflare API TokenでAccountを確認できませんでした (${response.status})`);
  }
}

async function isBlocked(env, ip) {
  const row = await env.DB.prepare("SELECT failures, blocked_until FROM auth_attempts WHERE ip = ?")
    .bind(ip).first();
  return row && Number(row.blocked_until) > Date.now();
}

async function recordLoginFailure(env, ip) {
  const now = Date.now();
  const existing = await env.DB.prepare(
    "SELECT failures, blocked_until, updated_at FROM auth_attempts WHERE ip = ?",
  ).bind(ip).first();
  const stale = !existing || now - Number(existing.updated_at || 0) > 15 * 60 * 1000;
  const failures = (stale ? 0 : Number(existing.failures || 0)) + 1;
  const blockedUntil = failures >= 5 ? now + 15 * 60 * 1000 : 0;
  await env.DB.prepare(
    `INSERT INTO auth_attempts(ip, failures, blocked_until, updated_at)
     VALUES(?, ?, ?, ?)
     ON CONFLICT(ip) DO UPDATE SET
       failures = excluded.failures,
       blocked_until = excluded.blocked_until,
       updated_at = excluded.updated_at`,
  ).bind(ip, failures, blockedUntil, now).run();
}

async function apiLogin(request, env) {
  assertSameOrigin(request);
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (await isBlocked(env, ip)) return json({ error: "ログイン試行が多すぎます。しばらくしてから再試行してください。" }, 429);

  const body = await request.json();
  if (!env.FACTORY_ADMIN_PASSWORD) return json({ error: "FACTORY_ADMIN_PASSWORD が未設定です。" }, 503);

  if (!(await secureEqual(body.password || "", env.FACTORY_ADMIN_PASSWORD))) {
    await recordLoginFailure(env, ip);
    return json({ error: "パスワードが違います。" }, 401);
  }

  await env.DB.prepare("DELETE FROM auth_attempts WHERE ip = ?").bind(ip).run();
  const session = await createSession(env);
  await audit(env, "login", { ip });
  return json({ ok: true }, 200, { "set-cookie": sessionCookie(session) });
}

async function requireInternal(request, env) {
  const auth = request.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ") || !env.FACTORY_CONTROL_PLANE_KEY) return false;
  return secureEqual(auth.slice(7), env.FACTORY_CONTROL_PLANE_KEY);
}

async function handleInternal(request, env, url) {
  if (!(await requireInternal(request, env))) return json({ error: "unauthorized" }, 401);

  const claim = url.pathname.match(/^\/api\/internal\/jobs\/([^/]+)\/claim$/);
  if (claim && request.method === "POST") {
    const row = await env.DB.prepare(
      "SELECT encrypted_payload, expires_at, claimed_at FROM deployments WHERE id = ?",
    ).bind(claim[1]).first();
    if (!row) return json({ error: "job not found" }, 404);
    if (row.claimed_at) return json({ error: "job already claimed" }, 409);
    if (Date.parse(row.expires_at) < Date.now()) {
      await env.DB.prepare(
        "UPDATE deployments SET status = 'expired', conclusion = 'expired' WHERE id = ?",
      ).bind(claim[1]).run();
      return json({ error: "job expired" }, 410);
    }

    const workflowRunId = String(request.headers.get("x-factory-run-id") || "").trim();
    const workflowRunUrl = String(request.headers.get("x-factory-run-url") || "").trim();
    if (!/^\d+$/.test(workflowRunId)) return json({ error: "invalid workflow run id" }, 400);
    if (!workflowRunUrl.startsWith("https://github.com/")) return json({ error: "invalid workflow run url" }, 400);

    const payload = JSON.parse(await decryptValue(env, row.encrypted_payload));
    const claimed = await env.DB.prepare(
      `UPDATE deployments
       SET status = 'running', claimed_at = ?, workflow_run_id = ?, workflow_run_url = ?
       WHERE id = ? AND claimed_at IS NULL`,
    ).bind(nowIso(), workflowRunId, workflowRunUrl, claim[1]).run();
    if (!Number(claimed.meta?.changes || 0)) return json({ error: "job already claimed" }, 409);
    await audit(env, "deployment_claimed", { id: claim[1], workflow_run_id: workflowRunId });
    return json(payload);
  }

  const result = url.pathname.match(/^\/api\/internal\/jobs\/([^/]+)\/result$/);
  if (result && request.method === "POST") {
    const body = await request.json();
    const conclusion = String(body.conclusion || "unknown").slice(0, 40);
    const status = conclusion === "success" ? "completed" : "failed";
    const workflowRunId = String(body.workflow_run_id || "").slice(0, 40);
    const workflowRunUrl = String(body.workflow_run_url || "").slice(0, 500);
    if (!/^\d+$/.test(workflowRunId)) return json({ error: "invalid workflow run id" }, 400);

    let updated = await env.DB.prepare(
      `UPDATE deployments
       SET status = ?, conclusion = ?, completed_at = ?, workflow_run_url = ?
       WHERE id = ? AND workflow_run_id = ? AND status = 'running'`,
    ).bind(status, conclusion, nowIso(), workflowRunUrl, result[1], workflowRunId).run();

    if (!Number(updated.meta?.changes || 0) && status === "failed") {
      updated = await env.DB.prepare(
        `UPDATE deployments
         SET status = 'failed', conclusion = ?, completed_at = ?,
             workflow_run_id = ?, workflow_run_url = ?
         WHERE id = ?
           AND claimed_at IS NULL
           AND workflow_run_id IS NULL
           AND status IN ('queued', 'dispatched')`,
      ).bind(conclusion, nowIso(), workflowRunId, workflowRunUrl, result[1]).run();
    }

    if (!Number(updated.meta?.changes || 0)) {
      return json({ ok: true, ignored: true });
    }

    if (status === "completed") {
      await commitDeploymentSecretState(env, result[1]);
    }

    await audit(env, "deployment_result", { id: result[1], conclusion, workflow_run_id: workflowRunId });
    return json({ ok: true });
  }

  return json({ error: "not found" }, 404);
}

async function handleApi(request, env, url) {
  if (url.pathname === "/api/login" && request.method === "POST") return apiLogin(request, env);
  if (url.pathname.startsWith("/api/internal/")) return handleInternal(request, env, url);

  if (!(await verifySession(request, env))) return json({ error: "unauthorized" }, 401);

  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
    try {
      assertSameOrigin(request);
    } catch (error) {
      return json({ error: error.message }, 403);
    }
  }

  if (url.pathname === "/api/me" && request.method === "GET") {
    return json({ authenticated: true });
  }

  if (url.pathname === "/api/logout" && request.method === "POST") {
    return json({ ok: true }, 200, { "set-cookie": clearSessionCookie() });
  }

  if (url.pathname === "/api/settings" && request.method === "GET") {
    const github = await getSetting(env, "github_pat");
    return json({
      github_connected: Boolean(github),
      github_login: github?.metadata?.login || "",
      factory_repository: env.FACTORY_GITHUB_REPO || "",
    });
  }

  if (url.pathname === "/api/settings/github" && request.method === "PUT") {
    const body = await request.json();
    const token = String(body.token || "").trim();
    if (!token) return json({ error: "GitHub Tokenを入力してください。" }, 400);

    const response = await githubFetch(token, "/user");
    if (!response.ok) return json({ error: `GitHub Tokenを確認できませんでした (${response.status})` }, 400);
    const user = await response.json();
    if (env.ALLOWED_REPO_OWNER && user.login !== env.ALLOWED_REPO_OWNER) {
      return json({ error: `GitHub Tokenは @${env.ALLOWED_REPO_OWNER} のものを登録してください。` }, 400);
    }
    await setSetting(env, "github_pat", token, { login: user.login });
    await audit(env, "github_token_updated", { login: user.login });
    return json({ ok: true, login: user.login });
  }

  if (url.pathname === "/api/github/repos" && request.method === "GET") {
    const github = await getSetting(env, "github_pat");
    if (!github) return json({ error: "先にGitHub Tokenを登録してください。" }, 409);

    const repos = [];
    for (let page = 1; page <= 10; page += 1) {
      const response = await githubFetch(
        github.value,
        `/user/repos?per_page=100&page=${page}&affiliation=owner&sort=updated`,
      );
      if (!response.ok) return json({ error: "GitHubリポジトリ一覧を取得できませんでした。" }, 502);
      const batch = await response.json();
      repos.push(...batch);
      if (batch.length < 100) break;
    }

    const filtered = repos
      .filter((repo) => !env.ALLOWED_REPO_OWNER || repo.owner?.login === env.ALLOWED_REPO_OWNER)
      .map((repo) => ({
        name: repo.name,
        full_name: repo.full_name,
        private: Boolean(repo.private),
        default_branch: repo.default_branch || "main",
        updated_at: repo.updated_at,
      }));
    return json({ repositories: filtered });
  }

  if (url.pathname === "/api/github/manifest" && request.method === "GET") {
    const github = await getSetting(env, "github_pat");
    if (!github) return json({ error: "GitHub Tokenが未登録です。" }, 409);
    try {
      const repository = validateRepoName(url.searchParams.get("repo"), env);
      const ref = url.searchParams.get("ref") || "main";
      const manifest = await fetchManifest(env, github.value, repository, ref);
      const setup = normalizeSetup(manifest);
      return json({
        manifest: {
          name: normalizeWorkerName(manifest.name || repository.split("/")[1]),
          provider: manifest.provider || "cloudflare",
          runtime: manifest.runtime || "worker",
          working_directory: manifest.working_directory || ".",
          wrangler_config: manifest.wrangler_config || "auto",
        },
        setup,
      });
    } catch (error) {
      return json({ error: error.message }, 400);
    }
  }

  if (url.pathname === "/api/cloudflare/accounts" && request.method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT alias, label, account_id, created_at, updated_at FROM cloudflare_accounts ORDER BY label",
    ).all();
    return json({ accounts: rows.results || [] });
  }

  if (url.pathname === "/api/cloudflare/accounts" && request.method === "POST") {
    try {
      const body = await request.json();
      const accountId = String(body.account_id || "").trim();
      const token = String(body.api_token || "").trim();

      if (!/^[a-fA-F0-9]{32}$/.test(accountId)) throw new Error("Cloudflare Account IDの形式が不正です。");
      if (!token) throw new Error("Cloudflare API Tokenは必須です。");

      const label = String(body.label || "").trim() || `Cloudflare ${accountId.slice(0, 8)}`;
      const existing = await env.DB.prepare(
        "SELECT alias FROM cloudflare_accounts WHERE account_id = ?",
      ).bind(accountId).first();
      const alias = existing?.alias || `cf-${crypto.randomUUID()}`;

      const duplicateLabel = await env.DB.prepare(
        "SELECT account_id FROM cloudflare_accounts WHERE LOWER(label) = LOWER(?) AND account_id != ? LIMIT 1",
      ).bind(label, accountId).first();
      if (duplicateLabel) throw new Error("Cloudflare Accountの表示名は重複できません。");

      await verifyCloudflareAccount(accountId, token);
      const encryptedToken = await encryptValue(env, token);
      const now = nowIso();
      await env.DB.prepare(
        `INSERT INTO cloudflare_accounts(alias, label, account_id, encrypted_token, created_at, updated_at)
         VALUES(?, ?, ?, ?, ?, ?)
         ON CONFLICT(account_id) DO UPDATE SET
           label = excluded.label,
           encrypted_token = excluded.encrypted_token,
           updated_at = excluded.updated_at`,
      ).bind(alias, label, accountId, encryptedToken, now, now).run();
      await audit(env, "cloudflare_account_saved", { alias, account_id: accountId });
      return json({ ok: true });
    } catch (error) {
      return json({ error: error.message }, 400);
    }
  }

  const accountDelete = url.pathname.match(/^\/api\/cloudflare\/accounts\/([^/]+)$/);
  if (accountDelete && request.method === "DELETE") {
    const alias = decodeURIComponent(accountDelete[1]);
    const usage = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM deployments WHERE account_alias = ?",
    ).bind(alias).first();

    if (Number(usage?.count || 0) > 0) {
      return json({
        error: "このCloudflare AccountにはBOT起動履歴があるため削除できません。表示名やAPI Tokenは同じAccount IDで再登録して更新してください。",
      }, 409);
    }

    await env.DB.prepare(
      "DELETE FROM cloudflare_accounts WHERE alias = ?",
    ).bind(alias).run();
    await audit(env, "cloudflare_account_deleted", { alias });
    return json({ ok: true });
  }

  if (url.pathname === "/api/deployments" && request.method === "GET") {
    const rows = await env.DB.prepare(
      `SELECT d.id, d.repository, d.ref, d.worker_name, d.account_alias,
              COALESCE(c.label, '削除済みCloudflare Account') AS account_label,
              d.status, d.conclusion, d.workflow_run_id, d.workflow_run_url,
              d.created_at, d.completed_at
       FROM deployments d
       LEFT JOIN cloudflare_accounts c ON c.alias = d.account_alias
       ORDER BY d.created_at DESC
       LIMIT 50`,
    ).all();
    return json({ deployments: rows.results || [] });
  }

  if (url.pathname === "/api/deployments" && request.method === "POST") {
    try {
      const body = await request.json();
      const repository = validateRepoName(body.repository, env);
      const ref = String(body.ref || "main").trim();
      if (!ref || ref.length > 255 || /[\u0000-\u001f\u007f]/.test(ref)) {
        throw new Error("GitHub Branch / Refの形式が不正です。");
      }
      const accountAlias = String(body.account_alias || "").trim();
      const provided = body.fields && typeof body.fields === "object" ? body.fields : {};
      const confirmed = new Set(Array.isArray(body.confirmed_requirements) ? body.confirmed_requirements.map(String) : []);

      const github = await getSetting(env, "github_pat");
      if (!github) throw new Error("GitHub Tokenが未登録です。");

      const account = await env.DB.prepare(
        "SELECT alias, account_id, encrypted_token FROM cloudflare_accounts WHERE alias = ?",
      ).bind(accountAlias).first();
      if (!account) throw new Error("選択したCloudflare Accountが登録されていません。");

      const manifest = await fetchManifest(env, github.value, repository, ref);
      if (manifest.provider && manifest.provider !== "cloudflare") throw new Error("このBOTはCloudflare向けではありません。");
      if (manifest.runtime && manifest.runtime !== "worker") throw new Error("このBOTはWorker runtimeではありません。");

      const setup = normalizeSetup(manifest);
      const workerName = normalizeWorkerName(manifest.name || repository.split("/")[1]);

      // Clear expired/stalled jobs before checking the active-worker lock so
      // an old failed run cannot block an immediate retry.
      await cleanupExpiredDeployments(env);

      const previousWorker = await env.DB.prepare(
        `SELECT worker_name
         FROM deployments
         WHERE account_alias = ?
           AND repository = ?
           AND claimed_at IS NOT NULL
         ORDER BY created_at DESC
         LIMIT 1`,
      ).bind(account.alias, repository).first();
      if (previousWorker && previousWorker.worker_name !== workerName) {
        throw new Error(
          `Worker名の変更を検知しました。旧Worker「${previousWorker.worker_name}」との二重起動を防ぐため停止しました。`,
        );
      }

      const activeDeployment = await env.DB.prepare(
        `SELECT id
         FROM deployments
         WHERE account_alias = ?
           AND worker_name = ?
           AND status IN ('queued', 'dispatched', 'running')
         LIMIT 1`,
      ).bind(account.alias, workerName).first();
      if (activeDeployment) {
        throw new Error("このWorkerは既に起動処理中です。完了してから再実行してください。");
      }

      const conflictingDeployment = await env.DB.prepare(
        `SELECT repository
         FROM deployments
         WHERE account_alias = ?
           AND worker_name = ?
           AND repository != ?
           AND claimed_at IS NOT NULL
         ORDER BY created_at DESC
         LIMIT 1`,
      ).bind(account.alias, workerName, repository).first();
      if (conflictingDeployment) {
        throw new Error(`Worker名「${workerName}」は別のBOTリポジトリで使用済みです。`);
      }

      const requiredRequirements = [
        ...setup.discord.intents,
        ...setup.discord.permissions,
        ...setup.discord.checks,
      ].filter((item) => item.required);

      for (const item of requiredRequirements) {
        if (!confirmed.has(item.id)) throw new Error(`Discord設定「${item.label}」の確認が必要です。`);
      }

      const botSecrets = {};
      for (const field of setup.fields) {
        const rawValue = field.generate
          ? await getOrCreateManagedValue(env, repository, account.alias, field)
          : provided[field.key];
        const value = validateFieldValue(field, rawValue);

        if (field.runtime_env && value !== "") {
          botSecrets[field.key] = value;
        }
      }

      const currentSecretKeys = Object.keys(botSecrets).sort();
      if (currentSecretKeys.length > 100) {
        throw new Error("Cloudflare Worker Secretは1回のデプロイで100個までです。bot-factory.jsonのruntime_env項目を減らしてください。");
      }

      const previousSecretState = await env.DB.prepare(
        "SELECT secret_keys_json FROM worker_secret_state WHERE account_alias = ? AND worker_name = ?",
      ).bind(account.alias, workerName).first();
      const previousSecretKeys = parseSecretKeys(previousSecretState?.secret_keys_json || "[]");
      const currentSecretKeySet = new Set(currentSecretKeys);
      const staleSecretKeys = previousSecretKeys.filter((key) => !currentSecretKeySet.has(key));

      const factoryRepo = String(env.FACTORY_GITHUB_REPO || "").trim();
      const factoryRef = String(env.FACTORY_GITHUB_REF || "main").trim();
      if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(factoryRepo)) {
        throw new Error("FACTORY_GITHUB_REPO が未設定または不正です。");
      }
      if (!factoryRef || /[\u0000-\u001f\u007f]/.test(factoryRef)) {
        throw new Error("FACTORY_GITHUB_REF が不正です。");
      }

      const cloudflareToken = await decryptValue(env, account.encrypted_token);
      const id = crypto.randomUUID();
      const createdAt = nowIso();
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      const payload = {
        id,
        repository,
        ref,
        cloudflare_account_alias: account.alias,
        cloudflare_account_id: account.account_id,
        cloudflare_api_token: cloudflareToken,
        github_token: github.value,
        bot_secret_bundle: botSecrets,
        bot_secret_delete_keys: staleSecretKeys,
      };
      const encryptedPayload = await encryptValue(env, payload);

      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO deployments(
            id, repository, ref, worker_name, account_alias, encrypted_payload,
            status, created_at, expires_at
          ) VALUES(?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
        ).bind(
          id,
          repository,
          ref,
          workerName,
          account.alias,
          encryptedPayload,
          createdAt,
          expiresAt,
        ),
        env.DB.prepare(
          "INSERT INTO deployment_secret_sets(deployment_id, secret_keys_json) VALUES(?, ?)",
        ).bind(id, JSON.stringify(currentSecretKeys)),
      ]);

      let dispatch;
      try {
        dispatch = await githubFetch(
          github.value,
          `/repos/${factoryRepo}/actions/workflows/deploy-bot.yml/dispatches`,
          {
            method: "POST",
            body: JSON.stringify({
              ref: factoryRef,
              inputs: { job_id: id, confirm: "DEPLOY" },
            }),
          },
        );
      } catch (error) {
        await env.DB.prepare(
          "UPDATE deployments SET status = 'dispatch_failed', conclusion = ? WHERE id = ?",
        ).bind("github_network_error", id).run();
        throw new Error(`GitHub Actionsへの接続に失敗しました: ${error?.message || error}`);
      }

      if (!dispatch.ok) {
        const detail = await dispatch.text();
        await env.DB.prepare(
          "UPDATE deployments SET status = 'dispatch_failed', conclusion = ? WHERE id = ?",
        ).bind(`github_${dispatch.status}`, id).run();
        throw new Error(`GitHub Actionsを起動できませんでした (${dispatch.status}): ${detail.slice(0, 200)}`);
      }

      let workflowRunId = "";
      let workflowRunUrl = "";
      if (dispatch.status !== 204) {
        const result = await dispatch.json().catch(() => ({}));
        workflowRunId = result.workflow_run_id ? String(result.workflow_run_id) : "";
        workflowRunUrl = String(result.html_url || "");
      }

      if (workflowRunId) {
        await env.DB.prepare(
          `UPDATE deployments
           SET status = 'dispatched', workflow_run_id = ?, workflow_run_url = ?
           WHERE id = ? AND status = 'queued'`,
        ).bind(workflowRunId, workflowRunUrl, id).run();
      } else {
        await env.DB.prepare(
          "UPDATE deployments SET status = 'dispatched' WHERE id = ? AND status = 'queued'",
        ).bind(id).run();
      }

      const currentDeployment = await env.DB.prepare(
        "SELECT id, status, workflow_run_id, workflow_run_url FROM deployments WHERE id = ?",
      ).bind(id).first();

      await audit(env, "deployment_dispatched", {
        id,
        repository,
        account_alias: account.alias,
      });

      return json({
        ok: true,
        deployment: currentDeployment || {
          id,
          status: "dispatched",
          workflow_run_id: workflowRunId,
          workflow_run_url: workflowRunUrl,
        },
      });
    } catch (error) {
      return json({ error: error.message }, 400);
    }
  }

  const deploymentMatch = url.pathname.match(/^\/api\/deployments\/([^/]+)$/);
  if (deploymentMatch && request.method === "GET") {
    const row = await env.DB.prepare(
      `SELECT id, repository, ref, worker_name, account_alias, status, conclusion,
              workflow_run_id, workflow_run_url, created_at, completed_at
       FROM deployments WHERE id = ?`,
    ).bind(deploymentMatch[1]).first();
    if (!row) return json({ error: "not found" }, 404);

    if (row.workflow_run_id && !["completed", "failed"].includes(row.status)) {
      const github = await getSetting(env, "github_pat");
      if (github) {
        const response = await githubFetch(
          github.value,
          `/repos/${env.FACTORY_GITHUB_REPO}/actions/runs/${row.workflow_run_id}`,
        );
        if (response.ok) {
          const run = await response.json();
          row.status = run.status === "completed"
            ? (run.conclusion === "success" ? "completed" : "failed")
            : run.status;
          row.conclusion = run.conclusion || null;
          row.workflow_run_url = run.html_url || row.workflow_run_url;
          if (run.status === "completed") {
            await env.DB.prepare(
              "UPDATE deployments SET status = ?, conclusion = ?, workflow_run_url = ?, completed_at = ? WHERE id = ?",
            ).bind(row.status, row.conclusion, row.workflow_run_url, nowIso(), row.id).run();
          }
        }
      }
    }
    if (row.status === "completed") {
      await commitDeploymentSecretState(env, row.id);
    }
    return json({ deployment: row });
  }

  return json({ error: "not found" }, 404);
}

async function cleanupExpiredDeployments(env) {
  const now = nowIso();
  const staleRunningBefore = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const expired = await env.DB.prepare(
    `UPDATE deployments
     SET status = 'expired', conclusion = 'expired'
     WHERE claimed_at IS NULL
       AND status IN ('queued', 'dispatched')
       AND expires_at < ?`,
  ).bind(now).run();

  const stalled = await env.DB.prepare(
    `UPDATE deployments
     SET status = 'failed', conclusion = 'runner_timeout', completed_at = ?
     WHERE status = 'running'
       AND claimed_at IS NOT NULL
       AND claimed_at < ?`,
  ).bind(now, staleRunningBefore).run();

  return Number(expired.meta?.changes || 0) + Number(stalled.meta?.changes || 0);
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (url.pathname.startsWith("/api/")) return await handleApi(request, env, url);
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error("control-plane error", error?.message || error);
      return json({ error: "サーバー処理に失敗しました。" }, 500);
    }
  },

  async scheduled(_controller, env) {
    try {
      const cleaned = await cleanupExpiredDeployments(env);
      if (cleaned > 0) await audit(env, "deployment_expired_cleanup", { cleaned });
    } catch (error) {
      console.error("control-plane cleanup error", error?.message || error);
    }
  },
};
