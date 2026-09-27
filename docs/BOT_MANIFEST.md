# bot-factory.json

`bot-factory.json` lives at the root of a bot repository and tells Discord-Bot-Factory exactly how to deploy it.

## Common fields

- `name`: deployment/container/Worker name.
- `runtime`: `worker` or `node`.
- `provider`: `cloudflare` or `oracle`.
- `working_directory`: directory containing the deployable app.

## Cloudflare fields

- `wrangler_config`: Wrangler config filename inside `working_directory`.
- `health_url`: optional URL checked after deploy.
- `d1_migrations`: optional array of D1 binding names whose Wrangler migrations should be applied remotely after deploy.

Example:

```json
{
  "name": "discord-security",
  "runtime": "worker",
  "provider": "cloudflare",
  "working_directory": ".",
  "wrangler_config": "wrangler.jsonc",
  "d1_migrations": ["DB"],
  "health_url": "https://discord-security.example.workers.dev/health"
}
```

## Oracle fields

- `start_command`: optional command override. If omitted, Factory uses the Dockerfile CMD or, for an auto-generated Node Dockerfile, `npm start`.

Example:

```json
{
  "name": "discord-ticket",
  "runtime": "node",
  "provider": "oracle",
  "working_directory": ".",
  "start_command": "npm start"
}
```

## Auto-detection

If this file is absent:

- exactly one Wrangler project resolves to Cloudflare Worker;
- exactly one Node/Docker project resolves to Oracle;
- ambiguous monorepos fail and require a manifest.

The failure-on-ambiguity behavior is intentional so Factory does not deploy the wrong application by guessing.
