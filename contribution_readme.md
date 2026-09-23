# Open Source Contribution Log

**Project:** LibrePhotos
**Issue:** Remove orphaned thumbnail files when deleting missing photos
**Issue documentation:** [Remove orphaned thumbnail files when deleting missing photos](https://docs.librephotos.com/docs/development/contribution/backend/missing-photos)
**Status:** Phase III complete; ready for Phase IV pull request work

## Proposed Solution

When a `Thumbnail` record is deleted, use a Django `post_delete` signal to delete the files referenced by its three thumbnail fields through their configured storage backend. Add a regression test that verifies both database records and physical thumbnail files are removed when a missing photo is deleted.

## Phase I: Issue Selection

### Why I Chose This Issue

When LibrePhotos deletes missing photos, cascading database deletion removes the related thumbnail record, but Django does not automatically remove files stored by `ImageField` values. The orphaned files continue consuming storage. This issue has a clear, testable outcome and demonstrates how Django model deletion can coordinate with file cleanup.

## Phase II: Reproduction and Solution Planning

### Reproduction Process

#### Environment Setup

I used the LibrePhotos Docker Compose development environment on macOS. The backend is located in `apps/backend/`, and the Compose files are in `deploy/compose/`.

During setup, Docker initially failed because an existing `frontend` container conflicted with the Compose service name. I confirmed it belonged to the same Compose project, removed only that stale container, and restarted the stack with:

```bash
docker compose \
  -f deploy/compose/docker-compose.yml \
  -f deploy/compose/docker-compose.dev.yml \
  up -d
```

The backend, database, frontend, proxy, and pgAdmin services then started successfully.

#### Steps to Reproduce

1. Start the LibrePhotos development environment.
2. Add a test image to the configured scan directory.
3. Scan the library and wait for thumbnails to be generated.
4. Confirm files exist under `protected_media/thumbnails_big/`, `protected_media/square_thumbnails/`, and `protected_media/square_thumbnails_small/`.
5. Remove the original image from the scan directory.
6. Run the Scan Missing Photos job.
7. Run the Delete Missing Photos job.
8. Inspect the thumbnail directories again.

**Expected result:** The photo, thumbnail record, and all associated thumbnail files are removed.

**Actual result before the fix:** The photo and thumbnail database records were removed, but the physical thumbnail files remained on disk.

### Solution Approach

#### Implementation Plan

1. Add deletion cleanup to `apps/backend/api/models/thumbnail.py`.
2. Delete `thumbnail_big`, `square_thumbnail`, and `square_thumbnail_small` through each field's configured storage backend.
3. Ignore empty fields and allow storage backends to handle files that are already absent.
4. Add a regression test in `apps/backend/api/tests/photos/test_delete_missing_photos.py`.
5. Verify that missing-photo deletion removes both database records and physical thumbnail files.

## Phase III: Implementation and Testing

### Implementation Notes

Implemented the thumbnail cleanup signal in `apps/backend/api/models/thumbnail.py`:

- Registered a Django `post_delete` receiver for `Thumbnail`.
- Deletes the files referenced by all three thumbnail fields.
- Uses each field's storage backend instead of assuming a local filesystem.
- Skips empty file fields.

Added `DeleteMissingPhotosThumbnailCleanupTest` in `apps/backend/api/tests/photos/test_delete_missing_photos.py`:

- Creates a photo and thumbnail record.
- Writes test files to all three thumbnail fields.
- Runs `delete_missing_photos()`.
- Confirms the `Photo` and `Thumbnail` records are deleted.
- Confirms all three physical thumbnail files are deleted.

### Code Changes

Development branch: [fix/remove-orphaned-thumbnails](https://github.com/stepheng223/librephotos/tree/fix/remove-orphaned-thumbnails)

The implementation and test changes are currently present in the local worktree and are ready to commit and push. No pull request has been opened yet.

Relevant files:

- `apps/backend/api/models/thumbnail.py`
- `apps/backend/api/tests/photos/test_delete_missing_photos.py`

### Testing Strategy and Results

Focused Docker test command:

```bash
docker exec -e NO_COVERAGE=1 backend python manage.py test \
  api.tests.photos.test_delete_missing_photos.DeleteMissingPhotosThumbnailCleanupTest
```

Result:

```text
Ran 1 test in 0.276s
OK
```

Additional validation:

- Python compilation check passed for the changed Python files.
- `git diff --check` passed.
- Django system checks passed during the focused test.
- The Docker database service was healthy when the test ran.

The initial test attempt exposed that the production image did not include development dependencies. Installing `apps/backend/requirements.dev.txt` in the running container resolved the missing `coverage` and `faker` packages. The test was then rerun successfully with coverage disabled using `NO_COVERAGE=1`.

## Phase III Completion

**Phase III Complete.** The implementation is working, includes a regression test, and has been validated in the Docker development environment. The next step is Phase IV: commit the changes, push the development branch, open a pull request, and respond to maintainer feedback.

## Phase IV: Pull Request and Review

**Pull request:** Not submitted yet.

### Change Summary

This change prevents orphaned thumbnail files when missing photos are deleted. It keeps storage aligned with database state without changing thumbnail generation or unrelated photo cleanup behavior.

### Maintainer Feedback and Responses

No maintainer feedback yet. This section will be updated after the pull request is opened.

## Submission Checklist

- [x] Implementation summary added.
- [x] Development branch link added.
- [x] Testing strategy and results documented.
- [x] Phase III marked complete.
- [ ] Commit and push the implementation changes.
- [ ] Open a pull request targeting LibrePhotos `dev`.
- [ ] Participate in the required Slack scrum and attach a screenshot to the Phase III submission.
- [ ] Submit the contribution README and mark Phase III complete in the course platform.
