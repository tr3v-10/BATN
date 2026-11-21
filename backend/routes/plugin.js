const express = require("express");
const crypto = require("crypto");
const db = require("../database/db");
const { requirePluginKey, hashKey } = require("../plugins/auth");

const router = express.Router();

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

// Provisioning is an operator-only action. Never expose this secret in Bubble client-side settings.
router.post("/marketplaces", (req, res) => {
  const provisioningKey = process.env.JADILI_PROVISIONING_KEY;
  if (!provisioningKey || !safeEqual(req.get("x-jadili-provisioning-key"), provisioningKey)) {
    return res.status(401).json({
      error: { code: "PROVISIONING_UNAUTHORIZED", message: "Marketplace provisioning is not authorized." }
    });
  }

  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name || name.length > 120) {
    return res.status(400).json({
      error: { code: "INVALID_MARKETPLACE_NAME", message: "Provide a marketplace name of 1–120 characters." }
    });
  }

  const marketplaceId = crypto.randomUUID();
  const apiKeyId = crypto.randomUUID();
  const secret = crypto.randomBytes(32).toString("base64url");
  const apiKey = "jad_live_" + secret;
  const keyPrefix = apiKey.slice(0, 16);

  const create = db.transaction(() => {
    db.prepare("INSERT INTO plugin_marketplaces (id, name) VALUES (?, ?)").run(marketplaceId, name);
    db.prepare(`
      INSERT INTO plugin_api_keys (id, marketplace_id, key_hash, key_prefix, label)
      VALUES (?, ?, ?, ?, ?)
    `).run(apiKeyId, marketplaceId, hashKey(apiKey), keyPrefix, "Bubble plugin primary key");
  });
  create();

  res.status(201).json({
    marketplace: { id: marketplaceId, name, status: "active" },
    api_key: apiKey,
    warning: "Copy this key now. It is shown once and cannot be retrieved later."
  });
});

// Bubble server-side actions call this to validate the configured key and identify the tenant.
router.get("/me", requirePluginKey, (req, res) => {
  res.json({
    marketplace: {
      id: req.marketplace.id,
      name: req.marketplace.name,
      status: "active"
    },
    plugin: { name: "JADILI", api_version: "v1", capabilities: ["marketplace_identity"] }
  });
});

module.exports = router;
