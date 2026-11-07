# Put sloptube on the internet

This guide takes you from nothing to sloptube running on your own domain.
It takes about 20 minutes. You need:

- a [Hetzner Cloud](https://console.hetzner.cloud/) account
- a domain that uses [Cloudflare](https://dash.cloudflare.com/) for DNS
- the Supabase publishable key from the [API keys page](https://supabase.com/dashboard/project/_/settings/api-keys)

How it works once it is set up: you push `main` to the `release` branch, GitHub builds a
Docker image, and the server checks for a new image every 5 minutes and switches to it
without downtime.

---

## 1. Create the server

1. Open the [Hetzner Cloud console](https://console.hetzner.cloud/) and pick (or create) a project.
2. Click **Add Server**.
3. Location: **Helsinki**.
4. Image: **Ubuntu 24.04**.
5. Type: **CX23** (shared vCPU, x86).
6. SSH key: add your public key. If you do not have one yet, follow
   [GitHub's guide to creating an SSH key](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/generating-a-new-ssh-key-and-adding-it-to-the-ssh-agent).
7. Click **Create & Buy now** and copy the server's **IPv4 address**.

Hetzner docs: [Creating a server](https://docs.hetzner.com/cloud/servers/getting-started/creating-a-server/)

## 2. Point your domain at the server

1. Open [Cloudflare](https://dash.cloudflare.com/), pick your domain, then **DNS** and **Records**.
2. Click **Add record**:
   - Type: **A**
   - Name: `@` for the bare domain, or a subdomain like `tube`
   - IPv4 address: the server IP from step 1
   - Proxy status: **Proxied** (orange cloud on)
3. Save.
4. Go to **SSL/TLS** and **Overview**, and set the encryption mode to **Full**.

Cloudflare docs: [Create DNS records](https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-dns-records/),
[SSL modes](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full/)

## 3. Log in to the server

Replace `YOUR_SERVER_IP` with the address from step 1:

```bash
ssh root@YOUR_SERVER_IP
```

Type `yes` if it asks about the fingerprint.

## 4. Create the settings file

Make the folder:

```bash
mkdir -p /opt/sloptube
```

Open the settings file in an editor:

```bash
nano /opt/sloptube/.env
```

Paste this, and change the domain and key to yours:

```bash
DOMAIN=tube.example.com
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key_here
```

Optional: add `FLAGS_PAGE=1` on its own line to show the read only `/flags` page
in production.

Optional: `SITE_URL=https://tube.example.com` (your domain) for canonical links,
share cards and `/sitemap.xml`. Without it the address the browser asked for is
used. See [`docs/launch.md`](../../docs/launch.md) for the whole launch checklist.

For uploads, also add the four R2 lines (names only here, your values after the
`=`). See "Uploads (R2)" in the main README for the bucket, token and CORS rule:

```bash
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
```

Optional: `MEDIA_PUBLIC_URL=https://media.example.com` (your bucket's public
domain) makes the player load videos straight from there instead of through
`/api/media`. Read "Watch page" in the main README before you turn it on.

Optional, for Sign in with Yapin' (feature 16): the Yapin' app's id and secret
and the Supabase secret key. Read [Yapin' in the launch guide](../../docs/launch.md#yapin)
first: the secret key can do anything in the database, so only add it if you
switch Sign in with Yapin' on.

```bash
YAPIN_CLIENT_ID=
YAPIN_CLIENT_SECRET=
SUPABASE_SERVICE_ROLE_KEY=
```

Save with `Ctrl+O`, `Enter`, then quit with `Ctrl+X`.

Sign in needs one more setting in Supabase: add `https://tube.example.com/auth/callback`
(your domain) to the redirect URLs. See [Accounts](../../docs/features.md#accounts) in the feature docs.

## 5. Let the server download the image

The image lives in the GitHub Container Registry. Pick **one** of these:

**Option A (simplest): make the package public.** After the first build (step 7) open
[the package settings](https://github.com/users/myfilehero/packages/container/sloptube/settings)
(for an organization: `https://github.com/orgs/myfilehero/packages/container/sloptube/settings`),
scroll to **Danger Zone**, and change visibility to **Public**. Nothing to do on the server.

**Option B: log the server in.** Create a
[classic personal access token](https://github.com/settings/tokens/new?scopes=read:packages&description=sloptube%20server)
with only the `read:packages` scope, then run this on the server and paste the token when it asks for a password:

```bash
docker login ghcr.io -u YOUR_GITHUB_USERNAME
```

(Docker is installed in step 6, so run this command after step 6 if you pick option B.)

## 6. Run the installer

Open the installer in an editor on the server:

```bash
nano /root/install.sh
```

Paste the whole contents of
[`ops/app/install.sh`](https://github.com/myfilehero/sloptube/blob/main/ops/app/install.sh)
(on GitHub, click **Copy raw file**), save with `Ctrl+O`, `Enter`, and quit with `Ctrl+X`.

Run it:

```bash
bash /root/install.sh
```

It installs Docker and Caddy, sets up the web server for your domain, and installs the
automatic updater. It is fine to run it again later.

If you already have the repo on your own computer, you can copy the file instead of pasting it:

```bash
scp ops/app/install.sh root@YOUR_SERVER_IP:/root/install.sh
```

## 7. Ship it

On your own computer, in the sloptube repo:

```bash
git push origin main:release
```

Watch the build on the [Actions tab](https://github.com/myfilehero/sloptube/actions).
When it is green, wait up to 5 minutes and open your domain.

---

## Day to day

Ship a new version:

```bash
git push origin main:release
```

See what the updater did (on the server):

```bash
tail -n 50 /var/log/sloptube-update.log
```

Run an update right now instead of waiting:

```bash
systemctl start sloptube-update
```

Check which version is live (on your computer):

```bash
curl https://tube.example.com/api/version
```

Change a setting: edit `/opt/sloptube/.env`, then restart the running copy:

```bash
nano /opt/sloptube/.env
```

```bash
cd /opt/sloptube && PORT=$([ "$(cat active)" = green ] && echo 3001 || echo 3000) docker compose -p sloptube-$(cat active) up -d --force-recreate
```

## How the updater works

Every 5 minutes `sloptube-update` pulls `ghcr.io/myfilehero/sloptube:latest`. If the image
changed, it starts the new version next to the old one (blue on port 3000, green on 3001),
waits until `/api/health` answers, points Caddy at the new one, and stops the old one.
If the new version never gets healthy, the old one keeps serving and the log says why.

Files on the server:

| Path | What it is |
| --- | --- |
| `/opt/sloptube/.env` | Your settings |
| `/opt/sloptube/docker-compose.yml` | How the container runs |
| `/opt/sloptube/active` | Which color is live (`blue` or `green`) |
| `/etc/caddy/Caddyfile` | Web server config for your domain |
| `/etc/caddy/sloptube-upstream.caddy` | Which port Caddy sends traffic to |
| `/usr/local/bin/sloptube-update` | The updater |
| `/var/log/sloptube-update.log` | The updater's log |
