const $ = (id) => document.getElementById(id);
const state = { repositories: [], accounts: [], manifest: null, setup: null, repository: "", ref: "main" };

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 && path !== "/api/login") {
    showLogin();
    throw new Error("ログインが必要です。");
  }
  if (!response.ok) throw new Error(body.error || ("HTTP " + response.status));
  return body;
}

function showLogin() {
  $("loginView").classList.remove("hidden");
  $("appView").classList.add("hidden");
}
function showApp() {
  $("loginView").classList.add("hidden");
  $("appView").classList.remove("hidden");
}
function setTab(name) {
  document.querySelectorAll(".nav-item").forEach((el) => el.classList.toggle("active", el.dataset.tab === name));
  document.querySelectorAll(".tab").forEach((el) => el.classList.toggle("active", el.id === "tab-" + name));
}
function setStateText(id, text, kind = "") {
  const el = $(id);
  el.textContent = text;
  el.style.color = kind === "error" ? "var(--bad)" : kind === "good" ? "var(--good)" : "";
}
function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}
function option(value, label) {
  const el = document.createElement("option");
  el.value = value;
  el.textContent = label;
  return el;
}
function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function renderRepos() {
  clear($("repoSelect"));
  $("repoSelect").append(option("", "選択してください"));
  for (const repo of state.repositories) {
    const el = option(repo.full_name, repo.full_name + (repo.private ? " 🔒" : ""));
    el.dataset.ref = repo.default_branch || "main";
    $("repoSelect").append(el);
  }
}

function renderAccounts() {
  clear($("accountSelect"));
  $("accountSelect").append(option("", "選択してください"));
  for (const account of state.accounts) {
    $("accountSelect").append(option(account.alias, account.label));
  }

  clear($("accountList"));
  if (!state.accounts.length) {
    $("accountList").append(element("div", "muted", "Cloudflare Accountはまだ登録されていません。"));
    return;
  }
  for (const account of state.accounts) {
    const row = element("div", "list-item");
    const info = element("div");
    info.append(element("strong", "", account.label));
    info.append(element("small", "", account.account_id));
    const button = element("button", "danger", "削除");
    button.dataset.deleteAccount = account.alias;
    row.append(info, button);
    $("accountList").append(row);
  }
}

function makeField(field) {
  const wrap = element("label");
  const title = element("span", "", field.label);

  if (field.generate) {
    title.append(element("span", "tag", "Factory自動生成"));
    wrap.append(title);
    wrap.append(element("div", "managed-value", "Factoryが安全なランダム値を生成・暗号化保存し、再デプロイ時も同じ値を再利用します。"));
    if (field.help) wrap.append(element("small", "hint", field.help));
    return wrap;
  }

  if (field.required) title.append(element("span", "tag", "必須"));
  wrap.append(title);

  let input;
  if (field.type === "select" || field.type === "boolean") {
    input = document.createElement("select");
    input.append(option("", "選択してください"));
    if (field.type === "boolean") {
      input.append(option("true", "ON"), option("false", "OFF"));
    } else {
      for (const item of field.options || []) {
        const value = typeof item === "string" ? item : String(item.value || "");
        const label = typeof item === "string" ? item : String(item.label || item.value || "");
        input.append(option(value, label));
      }
    }
  } else {
    input = document.createElement("input");
    input.type = field.type === "secret" ? "password" : field.type === "number" ? "number" : field.type === "url" ? "url" : "text";
    input.placeholder = field.placeholder || "";
    input.autocomplete = field.type === "secret" ? "new-password" : "off";
  }
  input.id = "field-" + field.key;
  input.dataset.field = field.key;
  input.required = Boolean(field.required);
  wrap.append(input);

  if (field.help) wrap.append(element("small", "hint", field.help));

  const source = field.source || {};
  if ((source.steps || []).length || source.url) {
    const details = document.createElement("details");
    details.className = "field-help";
    const summary = element("summary", "", source.title || "取得方法");
    details.append(summary);

    if ((source.steps || []).length) {
      const list = document.createElement("ol");
      for (const step of source.steps) list.append(element("li", "", step));
      details.append(list);
    }

    if (source.url) {
      const link = element("a", "", source.link_label || "設定画面を開く ↗");
      link.href = source.url;
      link.target = "_blank";
      link.rel = "noreferrer";
      details.append(link);
    }
    wrap.append(details);
  }

  return wrap;
}

function makeRequirement(item) {
  const label = element("label", "requirement");
  const check = document.createElement("input");
  check.type = "checkbox";
  check.dataset.requirement = item.id;
  check.dataset.required = item.required ? "1" : "0";

  const body = element("span");
  const strong = element("strong", "", item.label);
  if (item.required) strong.append(element("em", "tag", "必須"));
  body.append(strong);
  if (item.description) body.append(element("small", "", item.description));
  if (item.path) body.append(element("small", "", "設定場所: " + item.path));
  if (item.url) {
    const link = element("a", "", "設定画面を開く ↗");
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    body.append(link);
  }
  label.append(check, body);
  return label;
}

