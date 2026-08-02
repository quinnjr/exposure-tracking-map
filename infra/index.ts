import * as digitalocean from '@pulumi/digitalocean';
import * as pulumi from '@pulumi/pulumi';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const config = new pulumi.Config();

const domain = config.get('domain') ?? 'quinnjr.dev';
const subdomain = config.get('subdomain') ?? 'parkinsons';
const region = config.get('region') ?? 'nyc3';
const size = config.get('size') ?? 's-1vcpu-512mb-10gb';
const image = config.get('image') ?? 'ghcr.io/quinnjr/exposure-tracking-map:latest';
const letsencryptEmail = config.get('letsencryptEmail') ?? 'quinn.josephr@gmail.com';
const sshPublicKeyPath = config.get('sshPublicKeyPath') ?? '~/.ssh/id_ed25519.pub';

const fqdn = `${subdomain}.${domain}`;

/** The account had no SSH keys; without one the droplet is unreachable. */
const sshKey = new digitalocean.SshKey('deploy-key', {
  name: `${fqdn} deploy key`,
  publicKey: readFileSync(
    sshPublicKeyPath.startsWith('~') ? resolve(homedir(), sshPublicKeyPath.slice(2)) : sshPublicKeyPath,
    'utf8'
  ).trim()
});

/**
 * A reserved IP is what makes this a *fixed* web server: the droplet can be
 * rebuilt, resized, or replaced entirely and the address the DNS record points
 * at does not change, so there is no propagation gap on a rebuild. It also means
 * the A record below is written once and never churns.
 */
const ip = new digitalocean.ReservedIp('public-ip', { region });

const cloudInit = readFileSync(resolve(__dirname, 'cloud-init.yaml'), 'utf8')
  .replaceAll('${FQDN}', fqdn)
  .replaceAll('${IMAGE}', image)
  .replaceAll('${EMAIL}', letsencryptEmail);

const droplet = new digitalocean.Droplet('web', {
  name: `${subdomain}-web`,
  image: 'ubuntu-24-04-x64',
  region,
  size,
  sshKeys: [sshKey.fingerprint],
  userData: cloudInit,
  monitoring: true,
  // Weekly automatic backups. This is the only thing standing between a
  // fat-fingered `rm` and re-running a two-hour EPA scrape, because the
  // database is copied up by hand rather than restored from object storage.
  backups: true,
  tags: ['exposure-tracking-map', 'web']
});

new digitalocean.ReservedIpAssignment('public-ip-assignment', {
  ipAddress: ip.ipAddress,
  dropletId: droplet.id.apply(Number)
});

/**
 * Cloud firewall, in front of the droplet's own ufw rules. Both exist because
 * they fail differently: this one survives anything that happens inside the
 * box, and ufw survives a misconfiguration of this one.
 */
new digitalocean.Firewall('web-firewall', {
  name: `${subdomain}-web`,
  dropletIds: [droplet.id.apply(Number)],
  inboundRules: [
    { protocol: 'tcp', portRange: '22', sourceAddresses: ['0.0.0.0/0', '::/0'] },
    { protocol: 'tcp', portRange: '80', sourceAddresses: ['0.0.0.0/0', '::/0'] },
    { protocol: 'tcp', portRange: '443', sourceAddresses: ['0.0.0.0/0', '::/0'] }
  ],
  outboundRules: [
    // Egress is open because the box must reach GHCR, Let's Encrypt, the Ubuntu
    // and Docker apt mirrors, and — if the ingest is ever run on it — the EPA
    // and Census APIs.
    { protocol: 'tcp', portRange: '1-65535', destinationAddresses: ['0.0.0.0/0', '::/0'] },
    { protocol: 'udp', portRange: '1-65535', destinationAddresses: ['0.0.0.0/0', '::/0'] },
    { protocol: 'icmp', destinationAddresses: ['0.0.0.0/0', '::/0'] }
  ]
});

/**
 * The DNS zone for quinnjr.dev is NOT managed by Pulumi — its apex A records
 * point at Cloudflare and `www` is a CNAME to an App Platform app, both created
 * outside any stack. The sibling `quinnjr-dev` stack in this same Spaces bucket
 * owns a managed database and that App, and no DNS resources at all.
 *
 * So this stack adds exactly one record and adopts nothing. Referencing the
 * zone by name rather than declaring a `digitalocean.Domain` is the load-bearing
 * part: declaring the domain would make this stack believe it owns the zone,
 * and a later `pulumi destroy` would take the apex and `www` down with it.
 */
const record = new digitalocean.DnsRecord('a-record', {
  domain,
  type: 'A',
  name: subdomain,
  value: ip.ipAddress,
  // Short while the deployment is young, so a droplet swap propagates quickly.
  // Worth raising once the address settles.
  ttl: 300
});

export const url = pulumi.interpolate`https://${record.fqdn}`;
export const publicIp = ip.ipAddress;
export const dropletName = droplet.name;
export const sshCommand = pulumi.interpolate`ssh root@${ip.ipAddress}`;
export const redeployCommand = pulumi.interpolate`ssh root@${ip.ipAddress} app-deploy`;
export const uploadDatabaseCommand = pulumi.interpolate`scp dev.db root@${ip.ipAddress}:/srv/app/data/dev.db`;
