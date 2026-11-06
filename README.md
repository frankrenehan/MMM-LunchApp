# MMM-Lunch

A local, shared food planner for MagicMirror². Plan a two-week rotation with AM snack, lunch, and PM snack, then edit it from either parent's phone on home Wi-Fi. No Google account, cloud service, or runtime package dependencies.

## What it does

- Displays today's three meals, or tomorrow's after a configurable local-time cutoff.
- Hosts a phone-friendly editor at `/lunch/` on MagicMirror's existing server.
- Alternates weeks from a known Week 1 Monday. Holiday weeks continue the rotation.
- Supports full-day changes for a particular date, including no-school days.
- Writes the plan to `/persist`, keeps a previous-version backup, and reloads it after reboot without internet.
- Rejects stale saves if someone else has edited the plan. The second editor can download their unsaved draft before reloading.
- Downloads and imports JSON backups. Imports are drafts until Save is tapped.

## Try it on the Mac

Requires Node 22 or newer. No `npm install` is needed.

```sh
npm test
npm run dev
```

Open `http://127.0.0.1:8097/lunch/`. Preview data is written to ignored `.local/plan.json`; this is not Pi deployment or production data. Optional environment variables are `PORT` and `LUNCH_DATA_FILE` (an absolute path).

The initial plan is empty. In Settings, choose a title and a Monday that belongs to Week 1. Fill both weeks, then Save. Both parents use the same editor URL on the Pi. No maintenance mode or MagicMirror restart is needed for menu changes.

## Install on the Pi

Target: MagicMirror² 2.38+, Node 22+. Install the module as **MMM-Lunch**, even if this checkout has a different directory name.

With the root overlay disabled for maintenance:

```sh
cd ~/MagicMirror/modules
git clone https://github.com/frankrenehan/MMM-Lunch.git MMM-Lunch
```

The repository must first exist at that URL. Use an SSH clone instead for a private repo (see below).

Create a private persistent data directory owned by the account running MagicMirror:

```sh
mkdir -p /persist/magicmirror/lunch
chmod 700 /persist/magicmirror/lunch
```

Add this module to `~/MagicMirror/config/config.js` and remove or disable the old `MMM-GoogleSheets` block:

```js
{
  module: "MMM-Lunch",
  position: "top_left",
  header: "Food today",
  config: {
    dataFile: "/persist/magicmirror/lunch/plan.json"
  }
}
```

MagicMirror must allow your phones to reach its web server. Set its top-level `address` to the appropriate LAN interface (or `0.0.0.0`) and add your actual home subnet to `ipWhitelist`, preserving loopback entries. For example, **only if your home LAN is 192.168.10.x**:

```js
address: "0.0.0.0",
ipWhitelist: ["127.0.0.1", "::1", "::ffff:127.0.0.1", "192.168.10.0/24", "::ffff:192.168.10.0/120"],
```

Do not use an empty IP whitelist. The editor treats devices admitted by MagicMirror's network settings as trusted household editors; it has no account login. It checks request origins and a per-process token for writes, restricts hostnames to the Pi hostname/`.local`, localhost, IP addresses, or explicit `allowedHosts`, and serves meal text without HTML interpretation. It is intended for a trusted home LAN, not public internet hosting. If using a custom LAN hostname, add `allowedHosts: ["mirror.home"]` inside the module config. Behind a reverse proxy, origin/HTTPS handling needs separate configuration; direct LAN access is the supported setup.

```sh
cd ~/MagicMirror
npm run config:check
pm2 restart MagicMirror
pm2 logs MagicMirror --lines 50
```

Open `http://<mirror-ip>:8080/lunch/` on each phone. You can bookmark it or use the browser's Add to Home Screen option. It is a local web page, not a fully offline installed app: editing requires the mirror to be running and reachable over Wi-Fi. Internet is unnecessary. The mirror itself keeps selecting meals from disk when Wi-Fi is down.