function renderSetup() {
  const setup = state.setup || {};
  $("setupTitle").textContent = setup.title || "Discord設定";
  $("setupDescription").textContent = setup.description || "このBOTが必要とする情報だけ表示されます。";

  clear($("dynamicFields"));
  if (!(setup.fields || []).length) {
    const empty = element("div", "muted full", "このBOTは追加情報を要求しません。");
    $("dynamicFields").append(empty);
  } else {
    for (const field of setup.fields) $("dynamicFields").append(makeField(field));
  }

  clear($("discordRequirements"));
  const discord = setup.discord || {};
  const groups = [
    ["Privileged Gateway Intents", discord.intents || []],
    ["BOT権限", discord.permissions || []],
    ["その他の確認", discord.checks || []],
  ];
  for (const group of groups) {
    if (!group[1].length) continue;
    const box = element("div", "requirement-group");
    box.append(element("h3", "", group[0]));
    for (const item of group[1]) box.append(makeRequirement(item));
    $("discordRequirements").append(box);
  }
  if ((discord.notes || []).length) {
    const notes = element("div", "notes");
    for (const note of discord.notes) notes.append(element("div", "", "• " + note));
    $("discordRequirements").append(notes);
  }

  $("discordStep").classList.remove("disabled-card");
  updateLaunchState();
}

function requiredRequirementsChecked() {
  return Array.from(document.querySelectorAll('[data-requirement][data-required="1"]')).every((el) => el.checked);
}
function fieldsValid() {
  if (!state.setup) return false;
  return (state.setup.fields || []).every((field) => {
    if (field.generate) return true;
    const el = $("field-" + field.key);
    if (!el) return !field.required;
    if (field.type === "boolean") return !field.required || el.value === "true" || el.value === "false";
    return !field.required || Boolean(el.value.trim());
  });
}
function canLaunch() {
  return Boolean(state.manifest && $("accountSelect").value && fieldsValid() && requiredRequirementsChecked());
}
function updateSteps() {
  const hasRepo = Boolean(state.manifest);
  const hasAccount = Boolean($("accountSelect").value);
  document.querySelector('[data-step="1"]').classList.toggle("done", hasRepo);
  document.querySelector('[data-step="2"]').classList.toggle("done", hasRepo && hasAccount);
  document.querySelector('[data-step="3"]').classList.toggle("done", canLaunch());
  $("accountStep").classList.toggle("disabled-card", !hasRepo);
  $("launchStep").classList.toggle("disabled-card", !hasRepo || !hasAccount);
}
function updateLaunchState() {
  updateSteps();
  $("launchButton").disabled = !canLaunch();

  const account = state.accounts.find((x) => x.alias === $("accountSelect").value);
  clear($("launchSummary"));
  const values = [
    ["GitHub", state.repository || "未選択"],
    ["Branch", state.ref || "main"],
    ["Cloudflare", account ? account.label : "未選択"],
    ["Worker", state.manifest ? state.manifest.name : "未読込"],
  ];
  for (const pair of values) {
    const row = element("div", "summary-row");
    row.append(element("span", "", pair[0]), element("b", "", pair[1]));
    $("launchSummary").append(row);
  }
}

async function loadManifest() {
  const selected = $("repoSelect").selectedOptions[0];
  state.repository = $("repoSelect").value;
  if (!state.repository) return;

  $("repoRef").value = (selected && selected.dataset.ref) || "main";
  state.ref = $("repoRef").value.trim() || "main";
  setStateText("manifestState", "bot-factory.json を読み込んでいます…");

  try {
    const path = "/api/github/manifest?repo=" + encodeURIComponent(state.repository) + "&ref=" + encodeURIComponent(state.ref);
    const data = await api(path);
    state.manifest = data.manifest;
    state.setup = data.setup;
    setStateText("manifestState", data.setup.title + " のセットアップ定義を読み込みました。", "good");
    $("accountStep").classList.remove("disabled-card");
    renderSetup();
  } catch (error) {
    state.manifest = null;
    state.setup = null;
    $("accountStep").classList.add("disabled-card");
    $("discordStep").classList.add("disabled-card");
    $("launchStep").classList.add("disabled-card");
    setStateText("manifestState", error.message, "error");
  }
  updateLaunchState();
}

