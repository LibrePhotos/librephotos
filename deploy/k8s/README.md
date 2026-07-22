# Kubernetes Installation

1. Clone this repo and change to this directory.
1. Check the values in `kustomization.yaml`, in the `images` section, to make sure they're pointing to the latest
    release.
1. Consider changing the sizes of the volumes in `pvcs.yaml`.
1. Edit the hostnames in `ingress.yaml`. Consider installing [cert-manager](https://cert-manager.io/) and uncommenting
    the relevant portions of `ingress.yaml`.
1. Edit the values in `config/backend.env` to suit your configuration.
1. Install these manifests to your cluster with `kubectl apply -k .`.
1. Create a secret for PostgreSQL authentication.
    ```
    kubectl create secret generic database -n librephotos --from-literal=DB_PASS=$(openssl rand -hex 16) --from-literal=DB_USER=librephotos
    ```
1. Create a secret for the backend's key, admin password, and optional MapBox API key.
    ```
    kubectl create secret generic backend -n librephotos --from-literal=SECRET_KEY=$key --from-literal=ADMIN_PASSWORD=$password --from-literal=MAPBOX_API_KEY=$apikey
    ```
    Substitute values for `$key`, `$password`, and `$apikey`. Make sure you remember the `$password` so you can log in.

If you want, you can watch the Pods get ready with `kubectl get pod -n librephotos -w`. 
Once they're all running, you can test the installation by port-forwarding the proxy service
```
kubectl -nlibrephotos port-forward svc/proxy 55555:80

```
Then open `http://localhost:55555` in your browser and log in as `admin`.

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

The backend runs migrations and starts its services before it serves anything, so the startup probe allows ten
minutes for the first request to succeed; raise its `failureThreshold` if your host is slower than that. The
readiness probe is deliberately slow to give up, because the proxy container that serves the frontend shares the
backend's Pod: marking the backend NotReady also removes the frontend from the `proxy` Service.

# Upgrading

Change the values in `kustomization.yaml`, in the `images` section, to point to the latest versions. Then just rerun
the `kubectl apply -k .` command.
