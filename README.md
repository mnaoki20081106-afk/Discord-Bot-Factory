# Discord Bot Factory

Discord-Bot-Factory is a Cloudflare-only deployment factory with a private management site.

Normal operation is done from the site:

1. Select an existing GitHub bot repository.
2. Select the Cloudflare account that should host it.
3. Factory reads that bot's `bot-factory.json`.
4. The site automatically renders only the Discord information that bot requires.
5. The site also shows required Discord Developer Portal settings such as Privileged Gateway Intents and BOT permissions.
6. After required settings are confirmed, press **BOTを起動**.
7. The Control Plane creates an encrypted short-lived deployment job and starts the GitHub Actions deployment workflow using only the job ID.
8. GitHub Actions claims the job, deploys the Worker, applies configured D1 migrations, and reports the result back to the site.

## Security model

- Cloudflare account API Tokens are registered from the management site and encrypted with AES-256-GCM before being stored in D1.
- The GitHub fine-grained PAT is registered from the management site and encrypted in D1.
- Discord BOT Tokens and other bot-specific inputs are encrypted per deployment job and expire after 30 minutes.
- GitHub workflow dispatch inputs never contain Cloudflare or Discord tokens.
- The deployment workflow receives only a random job ID and retrieves the encrypted job through an authenticated internal API.
- The management site requires an administrator password and uses a signed HttpOnly/Secure/SameSite=Strict session cookie.
- Login attempts are rate-limited.
- Cloudflare account tokens are never returned to the browser after registration.

## Repository responsibility

Factory does **not** create GitHub repositories and does not write the bot itself.

The intended development flow is:

1. You create the GitHub repository.
2. ChatGPT implements the bot.
3. ChatGPT adds/updates `bot-factory.json`, including that bot's setup form and Discord requirements.
4. You use the Factory management site to deploy it.

## Components

- `apps/control-plane/`: private management site and encrypted credential/job store.
- `.github/workflows/deploy-control-plane.yml`: deploys the management site.
- `.github/workflows/deploy-bot.yml`: receives secure deployment jobs from the site.
- `scripts/cloudflare/deploy.sh`: Wrangler deployment engine.
- `scripts/read-manifest.mjs`: validates deployment information.
- `scripts/claim-job.mjs`: safely imports job credentials into the GitHub runner.

See [SETUP.md](docs/SETUP.md) for initial setup and [BOT_MANIFEST.md](docs/BOT_MANIFEST.md) for the per-bot manifest format.