async function loadRepos() {
  try {
    const data = await api("/api/github/repos");
    state.repositories = data.repositories || [];
    renderRepos();
  } catch (error) {
    state.repositories = [];
    renderRepos();
    setStateText("manifestState", error.message, "error");
  }
}
async function loadAccounts() {
  const data = await api("/api/cloudflare/accounts");
  state.accounts = data.accounts || [];
  renderAccounts();
  updateLaunchState();
}
async function loadSettings() {
  const data = await api("/api/settings");
  $("githubConnection").textContent = data.github_connected ? "接続済み: @" + data.github_login : "GitHub Tokenが未登録です。";
  $("factoryStatus").textContent = data.github_connected ? "GitHub接続済み" : "GitHub未接続";
}
async function loadHistory() {
  const data = await api("/api/deployments");
  clear($("historyList"));
  const rows = data.deployments || [];
  if (!rows.length) {
    $("historyList").append(element("div", "muted", "まだ起動履歴はありません。"));
    return;
  }
  for (const row of rows) {
    const item = element("div", "list-item");
    const info = element("div");
    info.append(element("strong", "", row.worker_name));
    info.append(element("small", "", row.repository + " · " + row.account_label + " · " + new Date(row.created_at).toLocaleString("ja-JP")));

    const right = element("div");
    right.append(element("span", "status " + row.status, row.conclusion || row.status));
    if (row.workflow_run_url) {
      const link = element("a", "ghost", "Actions");
      link.href = row.workflow_run_url;
      link.target = "_blank";
      link.rel = "noreferrer";
      right.append(link);
    }
    item.append(info, right);
    $("historyList").append(item);
  }
}

async function bootstrap() {
  try {
    await api("/api/me");
    showApp();
    await Promise.all([loadSettings(), loadAccounts(), loadHistory()]);
    await loadRepos();
  } catch {
    showLogin();
  }
}

$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("loginError").textContent = "";
  try {
    await api("/api/login", { method: "POST", body: JSON.stringify({ password: $("loginPassword").value }) });
    $("loginPassword").value = "";
    showApp();
    await Promise.all([loadSettings(), loadAccounts(), loadHistory()]);
    await loadRepos();
  } catch (error) {
    $("loginError").textContent = error.message;
  }
});

$("logoutButton").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST", body: "{}" }).catch(() => {});
  showLogin();
});

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => setTab(button.dataset.tab));
});

$("githubForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  setStateText("githubFormState", "接続を確認しています…");
  try {
    const data = await api("/api/settings/github", {
      method: "PUT",
      body: JSON.stringify({ token: $("githubToken").value }),
    });
    $("githubToken").value = "";
    setStateText("githubFormState", "@" + data.login + " と接続しました。", "good");
    await loadSettings();
    await loadRepos();
  } catch (error) {
    setStateText("githubFormState", error.message, "error");
  }
});

$("accountForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  setStateText("accountFormState", "Cloudflare APIを確認しています…");
  try {
    await api("/api/cloudflare/accounts", {
      method: "POST",
      body: JSON.stringify({
        label: $("accountLabel").value,
        account_id: $("accountId").value,
        api_token: $("accountToken").value,
      }),
    });
    $("accountToken").value = "";
    setStateText("accountFormState", "登録しました。", "good");
    await loadAccounts();
  } catch (error) {
    setStateText("accountFormState", error.message, "error");
  }
});

$("accountList").addEventListener("click", async (event) => {
  const alias = event.target && event.target.dataset ? event.target.dataset.deleteAccount : "";
  if (!alias) return;
  const account = state.accounts.find((item) => item.alias === alias);
  if (!confirm((account?.label || "このCloudflare Account") + " を削除しますか？")) return;
  await api("/api/cloudflare/accounts/" + encodeURIComponent(alias), { method: "DELETE", body: "{}" });
  await loadAccounts();
});

$("repoSelect").addEventListener("change", loadManifest);
$("repoRef").addEventListener("change", loadManifest);
$("accountSelect").addEventListener("change", updateLaunchState);
$("discordStep").addEventListener("input", updateLaunchState);
$("discordStep").addEventListener("change", updateLaunchState);

$("launchButton").addEventListener("click", async () => {
  if (!canLaunch()) return;

  const fields = {};
  for (const field of state.setup.fields || []) {
    if (field.generate) continue;
    const el = $("field-" + field.key);
    if (!el) continue;
    fields[field.key] = field.type === "boolean" ? el.value === "true" : el.value;
  }
  const confirmed = Array.from(document.querySelectorAll("[data-requirement]:checked")).map((el) => el.dataset.requirement);

  $("launchButton").disabled = true;
  setStateText("launchState", "Factoryを起動しています…");
  try {
    const data = await api("/api/deployments", {
      method: "POST",
      body: JSON.stringify({
        repository: state.repository,
        ref: state.ref,
        account_alias: $("accountSelect").value,
        fields,
        confirmed_requirements: confirmed,
      }),
    });
    setStateText("launchState", "起動処理を開始しました。履歴から状態を確認できます。", "good");
    setTab("history");
    await loadHistory();
    if (data.deployment && data.deployment.id) {
      setTimeout(loadHistory, 4000);
      setTimeout(loadHistory, 12000);
    }
  } catch (error) {
    setStateText("launchState", error.message, "error");
  } finally {
    updateLaunchState();
  }
});

$("refreshHistory").addEventListener("click", loadHistory);
bootstrap();
