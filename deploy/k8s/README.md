# Kubernetes Installation

These manifests run the same backend, proxy and frontend containers as the Docker Compose stack in `deploy/compose`:
the backend with the nginx proxy next to it in one Pod, and the frontend. PostgreSQL is pinned to 16; the Compose stack
uses pgautoupgrade, which follows the newest major. All of it runs in the `librephotos` namespace. The Ingress sends
your hostname to the proxy.

1. Clone this repo, check out the latest release and change to this directory:
    ```
    git clone https://github.com/LibrePhotos/librephotos.git
    cd librephotos
    git checkout <tag>
    cd deploy/k8s
    ```
    Replace `<tag>` with the newest release on the [releases page](https://github.com/LibrePhotos/librephotos/releases).
    The `images` section of `kustomization.yaml` in a release names the images of that release. On `dev` it can
    name a release that is not published yet.
1. Consider changing the sizes of the volumes in `pvcs.yaml`.
1. Edit the hostnames in `ingress.yaml`, and set `ingressClassName` to the class of your ingress controller, for
    example Traefik, HAProxy or the one your cloud provider installs. The default, `nginx`, is ingress-nginx, which
    Kubernetes retired in March 2026. On a cluster that uses the Gateway API instead, replace the Ingress with an
    HTTPRoute to the `proxy` Service on port 80. Consider installing [cert-manager](https://cert-manager.io/) and
    uncommenting the relevant portions of `ingress.yaml`.
1. Edit the values in `config/backend.env` to suit your configuration. Set `FRONTEND_BASE_URL` and
    `CSRF_TRUSTED_ORIGINS` to the address from `ingress.yaml`, for example `https://photos.example.com`.
1. Install these manifests to your cluster with `kubectl apply -k .`.
1. Create a secret for PostgreSQL authentication.
    ```
    kubectl create secret generic database -n librephotos --from-literal=DB_PASS=$(openssl rand -hex 16) --from-literal=DB_USER=librephotos
    ```
1. Create a secret for the backend's key and the admin password.
    ```
    kubectl create secret generic backend -n librephotos --from-literal=SECRET_KEY=$(openssl rand -hex 32) --from-literal=ADMIN_PASSWORD=$password
    ```
    Substitute a value for `$password` and remember it so you can log in. Keep `SECRET_KEY` once it is set: it signs
    the logins and encrypts the stored email and Nextcloud passwords. Without it the backend generates a key in
    `/logs`, which is an `emptyDir` here and does not survive the Pod. The default geocoding provider, Nominatim,
    needs no API key; if you switch to one that does, enter its key in the site settings.

The Pods wait in `CreateContainerConfigError` until both secrets exist, then start by themselves. You can watch them
get ready with `kubectl get pod -n librephotos -w`. The backend may restart once or twice while PostgreSQL sets up its
new volume, because it stops when it cannot migrate the database. Its first real start runs all database migrations
and takes a few minutes. Once they're all running, you can test the installation by port-forwarding the proxy service
```
kubectl -n librephotos port-forward svc/proxy 55555:80
```
Then open `http://localhost:55555` in your browser and log in as `admin`.

The backend's log is in `kubectl -n librephotos logs deployment/backend -c backend`.

# Health probes

The backend exposes four unauthenticated endpoints. They live under `/api/` because the proxy only forwards
`/api/` and `/media/` to the backend.

| Endpoint | Meaning |
| --- | --- |
| `/api/healthz` | The process is up. Never touches the database, so a database outage does not get the pod killed. Used as the startup and liveness probes. |
| `/api/healthz/postgresql` | PostgreSQL answers a trivial query. |
| `/api/healthz/queue` | The django-q2 broker is reachable. |
| `/api/healthz/ready` | Both of the above are healthy. Used as the readiness probe. |

Unhealthy checks answer `503`. Note that the probes in `backend.yaml` override the `Host` header, because kubelet
otherwise sends the Pod IP, which is not in the backend's `ALLOWED_HOSTS`.

These endpoints exist since 1.1.0. An older backend image fails every probe and kubelet restarts it in a loop, so do
not run anything older than 1.1.0 with these manifests.

The backend runs migrations and starts its services before it serves anything, so the startup probe allows ten
minutes for the first request to succeed; raise its `failureThreshold` if your host is slower than that. Keep the
Deployment's `progressDeadlineSeconds` above the time the probe then allows plus the image pull, or
`kubectl rollout status` reports the rollout as failed while the backend is still starting. The readiness probe is
deliberately slow to give up, because the proxy container that serves the frontend shares the backend's Pod: marking
the backend NotReady also removes the frontend from the `proxy` Service.

# Upgrading

The image tags in `kustomization.yaml` are pinned and never move by themselves. Renovate is disabled for `deploy/k8s`
on purpose (see `renovate.json`), because a new PostgreSQL major cannot start on an existing database volume. The
maintainers bump the tags by hand for each release, and a check on each release fails when they do not name it. So
you upgrade by checking out the new release, not by tracking `dev`.

Check the sections below before you start. The manifests before 1.3.0 pinned 2023w31 and PostgreSQL 13, so an install
that still runs those images needs all three, in order. Otherwise:

1. Back up the database:
    ```
    kubectl -n librephotos exec deployment/postgres -- pg_dump -U librephotos librephotos > librephotos-backup.sql
    ```
    Replace the `librephotos` after `-U` with your `DB_USER` if you changed it, here and in the commands below.
1. Check out the new release with `git fetch --tags` and `git checkout <tag>`, since the manifests change along with
    the images. If you edited them, run `git stash` before the checkout and `git stash pop` after it.
1. Run `kubectl apply -k .` again and follow the rollout with `kubectl -n librephotos rollout status deployment/backend`.

Since 1.3.0, `pvcs.yaml` asks for 20Gi instead of 3Gi for the `protected` volume, because it also holds the machine
learning models and the cache of converted videos. `kubectl apply` then tries to grow an existing volume, which only
works if its StorageClass allows volume expansion. If it does not, or if your volume is already bigger, put the size
your volume has back into `pvcs.yaml`.

## From PostgreSQL 13

Current releases run on Django 5.2, which refuses PostgreSQL older than 14, and PostgreSQL 16 does not start on a
data directory written by 13. Move the data with a dump and restore. `pg_upgrade` works too, but it needs
the binaries of both majors in one container (the Compose stack uses the pgautoupgrade image for that).

Start while the old manifests are still applied, so PostgreSQL 13 is still running. If you already applied the new
ones, PostgreSQL 16 refuses to start on the old volume and changes nothing: set its tag in `kustomization.yaml` back
to `"13"`, apply, and start here.

```
# Stop the backend, so nothing writes to the database during the dump
kubectl -n librephotos scale deployment/backend --replicas=0

# Dump the database, and check that the dump is complete: grep must print a line.
kubectl -n librephotos exec deployment/postgres -- pg_dump -U librephotos librephotos > librephotos-backup.sql
grep "PostgreSQL database dump complete" librephotos-backup.sql

# Note the size of the old volume and of the dump, for the new volume.
kubectl -n librephotos get pvc postgres -o jsonpath='{.status.capacity.storage}'
ls -lh librephotos-backup.sql

# Remove the PostgreSQL 13 data. Keep the dump safe: depending on the reclaim policy
# of your StorageClass, this deletes the volume.
kubectl -n librephotos delete deployment/postgres
kubectl -n librephotos delete pvc/postgres
```

Then check out the new release as in the steps above. The new volume is created from `pvcs.yaml`, which asks for
1Gi, so set the `postgres` request there to at least the size of the old volume, and to at least two or three times
the size of the dump: the restored tables, their indexes and the write-ahead log of the restore all need room. A
restore that runs out of space stops partway. The dump is unaffected, so delete the Deployment and the volume again
and retry with a larger one.

If you come from 2023w31 or any other release older than 2026w10, also set the images to `1.1.0` and raise the
startup probe's limits now, as described in [From a release older than 2026w10](#from-a-release-older-than-2026w10),
so the backend you scale up at the end is the 1.1.0 one.

Then apply the manifests. PostgreSQL 16 starts on a new, empty volume. The backend stays at zero replicas, because the
manifests do not set a replica count.

```
kubectl apply -k .
kubectl -n librephotos rollout status deployment/postgres

# Restore the dump, then start the backend
kubectl -n librephotos exec -i deployment/postgres -- psql -U librephotos -d librephotos -v ON_ERROR_STOP=1 < librephotos-backup.sql
kubectl -n librephotos scale deployment/backend --replicas=1
```

## From a release older than 2026w10

Releases after 1.1.0 cannot bring a database from before 2026w10 up to date on their own. The backend then stops
before it migrates and changes nothing, and its log names the release to go through first (`librephotos.E001`).
Upgrade in two steps, as described in
[Upgrading from a release older than 2026w10](https://docs.librephotos.com/docs/installation/upgrading#old-releases):

1. Set the three LibrePhotos images to `1.1.0` and apply. Use 1.1.0 itself rather than an earlier release from
    2026w10 on: it is the first one with the endpoints the probes call. Migrating a large library from an old release
    can take longer than the ten minutes the startup probe allows, so for this step raise the startup probe's
    `failureThreshold` in `backend.yaml`, for example to `360` for an hour, and the Deployment's
    `progressDeadlineSeconds` above that, for example to `4200`. Wait until
    `kubectl -n librephotos rollout status deployment/backend` reports the rollout as complete;
    `kubectl -n librephotos logs -f deployment/backend -c backend` shows the migration in the meantime.
1. Set the images back to the release you checked out, the `failureThreshold` back to `60` and
    `progressDeadlineSeconds` back to `1200`, then apply again.

When you also come from PostgreSQL 13, move the database first, with the images already set to `1.1.0` as described
in [From PostgreSQL 13](#from-postgresql-13). Then wait for the 1.1.0 rollout as in the first step, and continue with
the second.

Not sure which release you are on? A backend image tagged 1.2.0 or newer can always upgrade directly. Otherwise ask the
backend you are running now:

```
kubectl -n librephotos exec deployment/backend -c backend -- python manage.py showmigrations api | grep -E '0100_|squashed_0100'
```

If this prints `[X]` (or `[-]`) in front of `0100_metadataedit_metadatafile_photometadata_stackreview_and_more` or
of `0001_squashed_0100`, your database is recent enough to upgrade directly. If it prints `[ ]` in front of
`0100_metadataedit_...`, or nothing at all, use the two steps.

## After upgrading from 1.2.1 or older

Thumbnails made by 1.2.1 and older still carry the photo's EXIF and XMP, including its GPS position. Run the cleanup
once after the upgrade, as described in
[After upgrading from 1.2.1 or older](https://docs.librephotos.com/docs/installation/upgrading#strip-thumbnail-metadata):

```
kubectl -n librephotos exec deployment/backend -c backend -- python manage.py strip_thumbnail_metadata
```
