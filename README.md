# Discord Bot Factory

Central deployment factory for Discord bots.

## Goals

- Keep deployment automation out of individual bot repositories.
- Deploy Worker-based bots to Cloudflare Workers.
- Deploy persistent Node/Docker bots to a shared Oracle Cloud Always Free host.
- Keep provider credentials in this repository only.
- Reuse infrastructure instead of repeating dashboard setup for every bot.
- Allow new bot repositories to be created from GitHub Actions when a suitable PAT is configured.

## Provider selection

`provider=auto`:

- Wrangler project -> Cloudflare
- Node/Docker project -> Oracle Cloud

Cloudflare-only APIs such as Durable Objects and D1 are not treated as portable to Oracle.

See [SETUP.md](docs/SETUP.md) for the one-time credential setup.
