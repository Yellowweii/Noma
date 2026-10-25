# Noma

**English** | [简体中文](README.zh-CN.md)

Deploy Noma on a computer, NAS, or server at home and connect it to Home Assistant (HA) over your local network. View device states and control your lights and switches through conversations or device cards.

This guide walks you through your first deployment, HA connection, and device control.

## How it works

```text
Computer / phone browser → Noma at home
                             ├─ Internet → Noma Cloud: sign-in, conversation understanding, memory, and sessions
                             └─ Local network → Home Assistant → Smart home devices
```

Noma Cloud interprets your instructions, and the local backend performs device operations through HA over your local network. Your HA long-lived access token stays in the local backend. It is never sent to the cloud or returned to the browser after saving. Device information needed to understand conversations and tool execution results are exchanged through the cloud tool protocol.

An internet connection and a Noma cloud account are still required after deployment. The agent, models, memory, and subscriptions are provided by the cloud; you do not need to supply a model API key or deploy these services yourself.

**This guide currently covers access from the deployment machine and your home network.** Your phone can access Noma while connected to home Wi-Fi, but your home's local IP address is not directly accessible over mobile data when you are away. This version does not provide an out-of-the-box solution for access away from home. You do not need to configure FRPC / FRPS or an additional Connector for HA.

## Prerequisites

- A running HA instance with your target devices connected and working in the HA interface.
- A computer, NAS, or server that can keep Docker and Docker Compose running to host Noma.
- Network access from the deployment machine to both HA on your local network and Noma Cloud on the internet.
- A Noma cloud account.

The examples below use these two addresses. Replace them with your own:

| Device | Example address | Purpose |
| --- | --- | --- |
| Noma host | `192.168.1.50` | Address used by computers and phones to access Noma |
| Home Assistant | `192.168.1.100:8123` | HA address entered in Noma settings |

Both services can run on the same machine. Reserve local IP addresses for the Noma host and HA in your router to avoid connection failures when addresses change.

## 1. Start Noma

After downloading the project, run this command from the project root containing `compose.yaml`:

```bash
docker compose up -d --build
```

The first startup downloads images, installs dependencies, and builds the project. Wait for the services to start. Check their status and startup logs with:

```bash
docker compose ps
docker compose logs --tail=100
```

