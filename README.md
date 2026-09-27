# Discord Bot Factory

Discord-Bot-Factory creates new Discord bot repositories and seeds them with a starter codebase.

## Scope

Factory does:

- create a new GitHub repository;
- choose a starter type: persistent Node bot or Cloudflare Worker bot;
- copy the matching template into the new repository;
- replace template placeholders;
- make the initial commit and push it.

Factory does **not**:

- deploy the bot;
- start or stop the bot;
- host the bot;
- configure Cloudflare or Oracle;
- monitor uptime;
- restart crashed processes;
- manage production secrets;
- operate an existing bot after creation.

After the initial repository is created and scaffolded, responsibility moves to that bot's own repository and its own deployment/operations setup.

See [SETUP.md](docs/SETUP.md) for the one-time GitHub token setup.
