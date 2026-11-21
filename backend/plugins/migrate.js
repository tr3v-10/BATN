const crypto = require("crypto");

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
}

module.exports = migratePlugins;