On the deployment machine, open [http://localhost:3100](http://localhost:3100) in a browser and sign in to your Noma cloud account. There is no need to create an `.env` file or generate an additional local access key.

By default, only the deployment machine can access Noma. Connect HA on that machine first, then follow step 5 to enable access from your phone over the local network.

## 2. Get an HA long-lived access token

1. Open your HA instance, for example `http://192.168.1.100:8123`, and sign in to your HA account.
2. Go to **Profile → Security → Long-lived access tokens**.
3. Select **Create token** and give it a name such as `Noma`.
4. Copy the entire generated token for the next step.

See the [official HA authentication documentation](https://developers.home-assistant.io/docs/auth_api/#long-lived-access-token) for token creation and storage details. HA does not retain a token's original value for later viewing. Keep it safe; if you lose it, revoke the old token and create a new one. Do not put the token in chats, screenshots, logs, or Git repositories.

## 3. Connect HA in Noma

After signing in to your local Noma instance:

1. Open **Settings → Home Assistant**.
2. Paste the token into the **Home Assistant long-lived access token** field.
3. Expand **Custom Home Assistant address** and enter an HA address reachable from the local backend, such as `http://192.168.1.100:8123`.
4. Select **Connect**. Once connected, the page shows the connection status and last connection time. You can also set a home name.

**Docker deployments usually need a different HA address from the default.** The default `http://localhost:8123` points to the Noma backend container itself, not automatically to the host or to HA on another device.

| HA location | Suggested address |
| --- | --- |
| Another device on the local network | `http://<HA local IP>:8123` |
| The same host as Noma | Prefer the host's local IP. You can also try `http://host.docker.internal:8123`, provided HA listens on an interface accessible from the container. |

If HA uses another port or HTTPS, enter its actual address. Include only the scheme, host, and port; do not append `/api`, page paths, usernames, passwords, or query parameters.

Connecting through the page authorizes all HA entities by default, including entities added later. Device control remains restricted by service and parameter allowlists. Connecting also enables device access for the current browser. Other browsers or household members must sign in and select **Connect** separately. Leave the token field empty to reuse the saved token.

Saved connection settings take effect immediately without a restart. The page submits the token once to the same-origin local backend; after saving, it does not retrieve or display the token.

## 4. Verify and control your devices

First, open the **Home** page and confirm that devices and their states appear. Room groups come from HA area assignments; devices without an area appear in a separate group.

Choose a light or switch whose state you can easily observe:

1. Toggle it once using its device card and confirm that the physical device changes state.
2. Open the conversation page and try “Check the living room light's status” or “Turn on the living room light.” Use the device names from your own HA instance.
3. Check that Noma's response, the page state, and the physical device state agree.

Currently supported operations:

| HA entity type | Available operations |
| --- | --- |
| Light `light` | Turn on/off; adjust brightness, RGB / RGBW / RGBWW, white light, and color temperature when supported by the device |
| Switch `switch` | Turn on/off |
| Input boolean `input_boolean` | Turn on/off |
| Other entities | Read states within the authorized scope; control is not currently supported |

The page shows controls according to each device's capabilities. The Home page mainly displays household devices and common environmental / security sensors. It filters out entities such as diagnostics, backups, and phone telemetry, and does not show supplementary readings such as power or battery level as separate device cards. These display rules do not modify HA entities or the authorization scope.

**A device control timeout means the outcome is unknown.** Check the physical device or its latest state in HA before deciding whether to try again. The local executor does not automatically retry write operations.

## 5. Allow access from phones or other computers at home

The default port mapping is `127.0.0.1:3100:3000`, which only allows access from the deployment machine. To allow other devices at home to connect, edit `ports` for the `noma-local` service in `compose.yaml`:

```yaml
ports:
  - "192.168.1.50:3100:3000"
```

Replace `192.168.1.50` with the deployment machine's actual local IP. Save the file, then run this command again from the project root:

```bash
docker compose up -d
```

Connect your phone to the same home network, open `http://192.168.1.50:3100` in its browser, sign in to Noma, and select **Connect** in the HA settings. **On a phone, `localhost` refers to the phone itself and cannot be used to access the deployment machine.**

If the page does not open, check whether the host firewall allows TCP 3100 from your home network and whether your phone is on a guest Wi-Fi network that isolates devices. The current entry point accepts only `localhost` or IP addresses, so use the deployment machine's IP address.

This instance is intended for trusted household members. Anyone who can reach the instance and sign in can enable access to its configured HA device scope. Do not expose this port directly to the public internet. HTTP on the local network transmits login information, the initial HA token submission, and conversations in plaintext. Local HTTPS is recommended for ongoing use. An HTTPS proxy must preserve the original Host header, and the backend configuration must set `secure_cookie: true`. Browser features such as microphone recording on phones also require a secure context; the current voice workflow has not yet completed end-to-end integration testing.

## Maintenance and persistent configuration

Both Noma and HA must stay running. If the deployment machine shuts down or sleeps, you cannot control devices through this instance.

```bash
# Stop services while keeping configuration and sign-in state
docker compose stop

# Start again
docker compose up -d

# Rebuild and start after updating the project code
docker compose up -d --build
```

Docker stores backend data in the `noma_local_data` named volume (the actual volume name usually includes a project prefix):

- `/data/local.json`: HA address, token, authorized entities, home name, and other settings.
- `/data/sessions/`: local sign-in sessions and cloud credentials.

Normal restarts preserve configuration and valid sessions. Sign-in sessions have a 30-day idle lifetime, renewed on use. Signing out revokes device access for the current browser. After signing in again, select **Connect** again; you do not need to re-enter the saved token. Changes to the HA address, token, or authorized entities also require other browsers to reconnect.

Do not delete the data volume unless you intend to configure the instance again. Protect backups of the entire volume because they contain sensitive credentials. Do not commit or publicly share configuration files, session directories, or backups.

### Optional: manually restrict accessible entities

Connecting through the page is usually sufficient. To restrict the entity scope, manually edit the local backend's `data/local.json`, which corresponds to `/data/local.json` in the Docker data volume. Keep the existing fields and merge the following example fields into the configuration:

```json
{
  "ha_url": "http://192.168.1.100:8123",
  "ha_token": "<your HA long-lived access token>",
  "allowed_entities": ["light.living_room", "switch.desk"]
}
```

Replace the example entity IDs with actual IDs from HA. `["*"]` authorizes all entities; `[]` authorizes none. After manual edits, run `docker compose restart noma-local` to apply them. **Selecting Connect on the page again restores access to all entities.**

Docker does not automatically read `data/local.json` from the project directory. If you prepare a file on the host, make sure it contains the complete configuration, then copy it into the container and restart:

```bash
docker compose cp data/local.json noma-local:/data/local.json
docker compose restart noma-local
```

Advanced configuration also supports `listen`, `cloud_url`, `web_url`, and `secure_cookie`. The default cloud endpoint is `https://noma-ai.cloud`. Compose already configures the container's internal listening address and frontend routing. To change local network access, adjust the port mapping.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| Noma does not open on the host | Confirm Docker is running. Check `docker compose ps` and `docker compose logs --tail=100`, and make sure another program is not using port 3100. |
| Noma opens, but HA will not connect | Check the HA address, port, token, and service status. In particular, do not treat `localhost` inside Docker as the host. The deployment machine or container must be able to reach the HA address. |
| Noma does not open on a phone | Change the port mapping as described in step 5 and use the host's IP. Check the firewall and guest network isolation. |
| Access stops working when the phone switches to mobile data | Local IP addresses are accessible only within your home network. This version does not provide a solution for access away from home. |
| Chat works, but device control does not | Select **Connect** under **Settings → Home Assistant** in the current browser, confirm authorization, and check whether the device type is supported. |
| An HA entity does not appear on the Home page | The page filters out some non-household entities and supplementary readings. Check the entity type and HA area assignment. |
| A control request times out | The operation may already have executed. Check the physical device's state before deciding whether to retry. |
| Sign-in or connection is required again after a restart | Check that the data volume was preserved. Expired cloud credentials require signing in again; device configuration changes or an explicit sign-out require reconnecting. |
| The Node image cannot be downloaded | Temporarily set `NOMA_DEV_NODE_IMAGE` to an available compatible Node image, then rebuild. |

## Developer notes

This project contains only the Web UI, a cloud account proxy, remote tool protocol adaptation, and a local-network HA executor. The interface reuses Noma's existing pages and interactions. Local adaptations focus on same-origin APIs, local sessions, and the HA connection.

The current Docker configuration uses development mode: the frontend runs `next dev`, while the backend watches source changes and restarts the gateway after successful compilation. Service restarts preserve configuration and valid sessions in the data volume.

Native development requires Go 1.25+ and Node.js 22.13+. Run the following in two separate terminals:

```bash
# Terminal 1: start the frontend
cd noma-web
npm ci
npm run dev
```

```bash
# Terminal 2: start the gateway from the project root
go run ./cmd/noma-local
```

Access the gateway at [http://localhost:3100](http://localhost:3100). Frontend development port 3001 is for the gateway; accessing it directly does not provide local API routing. The native backend reads `data/local.json` by default. The default HA address, `http://localhost:8123`, works directly only when HA and the backend share the same runtime environment.

All existing environment variables are optional. No `.env` file is required:

| Environment variable | Purpose |
| --- | --- |
| `NOMA_LOCAL_ADDR` | Override the backend listening address. The native default is `127.0.0.1:3100`; Compose sets the internal container listening address. |
| `NOMA_WEB_URL` | Override the frontend service address. Compose sets routing between services. |
| `NOMA_HA_URL` | Override the default HA address. An address explicitly saved in the configuration file or through the page takes precedence. |
| `NOMA_DEV_NODE_IMAGE` | Override the Node image used for the Docker frontend build. |

Regression checks:

```bash
go test ./...
go vet ./...
go build ./...
cd noma-web
npm test
npm run build
```

Automated tests do not send real verification codes or control real devices.
