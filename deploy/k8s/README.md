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
    kubectl create secret generic database -n librephotos DB_PASS=$(openssl rand -hex 16) DB_USER=librephotos
    ```
1. Create a secret for the backend's key, admin password, and optional MapBox API key.
    ```
    kubectl create secret generic backend -n librephotos SECRET_KEY=$key ADMIN_PASSWORD=$password MAPBOX_API_KEY=$apikey
    ```
    Substitute values for `$key`, `$password`, and `$apikey`. Make sure you remember the `$password` so you can log in.

If you want, you can watch the Pods get ready with `kubectl get pod -n librephotos -w`. Once they're all running,
point your browser at the hostname from `ingress.yaml`, and log in as `admin`.

# Upgrading

Change the values in `kustomization.yaml`, in the `images` section, to point to the latest versions. Then just rerun
the `kubectl apply -k .` command.
