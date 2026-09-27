# Factory management site setup

This is the one-time bootstrap for the Factory management site.

After this is complete, normal Cloudflare account registration and Discord BOT input are done from the website.

## 1. Choose the Cloudflare account that hosts the Control Plane

The management site itself needs one Cloudflare account.

This account is only for hosting the Factory Control Plane. It does not have to be the same account used by deployed Discord bots.

Create an API Token that can deploy Workers and D1 in that account.

In the Discord-Bot-Factory GitHub repository create these Actions secrets:

- `CONTROL_PLANE_CLOUDFLARE_API_TOKEN`
- `CONTROL_PLANE_CLOUDFLARE_ACCOUNT_ID`

## 2. Create Control Plane security secrets

Create these GitHub Actions secrets:

- `CONTROL_PLANE_ADMIN_PASSWORD`
- `CONTROL_PLANE_MASTER_KEY`
- `CONTROL_PLANE_SESSION_SECRET`
- `FACTORY_CONTROL_PLANE_KEY`

Recommended generation commands:

```bash
# AES-256 key used to encrypt GitHub/Cloudflare/Discord credentials in D1
openssl rand -base64 32

# Session signing secret
openssl rand -hex 32

# Shared site <-> GitHub Actions authentication key
openssl rand -hex 32
```

Use the first output for `CONTROL_PLANE_MASTER_KEY`.

Use the second for `CONTROL_PLANE_SESSION_SECRET`.

Use the third for `FACTORY_CONTROL_PLANE_KEY`.

Choose your own strong value for `CONTROL_PLANE_ADMIN_PASSWORD`.

Do not reuse any Cloudflare or Discord password/token for these values.

## 3. Deploy the management site

Open:

**GitHub > Discord-Bot-Factory > Actions > Deploy Control Plane > Run workflow**

Enter:

`DEPLOY_CONTROL`

The workflow:

1. installs Wrangler;
2. deploys the Control Plane Worker and static management site;
3. automatically provisions the D1 binding;
4. applies `schema.sql`;
5. uploads the Control Plane secrets.

Copy the final `workers.dev` URL from the Wrangler deployment log.

## 4. Link GitHub Actions back to the site

In:

**Discord-Bot-Factory > Settings > Secrets and variables > Actions > Variables**

Create:

- `FACTORY_CONTROL_PLANE_URL`

Value:

```text
https://your-control-plane.workers.dev
```

The `FACTORY_CONTROL_PLANE_KEY` GitHub secret created earlier is used by the deployment workflow to securely claim deployment jobs from this URL.

## 5. Log in to the site

Open the workers.dev URL and log in with the value stored in:

`CONTROL_PLANE_ADMIN_PASSWORD`

## 6. Connect GitHub from the site

Open:

**設定 > GitHub接続**

Create a fine-grained GitHub PAT that can:

- read/write Contents for bot repositories the Factory will deploy;
- write Actions for the Discord-Bot-Factory repository.

Paste the PAT into the site.

The site verifies it with GitHub and then stores it encrypted in D1.

The PAT is not shown again after registration.

## 7. Register Cloudflare accounts from the site

Open:

**Cloudflare > Accountを登録**

For each Discord-server Cloudflare account enter:

- Display name
- Alias
- 32-character Cloudflare Account ID
- API Token scoped to that account

The Control Plane verifies that the token can access Workers in that Account and stores the token encrypted in D1.

The browser cannot retrieve the stored token later.

Recommended account layout:

```text
Discord server A -> Cloudflare Account A
Discord server B -> Cloudflare Account B
Discord server C -> Cloudflare Account C
```

Related Workers for the same Discord server should normally be deployed to the same Cloudflare account.

## 8. Prepare each bot repository

ChatGPT should add a `bot-factory.json` when implementing a bot.

The manifest defines:

- Worker deployment information;
- required Discord values;
- required Privileged Gateway Intents;
- required BOT permissions;
- any other manual checks.

See [BOT_MANIFEST.md](BOT_MANIFEST.md).

## 9. Normal deployment flow

From the management site:

1. Select the GitHub repository.
2. Select the Cloudflare account.
3. Enter only the fields requested by that bot.
4. Confirm the Discord Intent/permission checklist.
5. Press **BOTを起動**.

The site encrypts a deployment payload with a 30-minute expiry and triggers `deploy-bot.yml` with only the random job ID.

GitHub Actions claims that job through the internal authenticated API, deploys the Worker, and reports the result back to the site.

## Secret storage summary

Persistent and encrypted in Control Plane D1:

- GitHub PAT
- Cloudflare account API Tokens

Short-lived and encrypted per deployment:

- Discord BOT Token
- Application ID and other bot-specific runtime input

Stored only as Worker/GitHub bootstrap secrets:

- Control Plane master encryption key
- administrator password
- session signing secret
- site <-> Actions shared key

No Discord or Cloudflare credential is passed as a GitHub workflow input.
