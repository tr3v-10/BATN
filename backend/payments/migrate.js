const db = require("../database/db");

function columns(table) {
  return new Set(db.prepare("PRAGMA table_info(" + table + ")").all().map(row => row.name));
}

function migratePayments() {
  const existing = columns("payment_intents");
  const additions = [
    ["checkout_request_id", "TEXT"],
    ["mpesa_receipt", "TEXT"],
    ["phone", "TEXT"],
    ["failure_reason", "TEXT"],
    ["initiated_at", "DATETIME"],
    ["completed_at", "DATETIME"],
    ["callback_received_at", "DATETIME"],
    ["attempt_count", "INTEGER NOT NULL DEFAULT 0"]
  ];

  for (const [name, type] of additions) {
    if (!existing.has(name)) db.exec("ALTER TABLE payment_intents ADD COLUMN " + name + " " + type);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS payment_events (
      id TEXT PRIMARY KEY,
      payment_id TEXT NOT NULL,
      type TEXT NOT NULL,
      raw_payload TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (payment_id) REFERENCES payment_intents(id)
    );
    CREATE INDEX IF NOT EXISTS idx_payment_events_payment
      ON payment_events(payment_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_payment_reconcile
      ON payment_intents(status, initiated_at);
  `);
}

module.exports = migratePayments;
