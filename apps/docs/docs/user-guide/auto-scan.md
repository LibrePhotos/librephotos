---
title: "🤖 Auto scan all folders"
excerpt: "How to auto scan all folders"
sidebar_position: 2
---

## Auto scan all folders

You can start a scan with the following command:

```
sudo docker exec --user root CONTAINER_NAME python3 manage.py scan
```

You can just create a cron job to regularly call this command

```
# Every day at 3 AM
0 3 * * * sudo docker exec --user root CONTAINER_NAME python3 manage.py scan >/dev/null 2>&1
```
