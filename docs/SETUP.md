# Discord Bot Factory setup

Factory deploys **existing** bot repositories. It never creates repositories.

The one-time setup is split into GitHub access plus the hosting providers you want Factory to use.

## GitHub

Add this Actions secret to Discord-Bot-Factory:

- `FACTORY_GITHUB_PAT`

It is used to read bot repositories and, for Cloudflare deployments, commit Wrangler-generated resource IDs back to the source branch.

Recommended scope:

- access to the bot repositories Factory will deploy;
- repository Contents: read/write.

Repository-creation permission is not required.

## Cloudflare path

Required Factory repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

The Cloudflare token must be scoped to the account Factory deploys into and must have the permissions required by the resources declared in each bot's Wrangler config.

Bot-specific runtime values such as Discord tokens are stored separately as JSON repository secrets in Factory, for example:

`BOT_BUNDLE_DISCORD_SECURITY`

Example value:

```json
{
  "DISCORD_BOT_TOKEN": "...",
  "DISCORD_APPLICATION_ID": "..."
}
```

Do not commit these values into a bot repository.

## Oracle Cloud path

Required Factory repository secrets:

- `OCI_TENANCY_OCID`
- `OCI_USER_OCID`
- `OCI_FINGERPRINT`
- `OCI_API_PRIVATE_KEY`
- `OCI_REGION`
- `OCI_COMPARTMENT_OCID`
- `BOT_FACTORY_SSH_PRIVATE_KEY`

The OCI identity needs permission in the selected compartment to manage the VCN/network resources and Compute instances used by Factory.

Factory only attempts supported free-tier shapes. If free-tier capacity is unavailable, deployment fails instead of selecting a paid shape.

## Per-bot manifest

ChatGPT should normally add `bot-factory.json` while implementing each bot. That removes guesswork from deployment.

Example Worker:

```json
{
  "name": "discord-security",
  "runtime": "worker",
  "provider": "cloudflare",
  "working_directory": ".",
  "wrangler_config": "wrangler.jsonc",
  "d1_migrations": ["DB"],
  "health_url": "https://example.workers.dev/health"
}
```

Example persistent Node bot:

```json
{
  "name": "discord-ticket",
  "runtime": "node",
  "provider": "oracle",
  "working_directory": "."
}
```

## Deploying

Open:

**Discord-Bot-Factory -> Actions -> Deploy Bot -> Run workflow**

Enter:

- `source_repository`: e.g. `mnaoki20081106-afk/Discord-Ticket`;
- `source_ref`: normally `main`;
- `secret_bundle_name`: the Factory secret holding this bot's runtime secrets;
- `confirm`: `DEPLOY`.

Everything after repository selection is automated.

Factory finishes after deployment/startup verification. It does not remain online as a monitoring service.
