# One-time setup

The Factory is designed so provider credentials live here instead of being copied into every bot repository.

## 1. GitHub token

Create the repository secret:

- `FACTORY_GITHUB_PAT`

It must be able to:

- read private bot repositories that the Factory will deploy;
- push Wrangler-generated binding changes back to those repositories;
- create repositories if you use the **Create Bot Repository** workflow.

Keep its scope limited to the repositories/account operations needed by this Factory.

## 2. Cloudflare

Create these Factory repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

The API token should have only the permissions needed for the Worker resources your bots actually use.

## 3. Oracle Cloud

Create these Factory repository secrets:

- `OCI_TENANCY_OCID`
- `OCI_USER_OCID`
- `OCI_FINGERPRINT`
- `OCI_API_PRIVATE_KEY`
- `OCI_REGION`
- `OCI_COMPARTMENT_OCID`
- `BOT_FACTORY_SSH_PRIVATE_KEY`

The OCI identity used by the Factory needs permission in the target compartment to manage the networking and compute resources created by `scripts/oracle/ensure-host.sh`.

The Factory creates/reuses:

- one VCN;
- one subnet;
- one Internet Gateway;
- the default route/security rules needed for outbound connectivity and SSH;
- one shared free-tier compute host;
- one Docker container per deployed Node bot.

## 4. Per-bot runtime secrets

Create one Factory Actions secret per bot.

For example:

`BOT_BUNDLE_DISCORD_SECURITY`

Value:

```json
{
  "DISCORD_BOT_TOKEN": "...",
  "DISCORD_APPLICATION_ID": "...",
  "MAIN_BOT_APPLICATION_ID": "...",
  "SECURITY_BRIDGE_SECRET": "..."
}
```

When running **Deploy Bot**, enter the secret's *name* in `secret_bundle_name`.

The secret value is never committed into the bot repository.

## 5. Automatic provider selection

With both `runtime=auto` and `provider=auto`:

- a project containing `wrangler.jsonc`, `wrangler.json`, or `wrangler.toml` -> Cloudflare;
- a project containing a `Dockerfile` or `package.json` without Wrangler -> Oracle.

A Cloudflare Worker that depends on D1, Durable Objects, Workers service bindings, or other Worker-specific APIs is intentionally not sent to Oracle automatically.

## 6. First real deployment

Run **Actions -> Deploy Bot -> Run workflow**.

For the existing main bot:

- source repository: `mnaoki20081106-afk/Discord-Bot`
- source ref: `main`
- bot name: `discord-bot`
- working directory: `apps/worker`
- runtime: `auto`
- provider: `auto`

For Discord-Security:

- source repository: `mnaoki20081106-afk/Discord-Security`
- source ref: `main`
- bot name: `discord-security`
- working directory: `.`
- runtime: `auto`
- provider: `auto`

The first live deployment should only be run after the required provider and bot secrets are present.
