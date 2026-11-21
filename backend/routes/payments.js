const express = require("express");
const crypto = require("crypto");
const db = require("../database/db");
const service = require("../payments/paymentService");
const router = express.Router();
function limiter(max) {
  const hits = new Map();
  return (req, res, next) => {
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const recent = (hits.get(key) || []).filter(t => now - t < 60000);
    if (recent.length >= max) return res.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many attempts. Please wait a minute and try again." } });
    recent.push(now); hits.set(key, recent); next();
  };
}
const initiateLimiter = limiter(5);
const retryLimiter = limiter(3);
const fail = (res, status, code, message) => res.status(status).json({ error: { code, message } });

router.post("/initiate", initiateLimiter, async (req, res) => {
  try {
    const { negotiationId, phone } = req.body || {};
    if (typeof negotiationId !== "string" || !negotiationId || typeof phone !== "string") return fail(res, 400, "INVALID_INPUT", "A negotiation ID and valid M-Pesa phone number are required.");
    const payment = await service.createAndInitiatePayment(negotiationId, phone);
    return res.status(200).json({ payment });
  } catch (e) {
    const map = { NEGOTIATION_NOT_FOUND:404, NEGOTIATION_NOT_PAYABLE:409, OWNER_APPROVAL_REQUIRED:403, RISK_REVIEW_REQUIRED:403, PAYMENT_CANCELLED:409, INVALID_TRANSITION:409 };
    return fail(res, map[e.code] || 400, e.code || "PAYMENT_ERROR", e.message || "Unable to initiate payment.");
  }
});
router.get("/", (req, res) => {
  try {
    const clauses = [], params = [];
    if (req.query.status) { clauses.push("p.status = ?"); params.push(req.query.status); }
    if (req.query.date) { clauses.push("date(p.created_at) = date(?)"); params.push(req.query.date); }
    const where = clauses.length ? "WHERE " + clauses.join(" AND ") : "";
    const payments = db.prepare(`SELECT p.*, n.item_description, n.quantity, b.name AS buyer_name, s.name AS seller_name
      FROM payment_intents p JOIN negotiations n ON n.id=p.negotiation_id
      JOIN agents b ON b.id=p.buyer_agent_id JOIN agents s ON s.id=p.seller_agent_id
      ${where} ORDER BY p.created_at DESC`).all(...params);
    res.json({ count: payments.length, payments });
  } catch { fail(res, 500, "PAYMENTS_UNAVAILABLE", "Unable to retrieve payments."); }
});
router.get("/:id", (req, res) => {
  const payment = service.getPayment(req.params.id);
  if (!payment) return fail(res, 404, "PAYMENT_NOT_FOUND", "Payment not found.");
  const events = db.prepare("SELECT id,type,created_at FROM payment_events WHERE payment_id=? ORDER BY created_at").all(payment.id);
  const negotiation = db.prepare("SELECT id,item_description,quantity,final_price,status FROM negotiations WHERE id=?").get(payment.negotiation_id);
  res.json({ payment, events, negotiation });
});
router.post("/:id/retry", retryLimiter, async (req, res) => {
  const payment = service.getPayment(req.params.id);
  if (!payment) return fail(res, 404, "PAYMENT_NOT_FOUND", "Payment not found.");
  if (payment.status !== "failed") return fail(res, 409, "RETRY_NOT_ALLOWED", "Only failed payments can be retried.");
  if (payment.failure_reason === "Timed out waiting for M-Pesa") return fail(res, 409, "MANUAL_RECONCILIATION_REQUIRED", "Do not retry until you confirm whether money was deducted.");
  try {
    const updated = await service.createAndInitiatePayment(payment.negotiation_id, req.body?.phone || "", { allowRetry: true });
    res.json({ payment: updated });
  } catch (e) { fail(res, 400, e.code || "RETRY_FAILED", e.message || "Unable to retry payment."); }
});
router.post("/:id/cancel", (req, res) => {
  const payment = service.getPayment(req.params.id);
  if (!payment) return fail(res, 404, "PAYMENT_NOT_FOUND", "Payment not found.");
  return fail(res, 501, "PROVIDER_CANCEL_UNSUPPORTED", "PayHero cancellation is not available through the verified API contract.");
});
router.post("/callback/:secret", (req, res) => {
  const expected = process.env.PAYHERO_CALLBACK_SECRET || "";
  const received = req.params.secret || "";
  if (!expected || received.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected))) return res.status(200).json({ received: true });
  res.status(200).json({ received: true });
  setImmediate(async () => {
    try { await service.handleCallback(req.body); }
    catch (e) { console.error("Payment callback rejected:", e.code || "CALLBACK_ERROR"); }
  });
});
module.exports = router;
