# bot-factory.json

Every Factory-managed bot repository has a `bot-factory.json` at its repository root.

The manifest has two responsibilities:

1. Tell Factory how the Worker is deployed.
2. Tell the management site what information and Discord-side configuration this specific bot requires.

The Cloudflare account is **not** hard-coded in the manifest. The operator selects it from the management site when deploying.

## Deployment fields

Recommended fields:

- `name`: Cloudflare Worker name.
- `runtime`: must be `worker`.
- `provider`: must be `cloudflare`.
- `working_directory`: directory containing the Worker project.
- `wrangler_config`: Wrangler configuration filename.
- `health_url`: optional URL checked after deployment.
- `d1_migrations`: optional D1 binding names whose migrations should be applied remotely.

Do not put a hard-coded `account_id` in Wrangler config for Factory-managed bots. The account selected in the site is exported to Wrangler as `CLOUDFLARE_ACCOUNT_ID`.

## Dynamic setup form

Use `setup.fields` to declare values the operator must enter before starting the bot.

Supported field types:

- `text`
- `secret`
- `number`
- `url`
- `select`
- `boolean`

Each field can contain:

- `key`: environment variable name passed to the Worker.
- `label`: label shown in the site.
- `type`: one of the supported types.
- `required`: default true.
- `placeholder`: optional.
- `help`: optional explanation.
- `pattern`: optional JavaScript regular-expression pattern.
- `options`: values for a `select` field.
- `runtime_env`: set false if the input is only a setup-time value and should not be passed as a Worker secret.

Example:

```json
{
  "setup": {
    "title": "Security BOT",
    "description": "Discord Security BOTの起動に必要な情報です。",
    "fields": [
      {
        "key": "DISCORD_BOT_TOKEN",
        "label": "Discord BOT Token",
        "type": "secret",
        "required": true,
        "help": "Discord Developer Portal > Bot から取得します。"
      },
      {
        "key": "DISCORD_APPLICATION_ID",
        "label": "Application ID",
        "type": "text",
        "required": true,
        "pattern": "^\\d{17,20}$"
      },
      {
        "key": "MAIN_BOT_APPLICATION_ID",
        "label": "Main BOT Application ID",
        "type": "text",
        "required": false
      }
    ]
  }
}
```

## Discord requirements

`setup.discord` controls the checklists shown under the form.

Available groups:

- `intents`: settings such as Server Members Intent or Message Content Intent.
- `permissions`: BOT permissions required in the Discord server.
- `checks`: any other manual setup that must be acknowledged.
- `notes`: informational notes that do not require a checkbox.

Each checklist item can contain:

- `id`: stable unique ID.
- `label`: text shown to the operator.
- `required`: default true.
- `description`: why the setting is required.
- `path`: where to enable/configure it.\n- `url`: optional direct link shown as 「設定画面を開く」.

Example:

```json
{
  "setup": {
    "discord": {
      "intents": [
        {
          "id": "server-members-intent",
          "label": "Server Members Intent",
          "required": true,
          "description": "入退室やメンバー状態を取得するために必要です。",
          "path": "Discord Developer Portal > Bot > Privileged Gateway Intents"
        }
      ],
      "permissions": [
        {
          "id": "manage-roles",
          "label": "ロールの管理",
          "required": true,
          "description": "認証ロールを付与するために必要です。"
        },
        {
          "id": "manage-channels",
          "label": "チャンネルの管理",
          "required": true,
          "description": "チャンネル権限を変更するために必要です。"
        }
      ],
      "checks": [
        {
          "id": "bot-role-order",
          "label": "BOTロールを操作対象ロールより上に配置",
          "required": true,
          "description": "Discordのロール階層制限を満たす必要があります。"
        }
      ],
      "notes": [
        "管理者権限を要求しないBOTでは、必要な個別権限だけを付与してください。"
      ]
    }
  }
}
```

The site will not enable **BOTを起動** until all required fields are filled and all required checklist items are checked.

## Complete example

```json
{
  "name": "discord-security",
  "runtime": "worker",
  "provider": "cloudflare",
  "working_directory": ".",
  "wrangler_config": "wrangler.jsonc",
  "d1_migrations": ["DB"],
  "health_url": "https://discord-security.example.workers.dev/health",
  "setup": {
    "title": "Discord Security",
    "description": "Security BOTを起動するための設定です。",
    "fields": [
      {
        "key": "DISCORD_BOT_TOKEN",
        "label": "BOT Token",
        "type": "secret",
        "required": true
      },
      {
        "key": "DISCORD_APPLICATION_ID",
        "label": "Application ID",
        "type": "text",
        "required": true,
        "pattern": "^\\d{17,20}$"
      }
    ],
    "discord": {
      "intents": [
        {
          "id": "members",
          "label": "Server Members Intent",
          "required": true,
          "path": "Developer Portal > Bot > Privileged Gateway Intents"
        }
      ],
      "permissions": [
        {
          "id": "manage-roles",
          "label": "ロールの管理",
          "required": true
        }
      ]
    }
  }
}
```
