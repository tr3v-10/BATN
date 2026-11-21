const crypto = require("crypto");
const db = require("../database/db");

function hashKey(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function requirePluginKey(req, res, next) {
  const authorization = req.get("authorization") || "";
  const match = authorization.match(/^Bearer (jad_live_[A-Za-z0-9_-]{32,})$/);
  if (!match) {
    return res.status(401).json({
      error: { code: "PLUGIN_AUTH_REQUIRED", message: "A valid JADILI plugin API key is required." }
    });
  }

  const keyHash = hashKey(match[1]);
  const record = db.prepare(`
    SELECT m.id AS marketplace_id, m.name AS marketplace_name, m.status AS marketplace_status,
           k.id AS api_key_id
    FROM plugin_api_keys k
    JOIN plugin_marketplaces m ON m.id = k.marketplace_id
    WHERE k.key_hash = ? AND k.revoked_at IS NULL
  `).get(keyHash);

  if (!record || record.marketplace_status !== "active") {
    return res.status(401).json({
      error: { code: "PLUGIN_KEY_INVALID", message: "The JADILI plugin API key is invalid or inactive." }
    });
  }

  db.prepare("UPDATE plugin_api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(record.api_key_id);

  req.marketplace = {
    id: record.marketplace_id,
    name: record.marketplace_name,
    apiKeyId: record.api_key_id
  };
  next();
}

module.exports = { requirePluginKey, hashKey };
