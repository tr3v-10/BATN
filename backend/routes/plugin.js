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

// All resources below are tenant-scoped using the marketplace from the API key.
router.post("/users", requirePluginKey, (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const externalId = typeof req.body?.external_user_id === "string" ? req.body.external_user_id.trim() : "";
  if (!name || name.length > 120 || !externalId || externalId.length > 180) {
    return res.status(400).json({ error: { code: "INVALID_USER", message: "name and external_user_id are required." } });
  }

  const existing = db.prepare(
    "SELECT id, name, external_id, created_at FROM users WHERE marketplace_id = ? AND external_id = ?"
  ).get(req.marketplace.id, externalId);
  if (existing) return res.json({ user: existing, created: false });

  const id = crypto.randomUUID();
  db.prepare("INSERT INTO users (id, name, email, marketplace_id, external_id) VALUES (?, ?, NULL, ?, ?)")
    .run(id, name, req.marketplace.id, externalId);
  db.prepare("INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details, marketplace_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(crypto.randomUUID(), "bubble_plugin", "marketplace_user_created", "user", id, JSON.stringify({ external_user_id: externalId }), req.marketplace.id);
  res.status(201).json({ user: { id, name, external_id: externalId }, created: true });
});

router.get("/users", requirePluginKey, (req, res) => {
  const users = db.prepare(
    "SELECT id, name, external_id, created_at FROM users WHERE marketplace_id = ? ORDER BY created_at DESC LIMIT 200"
  ).all(req.marketplace.id);
  res.json({ count: users.length, users });
});

router.post("/agents", requirePluginKey, (req, res) => {
  const { owner_id, role } = req.body || {};
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!owner_id || !name || name.length > 120 || !["buyer", "seller"].includes(role)) {
    return res.status(400).json({ error: { code: "INVALID_AGENT", message: "owner_id, name and role (buyer or seller) are required." } });
  }
  const owner = db.prepare("SELECT id FROM users WHERE id = ? AND marketplace_id = ?").get(owner_id, req.marketplace.id);
  if (!owner) return res.status(404).json({ error: { code: "OWNER_NOT_FOUND", message: "Owner not found in this marketplace." } });

  const id = crypto.randomUUID();
  db.prepare("INSERT INTO agents (id, owner_id, name, role, status, marketplace_id) VALUES (?, ?, ?, ?, 'inactive', ?)")
    .run(id, owner_id, name, role, req.marketplace.id);
  db.prepare("INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details, marketplace_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(crypto.randomUUID(), "bubble_plugin", "marketplace_agent_created", "agent", id, JSON.stringify({ owner_id, role }), req.marketplace.id);
  res.status(201).json({ agent: { id, owner_id, name, role, status: "inactive" } });
});

router.get("/agents", requirePluginKey, (req, res) => {
  const agents = db.prepare(`
    SELECT a.id, a.owner_id, a.name, a.role, a.status, a.created_at, u.name AS owner_name
    FROM agents a JOIN users u ON u.id = a.owner_id
    WHERE a.marketplace_id = ? ORDER BY a.created_at DESC LIMIT 500
  `).all(req.marketplace.id);
  res.json({ count: agents.length, agents });
});

router.put("/agents/:agentId/mandate", requirePluginKey, (req, res) => {
  const agent = db.prepare("SELECT id, role FROM agents WHERE id = ? AND marketplace_id = ?")
    .get(req.params.agentId, req.marketplace.id);
  if (!agent) return res.status(404).json({ error: { code: "AGENT_NOT_FOUND", message: "Agent not found in this marketplace." } });

  const { max_unit_price, min_unit_price, max_quantity, max_total_amount, allowed_items, requires_approval } = req.body || {};
  if (!Number.isInteger(max_quantity) || max_quantity <= 0 || !Number.isFinite(max_total_amount) || max_total_amount <= 0 || typeof requires_approval !== "boolean") {
    return res.status(400).json({ error: { code: "INVALID_MANDATE", message: "Valid max_quantity, max_total_amount and requires_approval are required." } });
  }
  if (agent.role === "buyer" && (!Number.isFinite(max_unit_price) || max_unit_price <= 0 || min_unit_price != null)) {
    return res.status(400).json({ error: { code: "INVALID_BUYER_MANDATE", message: "Buyer mandate requires max_unit_price only." } });
  }
  if (agent.role === "seller" && (!Number.isFinite(min_unit_price) || min_unit_price <= 0 || max_unit_price != null)) {
    return res.status(400).json({ error: { code: "INVALID_SELLER_MANDATE", message: "Seller mandate requires min_unit_price only." } });
  }

  let allowed;
  if (allowed_items === undefined || allowed_items === "*") allowed = "*";
  else if (Array.isArray(allowed_items) && allowed_items.length && allowed_items.every(x => typeof x === "string" && x.trim())) allowed = JSON.stringify(allowed_items.map(x => x.trim()));
  else return res.status(400).json({ error: { code: "INVALID_ALLOWED_ITEMS", message: "allowed_items must be '*' or a non-empty array of strings." } });

  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO agent_mandates (id, agent_id, max_unit_price, min_unit_price, max_quantity, max_total_amount, allowed_items, requires_approval, marketplace_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(agent_id) DO UPDATE SET
      max_unit_price=excluded.max_unit_price,
      min_unit_price=excluded.min_unit_price,
      max_quantity=excluded.max_quantity,
      max_total_amount=excluded.max_total_amount,
      allowed_items=excluded.allowed_items,
      requires_approval=excluded.requires_approval,
      marketplace_id=excluded.marketplace_id,
      updated_at=CURRENT_TIMESTAMP
  `).run(id, agent.id, agent.role === "buyer" ? max_unit_price : null, agent.role === "seller" ? min_unit_price : null, max_quantity, max_total_amount, allowed, requires_approval ? 1 : 0, req.marketplace.id);

  const mandate = db.prepare("SELECT * FROM agent_mandates WHERE agent_id = ? AND marketplace_id = ?").get(agent.id, req.marketplace.id);
  res.json({ mandate });
});

router.get("/agents/:agentId/mandate", requirePluginKey, (req, res) => {
  const mandate = db.prepare(`
    SELECT m.* FROM agent_mandates m
    JOIN agents a ON a.id = m.agent_id
    WHERE m.agent_id = ? AND a.marketplace_id = ? AND m.marketplace_id = ?
  `).get(req.params.agentId, req.marketplace.id, req.marketplace.id);
  if (!mandate) return res.status(404).json({ error: { code: "MANDATE_NOT_FOUND", message: "Mandate not found in this marketplace." } });
  res.json({ mandate });
});

module.exports = router;
