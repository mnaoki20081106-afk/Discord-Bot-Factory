# bot-factory.json

`bot-factory.json` lives at the root of each bot repository and tells Discord-Bot-Factory which Cloudflare account should host it.

The Factory is Cloudflare-only.

## Required fields

- `cloudflare_account`: alias of the Cloudflare account registered in `CLOUDFLARE_ACCOUNTS_JSON`.

## Recommended fields

- `name`: Worker name.
- `runtime`: `worker`.
- `provider`: `cloudflare`.
- `working_directory`: directory containing the Worker project.
- `wrangler_config`: Wrangler config filename inside `working_directory`.
- `health_url`: optional URL checked after deploy.
- `d1_migrations`: optional array of D1 binding names whose migrations should be applied remotely after deploy.

## Example

```json
{
  "name": "discord-security",
  "runtime": "worker",
  "provider": "cloudflare",
  "cloudflare_account": "guild-main",
  "working_directory": ".",
  "wrangler_config": "wrangler.jsonc",
  "d1_migrations": ["DB"],
  "health_url": "https://discord-security.example.workers.dev/health"
}
```

## Account assignment

Related bots for one Discord server should normally use the same `cloudflare_account` alias.

Example:

```text
Discord server A
  main bot      -> guild-a
  security bot  -> guild-a
  utility bot   -> guild-a

Discord server B
  main bot      -> guild-b
  security bot  -> guild-b
```

This keeps same-server Workers and bindings inside one Cloudflare account.

## Safety behavior

Factory refuses deployment when:

- `bot-factory.json` is missing;
- `cloudflare_account` is missing or invalid;
- the alias is not in `CLOUDFLARE_ACCOUNTS_JSON`;
- the alias points to an invalid Account ID or token secret name;
- the project is configured for a non-Cloudflare provider or non-Worker runtime;
- the Wrangler config cannot be resolved safely.

Factory does not automatically move a bot between Cloudflare accounts.


## Wrangler account_id

Do not put `account_id` in the Wrangler config for Factory-managed bots.

The selected `cloudflare_account` alias is resolved by Factory and exported as `CLOUDFLARE_ACCOUNT_ID`. A hard-coded Wrangler `account_id` is rejected to prevent accidental cross-account deployment.
