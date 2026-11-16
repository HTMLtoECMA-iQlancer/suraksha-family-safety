-- Child-controlled standing consent for visible camera/audio check-ins.
ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS trusted_check_in JSONB NOT NULL
  DEFAULT '{"enabled": false, "kinds": [], "updatedAt": null}'::jsonb;

ALTER TABLE session_requests
  ADD COLUMN IF NOT EXISTS trusted BOOLEAN NOT NULL DEFAULT false;
