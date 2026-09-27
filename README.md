# Discord Bot Factory

Discord-Bot-Factory deploys an **existing Discord bot repository** to a selected Cloudflare account.

It does not create GitHub repositories and it does not write the bot application itself.

## Intended flow

1. You create the bot repository.
2. ChatGPT writes the bot code and adds `bot-factory.json`.
3. `bot-factory.json` assigns that bot to a Cloudflare account alias.
4. Discord-Bot-Factory resolves that alias through the Factory account registry.
5. Factory deploys the Worker, provisions Wrangler-declared resources, uploads runtime secrets, and optionally applies D1 migrations.
6. Factory exits after deployment/startup verification.

## Cloudflare account isolation

The Factory is Cloudflare-only and supports multiple Cloudflare accounts.

Each Discord server can be assigned to a different Cloudflare account. Related Workers for the same Discord server should use the same account alias so service bindings and data resources stay together.

The account registry stores only non-secret metadata:

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

This JSON is stored as the GitHub Actions repository variable `CLOUDFLARE_ACCOUNTS_JSON`.

Each `token_secret` points to a separate GitHub Actions secret containing an API token scoped only to that Cloudflare account.

## What Factory does

- checks out the existing bot repository;
- requires an explicit `cloudflare_account` assignment;
- selects the corresponding Cloudflare Account ID and API token;
- installs dependencies;
- deploys with Wrangler;
- supplies bot runtime secrets;
- allows Wrangler to provision supported resources;
- optionally applies listed D1 migrations;
- persists Wrangler-generated resource IDs back to the bot repository;
- optionally checks a health URL.

## What Factory does not do

- create GitHub repositories;
- deploy to Oracle/VPS/other providers;
- spread one bot across accounts automatically;
- move a bot to another account when quota is reached;
- continuously monitor or operate the bot after deployment.

See [SETUP.md](docs/SETUP.md) for setup and [BOT_MANIFEST.md](docs/BOT_MANIFEST.md) for the bot manifest.