Restore read-only overlay mode using your existing maintenance procedure. Confirm the plan survives a reboot before relying on it. Code updates (`git pull`) need maintenance mode; saves under `/persist` do not.

## Data and privacy

Default files:

```text
/persist/magicmirror/lunch/plan.json       current plan and rotation settings
/persist/magicmirror/lunch/plan.json.bak   previous saved version
```

The JSON file is the authoritative household data, not a disposable cache. Saves are serialized and use a temporary file, file sync, rename, and directory sync. Success is reported after that operation completes. Files are created with mode 600; new directories use mode 700. Exactly one process should own each plan file. Multiple instances in the same MagicMirror process share the plan.

A corrupt/unreadable existing file is never silently overwritten. The helper reports an error; inspect the logs and restore a verified backup while MagicMirror is stopped. A missing file starts an empty plan until the first save. A missing/dead `/persist` mount must be repaired before use; this application cannot verify the Pi's mount configuration from its file path.

Download backups occasionally to another device. The on-Pi `.bak` protects against the most recent unwanted edit, not loss of the storage device. Old dated changes remain in exports and can be removed by opening their date in the editor and choosing Use repeating menu. Up to 366 dated changes are supported.

Keep real menus, names, backup downloads, host-specific config, tokens, SSH keys, and the spreadsheet draft out of Git. This repo ignores `.local/`, `outputs/`, `.env` files, and common key files. On the Pi all household data lives outside the checkout. Public code does not make that local data public; anyone permitted to access the editor on the LAN can view/edit it and download a backup.

## Public or private GitHub repository

Either works. For a public generic module, HTTPS clone/pull needs no credentials. Menus and settings are created locally after installation.

For a private repository, use a dedicated **read-only deploy key** scoped to this repo, not an account-wide private SSH key. Because the root filesystem is overlaid, store the deploy key and SSH known-hosts file persistently, for example under `/persist/magicmirror/ssh/` (directory 700, private key 600). Add only its public key to GitHub's repository Deploy keys page, leaving write access disabled.

Use normal SSH host-key verification. A verified `known_hosts` entry must also survive reboot. With the key and known-hosts file already provisioned, an example clone is:

```sh
GIT_SSH_COMMAND='ssh -i /persist/magicmirror/ssh/lunch_deploy -o IdentitiesOnly=yes -o UserKnownHostsFile=/persist/magicmirror/ssh/known_hosts' \
  git clone git@github.com:frankrenehan/MMM-Lunch.git MMM-Lunch
```

Use the same SSH options for later pulls, or put a corresponding host entry in persistent SSH configuration. Never commit the private key. See [GitHub's deploy-key documentation](https://docs.github.com/en/enterprise-cloud%40latest/authentication/connecting-to-github-with-ssh/managing-deploy-keys).

## Rotation and display rules

- A weekday belongs to Week 1 or Week 2 by whole calendar weeks from `week1Monday`. This continues across DST and New Year and also handles dates before the anchor.
- All date/time decisions use the saved IANA timezone, default `America/New_York`, independently of the host timezone.
- Saturday and Sunday have no school by default. A dated change can explicitly provide meals on a weekend.
- Date changes replace all three meal slots for that date. Blank slots stay blank. Removing a change restores the regular menu.
- The default cutoff is `14:00`; after it, the mirror shows the **next calendar day**, including weekends. Turn the option off in Settings to always show today.
- A 15-second local timer updates the mirror at midnight and the cutoff, without polling a remote service. Open editors refresh every 30 seconds only while there are no unsaved changes or open date dialogs.

## Validation

```sh
npm test
```

Tests cover timezone and DST boundaries, two-week rotation, weekends, missing meals, date changes, failed saves, backup/restart persistence, concurrent edits, HTTP writes and origin checks, and the MagicMirror helper/display through small stubs. Real HTTP tests bind temporary loopback ports. The standalone preview uses the same routes, store, and selection logic as the module; deployment still needs an on-Pi check with the actual MagicMirror server and `/persist` mount.
