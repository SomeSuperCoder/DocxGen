CREATE TABLE IF NOT EXISTS organization_templates (
  id TEXT PRIMARY KEY,
  owner_platform TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  source_filename TEXT,
  config TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_org_templates_owner ON organization_templates(owner_platform, owner_id);

CREATE TABLE IF NOT EXISTS directory_entries (
  id TEXT PRIMARY KEY,
  owner_platform TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  position TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  email TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_directory_owner ON directory_entries(owner_platform, owner_id);
