-- Job metadata is independent of cash and survives repeated scheduled invocations.
CREATE TABLE economy_job_cursors (
 queue TEXT PRIMARY KEY NOT NULL, last_item TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE economy_job_attempts (
 queue TEXT NOT NULL, item_id TEXT NOT NULL, attempted_at INTEGER NOT NULL,
 outcome TEXT NOT NULL CHECK(outcome IN ('complete','deferred','error')),
 error_code TEXT, PRIMARY KEY(queue,item_id)
);
