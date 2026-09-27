# One-time setup

Discord-Bot-Factory only creates bot repositories and starter code. It does not deploy or operate bots.

## Required GitHub secret

Create one repository secret in Discord-Bot-Factory:

- `FACTORY_GITHUB_PAT`

The token must be able to:

- create repositories in your GitHub account;
- clone the newly created repository;
- push the generated starter code.

No Cloudflare credentials, Oracle credentials, Discord bot tokens, production environment variables, or hosting secrets belong in this Factory.

## Creating a bot

Run:

**Actions -> Create Bot Repository -> Run workflow**

Inputs:

- `repository_name`: the GitHub repository name;
- `runtime`:
  - `node` for a persistent Node/discord.js starter;
  - `worker` for a Cloudflare Worker starter;
- `visibility`: private or public;
- `description`: optional repository description;
- `confirm`: type `CREATE`.

The workflow creates the repository, copies the selected template, replaces placeholders, commits the generated code, and pushes it to `main`.

Factory stops there.

Deployment, hosting, runtime secrets, monitoring, failover, updates, and production operation are intentionally handled outside Discord-Bot-Factory.
