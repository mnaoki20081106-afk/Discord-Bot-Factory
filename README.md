# Discord Bot Factory

Discord-Bot-Factory takes an **existing bot repository**, prepares a supported free hosting environment, deploys the bot, and starts it.

It does **not** create GitHub repositories and it does not write the bot application itself.

## Intended flow

1. You create the GitHub repository.
2. ChatGPT writes the bot code and, when useful, adds `bot-factory.json`.
3. Discord-Bot-Factory reads that repository.
4. Factory selects/configures the hosting environment.
5. Factory deploys the code and starts the bot.
6. Factory exits. It is not a continuously running management service.

## Supported deployment paths

### Cloudflare Workers

Worker projects deploy to Cloudflare. Wrangler configuration remains the source of truth.

Factory can:

- install dependencies;
- deploy the Worker;
- upload bot runtime secrets with the deployment;
- let Wrangler provision supported draft bindings such as D1/KV/R2;
- apply listed D1 migrations;
- persist generated Wrangler resource IDs back to the bot repository;
- optionally verify a health URL.

### Persistent Node/Docker bots

Persistent Gateway bots deploy to an Oracle Cloud free-tier VM.

Factory can:

- create/reuse the Factory VCN, subnet, Internet Gateway, routes, and SSH security rule;
- create/reuse one supported free-tier VM;
- install/harden Docker host prerequisites on first boot;
- build each bot as its own Docker container;
- provide its runtime secrets through a protected env file;
- start it with Docker's `unless-stopped` restart policy;
- verify the container remains running after startup.

Factory never falls back to a paid OCI shape.

## Repository manifest

For deterministic deployments, bot repositories should contain `bot-factory.json`.

See [BOT_MANIFEST.md](docs/BOT_MANIFEST.md).

If the manifest is absent, Factory performs conservative auto-detection and refuses ambiguous repositories.

## Setup

See [SETUP.md](docs/SETUP.md).
