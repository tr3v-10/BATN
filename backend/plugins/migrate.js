function ensureColumn(db, table, name, type) {
  const existing = new Set(db.prepare("PRAGMA table_info(" + table + ")").all().map(row => row.name));
  if (!existing.has(name)) db.exec("ALTER TABLE " + table + " ADD COLUMN " + name + " " + type);
}

function migratePlugins(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS plugin_marketplaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS plugin_api_keys (
      id TEXT PRIMARY KEY,
      marketplace_id TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT 'Bubble plugin',
      revoked_at DATETIME,
      last_used_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (marketplace_id) REFERENCES plugin_marketplaces(id)
    );

    CREATE INDEX IF NOT EXISTS idx_plugin_api_keys_hash
      ON plugin_api_keys(key_hash);
    CREATE INDEX IF NOT EXISTS idx_plugin_api_keys_marketplace
      ON plugin_api_keys(marketplace_id, revoked_at);
  `);

  // Existing records remain legacy/unassigned (NULL); only new plugin API
  // operations create rows with a marketplace_id.
  const ownershipTables = [
    "users", "agents", "agent_mandates", "negotiation_sessions",
    "negotiations", "risk_assessments", "payment_intents",
    "transaction_tracking", "transactions", "agreements", "payments",
    "audit_logs"
  ];
  for (const table of ownershipTables) ensureColumn(db, table, "marketplace_id", "TEXT");

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_users_marketplace ON users(marketplace_id);
    CREATE INDEX IF NOT EXISTS idx_agents_marketplace ON agents(marketplace_id);
    CREATE INDEX IF NOT EXISTS idx_mandates_marketplace ON agent_mandates(marketplace_id);
    CREATE INDEX IF NOT EXISTS idx_negotiations_marketplace ON negotiations(marketplace_id);
    CREATE INDEX IF NOT EXISTS idx_risk_marketplace ON risk_assessments(marketplace_id);
    CREATE INDEX IF NOT EXISTS idx_payments_marketplace ON payment_intents(marketplace_id);
    CREATE INDEX IF NOT EXISTS idx_tracking_marketplace ON transaction_tracking(marketplace_id);
    CREATE INDEX IF NOT EXISTS idx_audit_marketplace ON audit_logs(marketplace_id);
  `);
}

module.exports = migratePlugins;
