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

## Part B — Put the app on the droplet (git)

This project's live deployment method is: the droplet holds a **git clone** of your repo, and
an update is `git pull` + rebuild (Part F). That means the code has to reach GitHub first.

### B1. Create a private repo and push this project
**[PC]** in the project folder:
```bash
git init                    # skip if this folder is already a git repo
git add .
git commit -m "SWAGINO"
```
On github.com → **New repository** → **Private** → create it (don't add a README, so the push
below isn't rejected for unrelated history). Then:
```bash
git branch -M main
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git push -u origin main
```
Before that first commit, run `git status` and confirm **`.env`** is not listed — `.gitignore`
keeps it out, but it's worth a look since it holds your Tradier token.

### B2. Clone it onto the droplet
**[droplet]**
```bash
git clone https://github.com/YOUR_USER/YOUR_REPO.git ~/swagino
cd ~/swagino
```
A **private** repo will prompt for credentials on clone/pull — use a GitHub
[personal access token](https://github.com/settings/tokens) as the password (GitHub no longer
accepts account passwords over HTTPS git), or clone over SSH with a deploy key if you'd rather
not type a token each time.

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

### Deploy an update
After you edit `swagino.html` (or `proxy.py`, `Dockerfile`, etc.) locally and test at
`localhost:8787`:

**[PC]**
```bash
git add -A
git commit -m "describe the change"
git push
```

**[droplet]**
```bash
cd ~/swagino && git pull && docker compose up -d --build
```
Users get the new version on their next refresh — the app's ETag revalidates, so no stale-cache
problem and no need to tell anyone to hard-refresh.

### Rollback
**[PC]**
```bash
git revert HEAD      # undoes the last commit as a new commit (keeps history honest)
git push
```
**[droplet]**
```bash
cd ~/swagino && git pull && docker compose up -d --build
```
For an older commit specifically: `git checkout <commit> -- swagino.html && git commit -m "rollback" && git push`, then pull + rebuild on the droplet the same way.

### Other operations — **[droplet]** in `~/swagino`
```bash
docker compose logs -f          # live logs (paths only; token is never logged)
docker compose restart          # restart after a .env change
docker compose down             # stop everything
```
- **Add / remove a viewer:** edit the emails in the Cloudflare Access policy (C3). Instant, no redeploy.
- **Rotate the Tradier token:** edit `TRADIER_TOKEN` in `.env` → `docker compose up -d`.

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
