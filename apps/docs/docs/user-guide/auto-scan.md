---
title: "🤖 Auto scan all folders"
description: "How to auto scan all folders"
sidebar_position: 11
---

## Auto scan all folders

You can start a scan with the following command:

```
sudo docker exec --user root backend python3 manage.py scan
```

`backend` is the default container name set by `container_name:` in `docker-compose.yml`; substitute your own if you changed it (see [Changing the container names](../installation/environment-variables.md#changing-the-container-names)).

The plain `scan` command is incremental — it only picks up files that are new or that were modified since the last finished scan. Use `scan -f` to force a full re-process of every file, or `scan -s /path/a.jpg /path/b.jpg` to scan specific files. See [Management Commands](./library.md#management-commands) for the full list.

:::note Nextcloud users
`manage.py scan` only scans the local scan directory. To scan a connected [Nextcloud library](./library.md#nextcloud-integration) from the command line, run `manage.py scan -n` — cron it separately.
:::

You can just create a cron job to regularly call this command

```
# Every day at 3 AM
0 3 * * * sudo docker exec --user root backend python3 manage.py scan >/dev/null 2>&1
```
