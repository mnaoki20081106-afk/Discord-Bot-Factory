# Discord Bot Factory setup

Factory deploys existing bot repositories to explicitly selected Cloudflare accounts.

## 1. GitHub source access

Create this Actions repository secret in Discord-Bot-Factory:

- `FACTORY_GITHUB_PAT`

It needs access to the bot repositories Factory will deploy, with repository Contents read/write.

Read access is used to fetch bot code. Write access is used only when Wrangler writes generated resource IDs into a Wrangler config and Factory persists those changes back to the bot repository.

Repository-creation permission is not required.

## 2. Create one Cloudflare API token per Cloudflare account

For every Cloudflare account used by Factory, create a separate API token scoped only to that account.

For example:

- Discord server A -> Cloudflare account A -> `CLOUDFLARE_GUILD_A_API_TOKEN`
- Discord server B -> Cloudflare account B -> `CLOUDFLARE_GUILD_B_API_TOKEN`

The token needs the Cloudflare permissions required by the Wrangler resources used by bots in that account. At minimum, Worker deployment requires Workers Scripts write/edit access. Add D1/KV/R2/etc permissions only when that account's bots use those resources.

Do not use one unrestricted token for every Cloudflare account.

## 3. Register account metadata

In Discord-Bot-Factory:

**Settings -> Secrets and variables -> Actions -> Variables -> New repository variable**

Create:

`CLOUDFLARE_ACCOUNTS_JSON`

Example value:

```json
{
  "guild-a": {
    "account_id": "0123456789abcdef0123456789abcdef",
    "token_secret": "CLOUDFLARE_GUILD_A_API_TOKEN"
  },
  "guild-b": {
    "account_id": "fedcba9876543210fedcba9876543210",
    "token_secret": "CLOUDFLARE_GUILD_B_API_TOKEN"
  }
}
```

Rules:

- the top-level key is the account alias used by `bot-factory.json`;
- `account_id` is that Cloudflare account's 32-character Account ID;
- `token_secret` is the name of the GitHub Actions secret containing the API token for that account;
- aliases use lowercase letters, numbers, hyphens, or underscores.

Account IDs and secret names are not secret, so the registry is a GitHub Variable rather than a Secret.

## 4. Add the API token secrets

In:

**Settings -> Secrets and variables -> Actions -> Secrets**

Create each secret named by the registry, for example:

- `CLOUDFLARE_GUILD_A_API_TOKEN`
- `CLOUDFLARE_GUILD_B_API_TOKEN`

Each secret value is the Cloudflare API token scoped to only that Cloudflare account.

## 5. Add bot runtime secrets

Bot-specific values such as Discord tokens are separate from Cloudflare credentials.

Example secret:

`BOT_BUNDLE_DISCORD_SECURITY`

Value:

```json
{
  "DISCORD_BOT_TOKEN": "...",
  "DISCORD_APPLICATION_ID": "..."
}
```

Do not commit these values into the bot repository.

## 6. Add bot-factory.json to each bot repository

Example:

```json
{
  "name": "discord-security",
  "runtime": "worker",
  "provider": "cloudflare",
  "cloudflare_account": "guild-a",
  "working_directory": ".",
  "wrangler_config": "wrangler.jsonc",
  "d1_migrations": ["DB"],
  "health_url": "https://example.workers.dev/health"
}
```

The `cloudflare_account` value must match an alias in `CLOUDFLARE_ACCOUNTS_JSON`.

Factory intentionally refuses to deploy a bot that does not specify an account alias.

## 7. Deploy

Open:

**Discord-Bot-Factory -> Actions -> Deploy Bot -> Run workflow**

Enter:

- `source_repository`: for example `mnaoki20081106-afk/Discord-Security`;
- `source_ref`: normally `main`;
- `secret_bundle_name`: for example `BOT_BUNDLE_DISCORD_SECURITY`;
- `confirm`: `DEPLOY`.

Factory then:

1. reads `bot-factory.json`;
2. resolves the selected Cloudflare account;
3. loads only that account's API token;
4. deploys the Worker;
5. provisions/links Wrangler-declared resources;
6. applies configured D1 migrations;
7. persists generated Wrangler resource IDs when necessary;
8. performs the optional health check.

Factory does not fail over to another Cloudflare account automatically.


## Wrangler account_id rule

Do not hard-code `account_id` in a bot's `wrangler.jsonc`, `wrangler.json`, or `wrangler.toml`.

The Factory account registry is the single source of truth for routing. Factory sets `CLOUDFLARE_ACCOUNT_ID` for the selected account and rejects Wrangler configs that contain `account_id`.
