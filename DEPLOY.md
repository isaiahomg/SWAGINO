# SWAGINO — private shared server (DigitalOcean + Cloudflare)

Turns `swagino.html` into an always-on site at `https://swagino.<yourdomain>` that **only
people on your email allowlist** can open. One Tradier token you bake in on the server powers
everyone; your invitees need nothing of their own.

```
 visitor ─► Cloudflare (email login) ─► Tunnel (outbound-only) ─► cloudflared ─► proxy.py ─► Tradier
            Access allowlist            encrypted, no open port   same box       TOKEN here   markets only
```

**Why this is secure by design**
- The droplet publishes **no** web port to the internet — cloudflared dials *out* to Cloudflare, so there's nothing to port-scan. The only inbound port is SSH (and you'll lock even that).
- Every visitor must pass a **Cloudflare Access** email check before a single byte reaches the app.
- The proxy is **endpoint-allowlisted**: even though the shared Tradier token is full-access, the proxy only forwards read-only `/v1/markets/*` calls. Account access and order placement return **403** — a gated viewer physically cannot trade or read balances through it.
- The real token is injected **server-side** and never reaches any browser.

---

## Which window am I typing in?
Two kinds of commands below:
- **[PC]** — a terminal on **your own Windows computer** (open **Terminal** or **PowerShell**).
- **[droplet]** — a terminal **on the server**, i.e. after you've `ssh`-ed in (your prompt looks like `swagino@ubuntu:~$`).

`ssh` = open a command line that runs *on the server*, over an encrypted link. Windows 10/11 has it built in.

---

## Part A — Create and harden the DigitalOcean droplet

### A1. Create the droplet
1. Sign up at digitalocean.com → **Create → Droplets**.
2. **Choose an image:** Ubuntu 24.04 (LTS).
3. **Choose size:** Basic → Regular → the **$6/mo** option (1 GB RAM) is plenty.
4. **Authentication:** pick **SSH Key** if you can (most secure — the console walks you through
   adding one). If that's daunting, choose **Password** and set a strong root password; you can
   switch to keys later.
5. Create it. After ~30s you'll see the droplet's **public IP** (e.g. `203.0.113.45`). Copy it.

### A2. First login
**[PC]**
```bash
ssh root@YOUR_DROPLET_IP
```
Type `yes` to the fingerprint prompt; enter your password if you set one. You're now **[droplet]**.

### A3. Make a non-root user (don't run as root day to day)
**[droplet]**
```bash
adduser swagino          # set a password when asked
usermod -aG sudo swagino # give it admin (sudo) rights
rsync --archive --chown=swagino:swagino ~/.ssh /home/swagino   # copy your SSH key access over
```
Log out (`exit`) and back in as the new user:
**[PC]**
```bash
ssh swagino@YOUR_DROPLET_IP
```

### A4. Firewall — block everything except SSH
Because cloudflared dials outbound, the app needs **no** inbound web port. Lock it down.
**[droplet]**
```bash
sudo ufw allow OpenSSH
sudo ufw --force enable
sudo ufw status          # should show only OpenSSH (22) allowed
```

### A5. Automatic security updates + SSH brute-force protection
**[droplet]**
```bash
sudo apt update
sudo apt install -y unattended-upgrades fail2ban
sudo dpkg-reconfigure -f noninteractive unattended-upgrades
```

### A6. Install Docker
**[droplet]**
```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker swagino     # run docker without sudo
```
Log out and back in once more so the docker group takes effect:
**[PC]** `ssh swagino@YOUR_DROPLET_IP` → **[droplet]** `docker run --rm hello-world` (should print a success message).

---

## Part B — Put the app on the droplet

**Recommended: git** (makes future updates one command). If this folder is a git repo pushed to
GitHub/GitLab:
**[droplet]**
```bash
git clone YOUR_REPO_URL ~/swagino
cd ~/swagino
```

