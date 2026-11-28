---
title: "Upgrade rehearsal"
description: "The CI job that upgrades a database made by the previous release with the code on dev."
sidebar_position: 10
---

<Since version="1.7.0" /> The unit tests build their database from this code's migrations, so they never see a
database that an older release made and filled. `.github/workflows/upgrade-rehearsal.yml` does: it takes the
released image of the previous release, lets that release create and fill a database, then upgrades it
with the code of the pull request and checks that the data, the secrets and the background jobs survived.
It runs once on PostgreSQL and once on SQLite.

## When it runs

On pull requests and pushes to `dev` that touch `apps/backend/api/migrations/`, `apps/backend/api/jobs/`,
`api/models/encrypted_fields.py`, the requirements files, `scripts/setup_test_env.sh`, the rehearsal
scripts or the workflow itself, and by hand (`workflow_dispatch`). A run takes about as long as the
dependency install of `test-backend`; the seed runs in the background meanwhile.

## What it does

1. **Seed** (`scripts/upgrade_rehearsal/seed_previous_release.py`), inside
   `reallibrephotos/librephotos:1.6.0` with `librephotos.settings.production_noproxy`: `migrate`, then
   - two users, six photos (one removed, one in the trash without `trashed_at`), two unknown face
     clusters of one user, a finished job without a start and a cancelled job marked failed;
   - the Nextcloud app password and the email secret, stored by django-cryptography;
   - the django-q schedules of `start_cleaning_service` (with the automatic scan on), of
     `start_job_cleanup_service` and of `start_service all`, plus rows an older release left: the
     paths moved in 1.5.0 (`api.services.*`, `api.all_tasks.delete_zip_file`), the stuck job cleanup of
     1.4.0, a once schedule with keyword arguments, one with `repeats=0`;
   - four pickled tasks in `django_q_ormq`: an Empty trash job, a chain (a task, then an Empty trash
     job), a zip deletion without a job, and a job whose function (`api.jobs.broker`) is gone.

   It writes `upgrade-rehearsal.json` (job ids, photo ids, each schedule's `next_run`) next to the data.
2. **Migrate** with this code: `manage.py migrate`, then `manage.py migrate --check`.
3. **Check the migrated database** (`check_upgrade.py migrated`), before anything else touches it: the
   rows the data migrations since 1.6.0 repair (0230, 0234, 0241), the secrets decrypting to what was
   stored and still in the old format, `api_taskschedule` holding exactly the expected copies with their
   `next_run`, each naming a function this code has, `django_q_schedule` empty, the four tasks still
   waiting.
4. **Start up** as the entrypoint does, without the sidecars: `start_cleaning_service`,
   `start_job_cleanup_service`, and the removal of the watchdog schedule that `start_service all` does.
   The check then finds no second schedule, the 1.4.0 one gone and the automatic scan's `next_run` kept.
5. **Run the workers** (`check_upgrade.py workers`): queues a new zip deletion and starts
   `manage.py run_workers --workers 2 --stop-file ...`. It waits up to four minutes for the three readable
   django-q tasks to have run (both Empty trash jobs completed, the zip file deleted), the unreadable one
   dropped with `Dropped django-q task` in the log and its job failed, the overdue once schedule fired, the
   new task done and the queue drained; any failed task fails the run. Then it stops the workers through
   the stop file and kills the sidecars the watchdog started.

A failed run uploads the logs, `run_workers.log` and the manifest as an artifact.

## What it caught

Its first run on PostgreSQL stopped in migration 0241: merging the duplicate unknown clusters moves faces
and deletes clusters, which leaves PostgreSQL's deferred foreign key checks pending, and the unique index
the same migration then creates is refused ("cannot CREATE INDEX "api_cluster" because it has pending
trigger events"). The unit test of 0241 had only run on SQLite. The migration now makes the checks
immediate first (`SET CONSTRAINTS ALL IMMEDIATE`), and the PostgreSQL job of `test-backend.yml` runs the
tests of the migrations since the last release (0230, 0236, 0241, 0243) on PostgreSQL as well; list a new
migration test there. A data migration that writes rows and then changes the schema of a table they
reference needs the same. The older migration tests (0139, 0140, 0155, 0156) do not pass on PostgreSQL
yet, for the same reason or because they expect SQLite's index names.

## Running it locally

The seed needs Docker; the rest runs in the backend's venv. From the repository root, with a PostgreSQL on
`localhost:5432` for `DB_BACKEND=postgresql`:

```bash
export DJANGO_SETTINGS_MODULE=librephotos.settings.production_noproxy DB_BACKEND=sqlite \
  SECRET_KEY=upgrade-rehearsal-secret REHEARSAL_DATA=/tmp/rehearsal-data
mkdir -p "$REHEARSAL_DATA/logs"
docker run --rm --network host --user "$(id -u):$(id -g)" \
  -v "$PWD/apps/backend/scripts/upgrade_rehearsal:/rehearsal:ro" -v "$REHEARSAL_DATA:/rehearsal-data" \
  -e DJANGO_SETTINGS_MODULE -e DB_BACKEND -e SECRET_KEY \
  -e BASE_DATA=/rehearsal-data -e BASE_LOGS=/rehearsal-data/logs -e PYTHONPATH=/code -e HOME=/tmp \
  --entrypoint python reallibrephotos/librephotos:1.6.0 /rehearsal/seed_previous_release.py /rehearsal-data
cd apps/backend
export BASE_DATA="$REHEARSAL_DATA" BASE_LOGS="$REHEARSAL_DATA/logs"
python manage.py migrate --noinput && python manage.py migrate --check
python scripts/upgrade_rehearsal/check_upgrade.py migrated "$REHEARSAL_DATA"
python manage.py start_cleaning_service && python manage.py start_job_cleanup_service
python scripts/upgrade_rehearsal/check_upgrade.py workers "$REHEARSAL_DATA"
```

Use a fresh `REHEARSAL_DATA` (and database) for every run. A venv that still has `django-q2` or
`django-cryptography-5` installed hides an import of them that CI would catch.

## After a release

The seed uses the previous release's own APIs (`django_q`, `api.jobs.queue` of 1.6.0), so it stays on
1.6.0, the last release with django-q2, as long as an upgrade from it is supported. To rehearse from a
newer release as well, add it to the `release` matrix with a seed that uses that release's queue, and
keep the expectations in `rehearsal_data.py` in step with what the migrations copy.
