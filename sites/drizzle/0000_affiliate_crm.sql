CREATE TABLE crm_leads (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL CHECK (length(owner_id) BETWEEN 1 AND 200),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  telegram TEXT NOT NULL DEFAULT '' CHECK (length(telegram) <= 80),
  phone TEXT NOT NULL DEFAULT '' CHECK (length(phone) <= 60),
  stage TEXT NOT NULL DEFAULT 'new' CHECK (stage IN ('new','contacted','courier','received','paid','lost')),
  cards_json TEXT NOT NULL DEFAULT '[]' CHECK (CASE WHEN json_valid(cards_json) THEN json_type(cards_json) = 'array' ELSE 0 END),
  next_action TEXT NOT NULL DEFAULT '' CHECK (length(next_action) <= 500),
  due_at TEXT,
  commission_kopecks INTEGER NOT NULL DEFAULT 0 CHECK (commission_kopecks >= 0 AND commission_kopecks <= 100000000000000),
  notes TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 10000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  UNIQUE (id, owner_id)
);
--> statement-breakpoint
CREATE INDEX crm_leads_owner_active_updated ON crm_leads (owner_id, archived_at, updated_at DESC);
--> statement-breakpoint
CREATE INDEX crm_leads_owner_stage ON crm_leads (owner_id, archived_at, stage);
--> statement-breakpoint
CREATE INDEX crm_leads_owner_due ON crm_leads (owner_id, archived_at, due_at);
--> statement-breakpoint
CREATE TABLE crm_notes (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  lead_id TEXT NOT NULL,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 10000),
  created_at TEXT NOT NULL,
  FOREIGN KEY (lead_id, owner_id) REFERENCES crm_leads (id, owner_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX crm_notes_owner_lead_created ON crm_notes (owner_id, lead_id, created_at);
--> statement-breakpoint
CREATE TABLE crm_tasks (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL CHECK (length(owner_id) BETWEEN 1 AND 200),
  lead_id TEXT,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 240),
  due_at TEXT,
  done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (lead_id, owner_id) REFERENCES crm_leads (id, owner_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX crm_tasks_owner_active_due ON crm_tasks (owner_id, archived_at, done, due_at);
--> statement-breakpoint
CREATE INDEX crm_tasks_owner_lead ON crm_tasks (owner_id, lead_id, archived_at);
