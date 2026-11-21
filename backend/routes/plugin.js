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

function itemAllowed(allowedItems, description) {
  if (allowedItems === "*") return true;
  try {
    return JSON.parse(allowedItems).some(item => item.toLowerCase() === description.trim().toLowerCase());
  } catch {
    return false;
  }
}

router.post("/negotiations", requirePluginKey, (req, res) => {
  const { buyer_agent_id, seller_agent_id, item_description, quantity, initial_offer } = req.body || {};
  if (!buyer_agent_id || !seller_agent_id || typeof item_description !== "string" || !item_description.trim() ||
      !Number.isInteger(quantity) || quantity <= 0 || !Number.isFinite(initial_offer) || initial_offer <= 0) {
    return res.status(400).json({ error: { code: "INVALID_NEGOTIATION", message: "Buyer, seller, item, positive integer quantity and positive initial_offer are required." } });
  }
  if (buyer_agent_id === seller_agent_id) return res.status(400).json({ error: { code: "SAME_AGENT", message: "An agent cannot negotiate with itself." } });

  const buyer = db.prepare("SELECT id, name, role, status FROM agents WHERE id = ? AND marketplace_id = ?").get(buyer_agent_id, req.marketplace.id);
  const seller = db.prepare("SELECT id, name, role, status FROM agents WHERE id = ? AND marketplace_id = ?").get(seller_agent_id, req.marketplace.id);
  if (!buyer || !seller) return res.status(404).json({ error: { code: "AGENT_NOT_FOUND", message: "Buyer or seller agent not found in this marketplace." } });
  if (buyer.role !== "buyer" || seller.role !== "seller") return res.status(400).json({ error: { code: "INVALID_AGENT_ROLES", message: "A buyer agent and seller agent are required." } });
  if (buyer.status !== "active" || seller.status !== "active") return res.status(409).json({ error: { code: "AGENT_INACTIVE", message: "Both agents must be active." } });

  const buyerMandate = db.prepare("SELECT * FROM agent_mandates WHERE agent_id = ? AND marketplace_id = ?").get(buyer.id, req.marketplace.id);
  const sellerMandate = db.prepare("SELECT * FROM agent_mandates WHERE agent_id = ? AND marketplace_id = ?").get(seller.id, req.marketplace.id);
  if (!buyerMandate || !sellerMandate) return res.status(409).json({ error: { code: "MANDATE_REQUIRED", message: "Both agents need saved mandates." } });
  if (!itemAllowed(buyerMandate.allowed_items, item_description) || !itemAllowed(sellerMandate.allowed_items, item_description)) {
    return res.status(403).json({ error: { code: "ITEM_NOT_AUTHORIZED", message: "This item is outside one or both agent mandates." } });
  }
  if (quantity > buyerMandate.max_quantity || quantity > sellerMandate.max_quantity) {
    return res.status(403).json({ error: { code: "QUANTITY_LIMIT", message: "Quantity exceeds an agent mandate." } });
  }
  if (initial_offer > buyerMandate.max_unit_price) return res.status(403).json({ error: { code: "BUYER_PRICE_LIMIT", message: "Initial offer exceeds the buyer's maximum unit price." } });

  const buyerMax = buyerMandate.max_unit_price;
  const sellerMin = sellerMandate.min_unit_price;
  let candidatePrice = null;
  let status = "rejected";
  let message = "Seller's minimum price exceeds the buyer's authorized maximum.";
  let messageType = "rejection";
  let responsePrice = null;

  if (initial_offer >= sellerMin) {
    candidatePrice = initial_offer; status = "accepted"; message = "Seller accepted the buyer's offer."; messageType = "acceptance"; responsePrice = initial_offer;
  } else if (sellerMin <= buyerMax) {
    candidatePrice = sellerMin; status = "accepted"; message = "Seller counteroffer is within the buyer's authorized price limit."; messageType = "counteroffer_accepted"; responsePrice = sellerMin;
  }

  if (candidatePrice !== null) {
    const total = candidatePrice * quantity;
    if (total > buyerMandate.max_total_amount || total > sellerMandate.max_total_amount) {
      return res.status(403).json({ error: { code: "TOTAL_LIMIT", message: "Transaction exceeds an agent's total spending mandate." } });
    }
  }

  const negotiationId = crypto.randomUUID();
  const requiresApproval = buyerMandate.requires_approval === 1 || sellerMandate.requires_approval === 1;
  let finalPrice = candidatePrice;
  if (status === "accepted" && requiresApproval) {
    status = "pending_approval"; finalPrice = null; messageType = "approval_required"; message = "Proposed agreement requires human approval.";
  }

  let assessment = null;
  if (candidatePrice !== null) {
    const { assessRisk, saveRiskAssessment } = require("../services/riskengine");
    assessment = assessRisk({
      id: negotiationId, buyer_agent_id: buyer.id, seller_agent_id: seller.id,
      item_description: item_description.trim(), quantity, total_amount: candidatePrice * quantity,
      buyer_status: buyer.status, seller_status: seller.status,
      buyer_max_total: buyerMandate.max_total_amount, seller_max_total: sellerMandate.max_total_amount,
      marketplace_id: req.marketplace.id
    });
    assessment.marketplace_id = req.marketplace.id;
    if (assessment.decision === "block") {
      status = "blocked"; finalPrice = null; messageType = "risk_block"; message = "Negotiation blocked by the JADILI risk engine.";
    } else if (assessment.decision === "review") {
      status = "pending_risk_review"; finalPrice = null; messageType = "risk_review"; message = "Negotiation flagged for human risk review.";
    }
  }

  const save = db.transaction(() => {
    db.prepare("INSERT INTO negotiation_sessions (id,buyer_agent_id,seller_agent_id,status,agreed_amount,currency,description,marketplace_id) VALUES (?,?,?,?,?,'KES',?,?)")
      .run(negotiationId, buyer.id, seller.id, status, finalPrice, item_description.trim(), req.marketplace.id);
    db.prepare("INSERT INTO negotiations (id,buyer_agent_id,seller_agent_id,item_description,quantity,buyer_max_price,seller_min_price,initial_offer,final_price,status,marketplace_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .run(negotiationId, buyer.id, seller.id, item_description.trim(), quantity, buyerMax, sellerMin, initial_offer, finalPrice, status, req.marketplace.id);
    db.prepare("INSERT INTO negotiation_messages (id,session_id,sender_agent_id,message_type,message,proposed_amount) VALUES (?,?,?,?,?,?)")
      .run(crypto.randomUUID(), negotiationId, buyer.id, "proposal", `Buyer proposed KES ${initial_offer} per unit for ${quantity} units of ${item_description.trim()}.`, initial_offer);
    db.prepare("INSERT INTO negotiation_messages (id,session_id,sender_agent_id,message_type,message,proposed_amount) VALUES (?,?,?,?,?,?)")
      .run(crypto.randomUUID(), negotiationId, seller.id, messageType, message, responsePrice);
    if (assessment) saveRiskAssessment(assessment);
    db.prepare("INSERT INTO audit_logs (id,actor,action,entity_type,entity_id,details,marketplace_id) VALUES (?,?,?,?,?,?,?)")
      .run(crypto.randomUUID(), "bubble_plugin", "negotiation_created", "negotiation", negotiationId, JSON.stringify({ status, item_description: item_description.trim(), quantity }), req.marketplace.id);
  });
  save();

  res.status(201).json({
    negotiation: {
      id: negotiationId, buyer_agent_id: buyer.id, seller_agent_id: seller.id,
      item_description: item_description.trim(), quantity, initial_offer,
      proposed_agreement_price: candidatePrice, final_price: finalPrice, status,
      total_amount: candidatePrice === null ? null : candidatePrice * quantity,
      requires_approval: requiresApproval
    },
    risk_assessment: assessment ? { score: assessment.risk_score, level: assessment.risk_level, flags: assessment.flags, decision: assessment.decision } : null
  });
});

router.get("/negotiations", requirePluginKey, (req, res) => {
  const rows = db.prepare(`
    SELECT n.*, b.name AS buyer_name, s.name AS seller_name
    FROM negotiations n
    JOIN agents b ON b.id = n.buyer_agent_id
    JOIN agents s ON s.id = n.seller_agent_id
    WHERE n.marketplace_id = ? ORDER BY n.created_at DESC LIMIT 500
  `).all(req.marketplace.id);
  res.json({ count: rows.length, negotiations: rows });
});

router.get("/negotiations/:negotiationId/messages", requirePluginKey, (req, res) => {
  const negotiation = db.prepare("SELECT id FROM negotiations WHERE id = ? AND marketplace_id = ?")
    .get(req.params.negotiationId, req.marketplace.id);
  if (!negotiation) return res.status(404).json({ error: { code: "NEGOTIATION_NOT_FOUND", message: "Negotiation not found in this marketplace." } });
  const messages = db.prepare(`
    SELECT m.id, m.message_type, m.message, m.proposed_amount, m.created_at,
           a.name AS agent_name, a.role AS agent_role
    FROM negotiation_messages m
    LEFT JOIN agents a ON a.id = m.sender_agent_id
    WHERE m.session_id = ? ORDER BY m.created_at ASC
  `).all(negotiation.id);
  res.json({ negotiation_id: negotiation.id, count: messages.length, messages });
});

router.get("/risk/review-queue", requirePluginKey, (req, res) => {
  const reviews = db.prepare(`
    SELECT r.id, r.negotiation_id, r.risk_score, r.risk_level, r.flags, r.decision,
           r.reviewed, r.created_at, n.item_description, n.quantity, n.initial_offer,
           n.status AS negotiation_status, b.name AS buyer_name, s.name AS seller_name
    FROM risk_assessments r
    JOIN negotiations n ON n.id = r.negotiation_id
    JOIN agents b ON b.id = n.buyer_agent_id
    JOIN agents s ON s.id = n.seller_agent_id
    WHERE r.marketplace_id = ? AND r.decision = 'review' AND r.reviewed = 0
      AND n.status = 'pending_risk_review'
    ORDER BY r.created_at ASC LIMIT 200
  `).all(req.marketplace.id).map(row => ({ ...row, flags: JSON.parse(row.flags || "[]") }));
  res.json({ count: reviews.length, reviews });
});

router.post("/negotiations/:negotiationId/risk-review", requirePluginKey, (req, res) => {
  const { action, reviewer, notes } = req.body || {};
  if (!["approve", "reject"].includes(action) || typeof reviewer !== "string" || !reviewer.trim()) {
    return res.status(400).json({ error: { code: "INVALID_REVIEW", message: "action (approve/reject) and reviewer are required." } });
  }
  const negotiation = db.prepare("SELECT * FROM negotiations WHERE id = ? AND marketplace_id = ?")
    .get(req.params.negotiationId, req.marketplace.id);
  if (!negotiation || negotiation.status !== "pending_risk_review") {
    return res.status(404).json({ error: { code: "REVIEW_NOT_FOUND", message: "Negotiation is not awaiting risk review in this marketplace." } });
  }
  const risk = db.prepare("SELECT * FROM risk_assessments WHERE negotiation_id = ? AND marketplace_id = ?")
    .get(negotiation.id, req.marketplace.id);
  if (!risk || risk.decision !== "review" || risk.reviewed !== 0) {
    return res.status(409).json({ error: { code: "RISK_ALREADY_REVIEWED", message: "Risk assessment is not awaiting review." } });
  }

  const candidatePrice = negotiation.initial_offer >= negotiation.seller_min_price
    ? negotiation.initial_offer : negotiation.seller_min_price;
  const mandates = db.prepare(`
    SELECT b.requires_approval AS buyer_approval, s.requires_approval AS seller_approval
    FROM agent_mandates b JOIN agent_mandates s ON s.agent_id = ?
    WHERE b.agent_id = ? AND b.marketplace_id = ? AND s.marketplace_id = ?
  `).get(negotiation.seller_agent_id, negotiation.buyer_agent_id, req.marketplace.id, req.marketplace.id);
  const requiresApproval = !!(mandates && (mandates.buyer_approval || mandates.seller_approval));
  const status = action === "reject" ? "rejected" : (requiresApproval ? "pending_approval" : "accepted");
  const finalPrice = action === "approve" ? candidatePrice : null;
  const reviewNotes = typeof notes === "string" ? notes.trim().slice(0, 2000) : null;

  const apply = db.transaction(() => {
    db.prepare("UPDATE negotiations SET status = ?, final_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND marketplace_id = ?")
      .run(status, finalPrice, negotiation.id, req.marketplace.id);
    db.prepare("UPDATE negotiation_sessions SET status = ?, agreed_amount = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND marketplace_id = ?")
      .run(status, finalPrice, negotiation.id, req.marketplace.id);
    db.prepare("UPDATE risk_assessments SET reviewed = 1, review_notes = ?, decision = ?, updated_at = CURRENT_TIMESTAMP WHERE negotiation_id = ? AND marketplace_id = ?")
      .run(reviewNotes, action === "approve" ? "allow" : "block", negotiation.id, req.marketplace.id);
    db.prepare("INSERT INTO audit_logs (id,actor,action,entity_type,entity_id,details,marketplace_id) VALUES (?,?,?,?,?,?,?)")
      .run(crypto.randomUUID(), reviewer.trim(), action === "approve" ? "risk_review_approved" : "risk_review_rejected",
        "negotiation", negotiation.id, JSON.stringify({ reviewer: reviewer.trim(), notes: reviewNotes }), req.marketplace.id);
  });
  apply();
  res.json({ negotiation_id: negotiation.id, action, status, final_price: finalPrice, requires_owner_approval: requiresApproval });
});

router.post("/payments/initiate", requirePluginKey, async (req, res) => {
  const { negotiation_id, phone } = req.body || {};
  if (typeof negotiation_id !== "string" || !negotiation_id || typeof phone !== "string") {
    return res.status(400).json({ error: { code: "INVALID_PAYMENT", message: "negotiation_id and phone are required." } });
  }
  const negotiation = db.prepare("SELECT id FROM negotiations WHERE id = ? AND marketplace_id = ?")
    .get(negotiation_id, req.marketplace.id);
  if (!negotiation) return res.status(404).json({ error: { code: "NEGOTIATION_NOT_FOUND", message: "Negotiation not found in this marketplace." } });

  try {
    const service = require("../payments/paymentService");
    const payment = await service.createAndInitiatePayment(negotiation_id, phone);
    // Marketplace ownership is assigned during payment-intent creation and propagated to tracking.
    res.status(200).json({ payment: {
      id: payment.id, negotiation_id: payment.negotiation_id, amount: payment.amount,
      currency: payment.currency, provider: payment.provider, status: payment.status,
      phone: payment.phone, provider_reference: payment.provider_reference,
      mpesa_receipt: payment.mpesa_receipt, failure_reason: payment.failure_reason,
      created_at: payment.created_at, updated_at: payment.updated_at
    } });
  } catch (error) {
    const status = {
      NEGOTIATION_NOT_FOUND: 404, NEGOTIATION_NOT_PAYABLE: 409,
      OWNER_APPROVAL_REQUIRED: 403, RISK_REVIEW_REQUIRED: 403,
      PAYMENT_CANCELLED: 409, INVALID_TRANSITION: 409,
      MANUAL_RECONCILIATION_REQUIRED: 409
    }[error.code] || 400;
    res.status(status).json({ error: { code: error.code || "PAYMENT_ERROR", message: error.message || "Unable to initiate payment." } });
  }
});

router.get("/payments", requirePluginKey, (req, res) => {
  const payments = db.prepare(`
    SELECT p.id, p.negotiation_id, p.amount, p.currency, p.provider, p.status,
           p.phone, p.provider_reference, p.mpesa_receipt, p.failure_reason,
           p.created_at, p.updated_at, n.item_description, n.quantity
    FROM payment_intents p JOIN negotiations n ON n.id = p.negotiation_id
    WHERE p.marketplace_id = ? ORDER BY p.created_at DESC LIMIT 500
  `).all(req.marketplace.id);
  res.json({ count: payments.length, payments });
});

router.get("/payments/:paymentId", requirePluginKey, (req, res) => {
  const payment = db.prepare(`
    SELECT p.id, p.negotiation_id, p.amount, p.currency, p.provider, p.status,
           p.phone, p.provider_reference, p.mpesa_receipt, p.failure_reason,
           p.created_at, p.updated_at, n.item_description, n.quantity, n.final_price
    FROM payment_intents p JOIN negotiations n ON n.id = p.negotiation_id
    WHERE p.id = ? AND p.marketplace_id = ?
  `).get(req.params.paymentId, req.marketplace.id);
  if (!payment) return res.status(404).json({ error: { code: "PAYMENT_NOT_FOUND", message: "Payment not found in this marketplace." } });
  const events = db.prepare("SELECT type, created_at FROM payment_events WHERE payment_id = ? ORDER BY created_at ASC").all(payment.id);
  res.json({ payment, events });
});

router.get("/transactions", requirePluginKey, (req, res) => {
  const transactions = db.prepare(`
    SELECT t.id, t.negotiation_id, t.transaction_status, t.created_at, t.updated_at,
           n.item_description, n.quantity, n.final_price,
           p.id AS payment_id, p.amount, p.currency, p.status AS payment_status,
           p.provider, p.provider_reference, p.mpesa_receipt
    FROM transaction_tracking t
    JOIN negotiations n ON n.id = t.negotiation_id
    LEFT JOIN payment_intents p ON p.id = t.payment_intent_id
    WHERE t.marketplace_id = ? ORDER BY t.created_at DESC LIMIT 500
  `).all(req.marketplace.id);
  res.json({ count: transactions.length, transactions });
});

module.exports = router;
