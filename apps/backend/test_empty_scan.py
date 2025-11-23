#!/usr/bin/env python
import os
import sys
import django
import uuid
import time

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "librephotos.settings")
django.setup()

from api.models import User, LongRunningJob
from api.directory_watcher import scan_photos

# Create test user
user, created = User.objects.get_or_create(
    username="empty_scan_user",
    defaults={"scan_directory": "/tmp/empty_scan_test"}
)
user.scan_directory = "/tmp/empty_scan_test"
user.save()

print(f"Testing scan with empty directory: {user.scan_directory}")
print(f"Files in directory: {len(os.listdir(user.scan_directory))}")

# Start scan
job_id = uuid.uuid4()
print(f"\nStarting scan with job_id: {job_id}")

scan_photos(user, full_scan=True, job_id=job_id, scan_directory="/tmp/empty_scan_test")

# Wait a moment for job to complete
time.sleep(2)

# Check job status
try:
    job = LongRunningJob.objects.get(job_id=job_id)
    percentage = (job.progress_current / job.progress_target * 100) if job.progress_target > 0 else 0
    
    print("\n=== Scan Results ===")
    print(f"Job ID: {job.job_id}")
    print(f"Job Type: {job.job_type}")
    print(f"Progress: {job.progress_current}/{job.progress_target}")
    print(f"Percentage: {percentage:.1f}%")
    print(f"Started: {job.started_at}")
    print(f"Finished: {job.finished}")
    print(f"Finished at: {job.finished_at}")
    print(f"Failed: {job.failed}")
    
    if job.progress_target == 0 and job.finished:
        print("\n✓ PASS: Empty directory scan handled correctly (0/0, finished=True)")
    elif job.progress_target == 0 and not job.finished:
        print("\n✗ FAIL: Empty directory scan not marked as finished")
    else:
        print(f"\n? UNEXPECTED: progress_target={job.progress_target} (expected 0)")
        
except LongRunningJob.DoesNotExist:
    print(f"\n✗ FAIL: Job {job_id} not found in database")
