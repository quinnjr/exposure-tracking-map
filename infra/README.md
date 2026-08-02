# Infrastructure

Pulumi program for `parkinsons.quinnjr.dev` — a fixed DigitalOcean droplet
running the app as a Docker container behind nginx, with TLS from Let's Encrypt.

## What it creates

| Resource | Why |
|---|---|
| `digitalocean.SshKey` | The account had no keys; the droplet needs one to be reachable at all. |
| `digitalocean.ReservedIp` | What makes the server *fixed* — the droplet can be rebuilt or resized without the DNS record changing. |
| `digitalocean.Droplet` | Ubuntu 24.04, `s-1vcpu-1gb`, `nyc3`. Weekly backups on, 2 GB swap. |
| `digitalocean.ReservedIpAssignment` | Binds the reserved IP to the droplet. |
| `digitalocean.Firewall` | Cloud firewall: 22/80/443 in, all out. |
| `digitalocean.DnsRecord` | The single `parkinsons` A record. |

### What it deliberately does NOT create

**The `quinnjr.dev` DNS zone.** The apex `A` records point at Cloudflare and
`www` is a `CNAME` to a DigitalOcean App Platform app — neither is managed by
Pulumi. The sibling `quinnjr-dev` stack, which shares this state bucket, owns a
managed database and that App, and no DNS resources at all.

This program therefore references the zone by name and adds one record to it.
It does **not** declare a `digitalocean.Domain`. That distinction is
load-bearing: declaring the domain would make this stack believe it owns the
zone, and a later `pulumi destroy` would take the apex and `www` down with it —
i.e. the whole of quinnjr.dev, to remove a subdomain.

**The database.** See below.

## State backend

State lives in the `quinnjr-pulumi` Space in `nyc3`, alongside the
`quinnjr-dev` stack but under its own project key, so the two never touch each
other's checkpoints.

```bash
export AWS_PROFILE=do-tor1     # the Spaces key, already configured locally
pulumi login 's3://quinnjr-pulumi?endpoint=nyc3.digitaloceanspaces.com&s3ForcePathStyle=true&region=us-east-1'
```

The profile is named `do-tor1` but its endpoint is `nyc3` — the name is
misleading, the endpoint is correct.

## Credentials

Three, none of which are stored in this repo:

```bash
export AWS_PROFILE=do-tor1                # Spaces key, for the state backend
export DIGITALOCEAN_TOKEN=...             # DO API token, for the provider
export PULUMI_CONFIG_PASSPHRASE=...       # stack secrets (same scheme as quinnjr-dev)
```

## Deploying

The image must exist in the registry before the droplet can pull it, so publish
first:

```bash
# From the repo root — pushes ghcr.io/quinnjr/exposure-tracking-map:latest
git push origin main          # or push a v* tag for a pinned release
```

On the **first publish only**, make the package public — GitHub creates new
packages private even for a public repo, and the droplet pulls anonymously:
<https://github.com/users/quinnjr/packages/container/exposure-tracking-map/settings>

Then:

```bash
cd infra
pulumi stack init production          # first time only
pulumi up
```

`pulumi up` prints the droplet's IP and the URL. Provisioning takes ~3 minutes;
the certificate arrives once DNS propagates (see *TLS* below).

## The database

**This is the one manual step, by choice.** `dev.db` is gitignored, holds the
1,840 ingested sites, and is not in the image. A freshly provisioned droplet
serves an empty map until you copy it up:

```bash
scp dev.db root@$(pulumi stack output publicIp):/srv/app/data/dev.db
ssh root@$(pulumi stack output publicIp) 'docker restart app'
```

The trade this accepts: **a droplet rebuild loses the database** and the site
serves empty results until you re-upload. Droplet backups are enabled as a
partial mitigation, but they are weekly, not continuous. If that becomes
annoying, storing `dev.db` in the same Spaces bucket and having `app-deploy`
fetch it on boot is a small change to `cloud-init.yaml`.

## Redeploying a new image

```bash
ssh root@$(pulumi stack output publicIp) app-deploy
```

Pulls the configured tag and restarts the container. No Pulumi run needed —
nothing in the infrastructure changed.

To pin a specific release instead of tracking `latest`:

```bash
pulumi config set image ghcr.io/quinnjr/exposure-tracking-map:v1.0.0
pulumi up
```

## TLS

`certbot --nginx` runs on first boot, but it can only succeed once the A record
resolves to the droplet — and Pulumi creates the record and the droplet in the
same update, so on a first run DNS is usually still propagating when the box
finishes booting.

So `app-tls.service` polls until `parkinsons.quinnjr.dev` resolves to the
droplet's own address, then requests the certificate. `app-tls.timer` retries
hourly. Until it succeeds the site serves plain HTTP rather than failing —
a healthy box should not look broken because DNS is slow.

Check on it with:

```bash
ssh root@$(pulumi stack output publicIp) 'journalctl -u app-tls --no-pager | tail -30'
```

## Useful outputs

```bash
pulumi stack output url                     # https://parkinsons.quinnjr.dev
pulumi stack output publicIp
pulumi stack output sshCommand
pulumi stack output redeployCommand
pulumi stack output uploadDatabaseCommand
```

## Cost

| Item | Monthly |
|---|---|
| Droplet `s-1vcpu-1gb` | $6.00 |
| Droplet backups (20%) | $1.20 |
| Reserved IP (while attached) | $0.00 |
| GHCR (public) | $0.00 |
| **Total** | **~$7.20** |

### Sizing

1 *shared* vCPU is DigitalOcean's floor — there is no fractional-CPU size, and
shared means a time slice rather than a dedicated core. RAM is what actually
binds this workload, so the tier is picked on memory rather than CPU.

1 GB is comfortable for steady state. Three guards remain, because the tight
moment is not steady state — it is a `docker pull` decompressing a ~260 MB image
while the app is still serving:

- **2 GB swap file** (`vm.swappiness=10`). Absorbs the deploy-time spike instead
  of the OOM killer picking the largest RSS, which is the app. Low swappiness
  keeps it a safety net rather than a routine path.
- **Container capped at 640 MB with `--max-old-space-size=448`.** Node sizes its
  default heap against *total host memory*, so without the cap it grows past
  what is actually free and takes nginx down with it. This leaves ~360 MB for
  nginx, dockerd and sshd.
- **Docker log rotation** (10 MB × 3). The default json-file driver is unbounded.

`pulumi config set size <slug> && pulumi up` resizes in place, and the reserved
IP means the address never changes.

A reserved IP is free while attached to a running droplet and billed only if
left dangling — so destroying the droplet but keeping the stack costs money.