**Or, no git — copy from your PC** with the included script (see Part F) or manually:
**[PC]** (run in the project folder)
```bash
ssh swagino@YOUR_DROPLET_IP "mkdir -p ~/swagino"
scp proxy.py swagino.html Dockerfile docker-compose.yml .env.example c799f001526d973d5e323d94542fe589.ico swagino@YOUR_DROPLET_IP:~/swagino/
```

---

## Part C — Cloudflare: tunnel + email gate

### C1. Add your domain
In the Cloudflare dashboard → **Add a site** → enter your domain → follow the steps to point your
registrar's **nameservers** at Cloudflare. (Buy a domain first if you don't have one — Cloudflare
Registrar or any registrar works.)

### C2. Create the Tunnel
1. Open the **Zero Trust** dashboard (one.dash.cloudflare.com).
2. **Networks → Tunnels → Create a tunnel** → connector type **Cloudflared** → name it `swagino` → Save.
3. On the install screen, **copy the tunnel token** — the long string in the shown
   `cloudflared ... run <TOKEN>` command. You'll paste it into `.env` in Part D. (Ignore the OS
   install instructions; our docker-compose runs cloudflared for you.)
4. **Public Hostnames → Add a public hostname:**
   - **Subdomain:** `swagino`  **Domain:** `<yourdomain>`
   - **Type:** `HTTP`  **URL:** `swagino:8787`
     *(literally the word `swagino` — the compose service name cloudflared reaches over the internal network)*
   - Save.

### C3. Gate it with an email allowlist — **do this before sharing the link**
**Access → Applications → Add an application → Self-hosted:**
1. **Application name:** SWAGINO   **Application domain:** `swagino.<yourdomain>`
2. **Session duration:** pick e.g. 24 hours (how long before they must re-verify).
3. Add a **policy:** Action **Allow** → Include → **Emails** → list each invitee's address
   (or **Emails ending in** for a whole org domain).
4. Login methods: leave **One-time PIN** on → invitees just get a code by email; no account needed.
5. Save. Now the hostname is protected: no email match = no access.

*(Optional extra hardening: Access → Settings can enforce, and Cloudflare's SSL/TLS mode is
"Full/Flexible" automatically over the tunnel; HTTPS + HSTS are handled at the edge for you.)*

---

## Part D — Secrets and launch
**[droplet]**
```bash
cd ~/swagino
cp .env.example .env
nano .env        # paste TRADIER_TOKEN (production) and TUNNEL_TOKEN (from C2). Ctrl-O, Enter, Ctrl-X
docker compose up -d
docker compose logs -f     # watch both come up; cloudflared should report a registered connection
```

---

## Part E — Verify it's working AND locked down
**[droplet]**
```bash
# 1. App is healthy (no Tradier call, just the local /healthz):
docker compose ps                       # swagino should show "healthy"
curl -s localhost:8787/healthz          # -> ok   (only works from inside; port isn't public)

# 2. SECURITY SELF-TEST — market data allowed, account/trading blocked:
docker compose exec swagino python -c "import urllib.request as u; \
print('quotes  ', u.urlopen('http://127.0.0.1:8787/v1/markets/quotes?symbols=QQQ').status)" 2>&1 | tail -1
#   ^ expect 200 (or 401 if token wrong) — NOT 403
docker compose exec swagino sh -c "curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/v1/accounts/x/balances"
#   ^ expect 403  (accounts are blocked)
```
Then open **`https://swagino.<yourdomain>`** in a browser (ideally an allowlisted account and a
non-allowlisted one) — the allowlisted email gets a code and lands in SWAGINO; others are denied.

---

## Part F — Day-to-day

### Deploy an update (after you edit swagino.html locally and test at localhost)
**With git:** **[droplet]** `cd ~/swagino && git pull && docker compose up -d --build`

**Without git — one command from your PC:** create `deploy.local.ps1` once (see the top of
`deploy.ps1`), then **[PC]**:
```powershell
.\deploy.ps1
```
Users get the new version on their next refresh — the app's ETag revalidates, so no stale-cache
problem and no need to tell anyone to hard-refresh.

### Other operations — **[droplet]** in `~/swagino`
```bash
docker compose logs -f          # live logs (paths only; token is never logged)
docker compose restart          # restart after a .env change
docker compose down             # stop everything
```
- **Add / remove a viewer:** edit the emails in the Cloudflare Access policy (C3). Instant, no redeploy.
- **Rotate the Tradier token:** edit `TRADIER_TOKEN` in `.env` → `docker compose up -d`.

---

## Part G — Push-to-deploy with GitHub Actions (the recommended update flow)

With this set up, your update loop becomes: **edit `swagino.html` locally → test at localhost →
`git push` → the live server updates itself.** You also get version history and easy rollback.

> With Actions, the droplet's `~/swagino` is **not** a git clone — the Action copies files into it.
> So during first setup, just make the folder and put `.env` there; skip the `git clone` in Part B.

### G1. Create a private repo and push this project
**[PC]** in the project folder:
```bash
git init
git add .
git commit -m "SWAGINO"
```
On github.com → **New repository** → **Private** → create it (don't add a README). Then:
```bash
git branch -M main
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git push -u origin main
```
`.gitignore` already keeps `.env`, logs, and `deploy.local.ps1` out of the repo — verify your
`.env` is **not** listed when you run `git status` before that first commit.

### G2. Make a dedicated deploy key
This is a separate SSH key used *only* by GitHub to reach your droplet.
**[PC]**
```bash
ssh-keygen -t ed25519 -f deploy_key -N '""' -C "github-actions-swagino"
```
That makes two files: `deploy_key` (private) and `deploy_key.pub` (public). **Don't commit them.**

Install the **public** half on the droplet so it accepts that key:
**[PC]**
```bash
type deploy_key.pub | ssh swagino@YOUR_DROPLET_IP "cat >> ~/.ssh/authorized_keys"
```

### G3. Add the repo secrets
On GitHub → your repo → **Settings → Secrets and variables → Actions → New repository secret**.
Add:
- `DROPLET_HOST` = your droplet IP (e.g. `203.0.113.45`)
- `DROPLET_USER` = `swagino`
- `DEPLOY_SSH_KEY` = the **entire contents** of the private `deploy_key` file (open it in Notepad,
  copy everything including the `-----BEGIN...`/`-----END...` lines)
- *(recommended)* `DROPLET_KNOWN_HOSTS` = **[PC]** run `ssh-keyscan YOUR_DROPLET_IP` and paste its output

Now delete the local key files so they don't linger: **[PC]** `del deploy_key deploy_key.pub`
(the private key now lives only as a GitHub secret).

### G4. Deploy
Push any change (or use the **Actions** tab → **Deploy SWAGINO** → **Run workflow**):
```bash
git commit -am "tweak" && git push
```
Watch it under the repo's **Actions** tab. When it's green, the live site is updated — visitors
get the new version on their next refresh (ETag revalidates, no stale cache).

### Rollback
```bash
git revert HEAD      # undo the last change as a new commit
git push             # auto-deploys the reverted version
```
or `git checkout <older-commit> -- swagino.html && git commit -am "rollback" && git push`.

---

## Security checklist
- [ ] UFW enabled, only SSH inbound (Part A4)
- [ ] Logging in as a non-root sudo user; SSH keys ideally (A3)
- [ ] unattended-upgrades + fail2ban installed (A5)
- [ ] `.env` present only on the droplet, never committed (it's in `.gitignore`)
- [ ] Cloudflare Access policy created **before** the link was shared (C3)
- [ ] Security self-test passed: `/v1/accounts/*` returns 403 (Part E)
- [ ] Tradier token note below considered

**Tradier token note.** The proxy's allowlist prevents trading/account access even if the token
is full-access — that's the primary control. As defense in depth, prefer a Tradier token from an
account with **no funded trading ability** (e.g. a data-only / unfunded account) so a
hypothetical bypass still couldn't move money. And remember: serving live market data to others
under one account is a Tradier/exchange redistribution matter and everyone shares your rate
limit — keep the allowlist to trusted individuals.
