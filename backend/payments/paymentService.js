const { randomUUID } = require("crypto");
const db = require("../database/db");
const { createPaymentProvider } = require("./providers");
const { normalizeKenyanPhone, maskKenyanPhone, validateKesAmount } = require("./phone");
const ProviderError = require("./providers/ProviderError");

const provider = createPaymentProvider();
const transitions = {
  pending: ["initiated", "failed", "cancelled"],
  initiated: ["processing", "paid", "failed", "cancelled"],
  processing: ["paid", "failed", "cancelled"],
  paid: [],
  failed: ["pending"],
  cancelled: []
};
const FINAL = new Set(["paid", "failed", "cancelled"]);

function addEvent(paymentId, type, payload = null) {
  db.prepare(`
    INSERT INTO payment_events (id, payment_id, type, raw_payload)
    VALUES (?, ?, ?, ?)
  `).run(randomUUID(), paymentId, type, payload == null ? null : JSON.stringify(payload));
  audit(paymentId, "payment_event_" + type, {});
}

function audit(paymentId, action, details = {}) {
  db.prepare(`
    INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), "JADILI Payment Service", action, "payment_intent", paymentId, JSON.stringify(details));
}

function transition(payment, next, fields = {}) {
  if (!transitions[payment.status] || !transitions[payment.status].includes(next)) {
    addEvent(payment.id, "invalid_transition", { from: payment.status, to: next });
    throw Object.assign(new Error("Invalid payment status transition."), { code: "INVALID_TRANSITION" });
  }
  const updated = { ...payment, ...fields, status: next };
  const assignments = ["status = ?", "updated_at = CURRENT_TIMESTAMP"];
  const values = [next];
  for (const [key, value] of Object.entries(fields)) {
    assignments.push(key + " = ?");
    values.push(value);
  }
  values.push(payment.id);
  db.prepare("UPDATE payment_intents SET " + assignments.join(", ") + " WHERE id = ?").run(...values);
  addEvent(payment.id, "status_" + next, fields);
  audit(payment.id, "payment_" + next, fields);
  return updated;
}

function getPayment(id) {
  return db.prepare("SELECT * FROM payment_intents WHERE id = ?").get(id);
}

function eligibleNegotiation(negotiationId) {
  const negotiation = db.prepare("SELECT * FROM negotiations WHERE id = ?").get(negotiationId);
  if (!negotiation) throw Object.assign(new Error("Negotiation not found."), { code: "NEGOTIATION_NOT_FOUND" });
  if (negotiation.status !== "accepted" || !Number.isFinite(negotiation.final_price) || negotiation.final_price <= 0) {
    throw Object.assign(new Error("Only accepted and fully approved deals can be paid."), { code: "NEGOTIATION_NOT_PAYABLE" });
  }

  const risk = db.prepare("SELECT decision, reviewed FROM risk_assessments WHERE negotiation_id = ?").get(negotiationId);
  if (risk && (risk.decision !== "allow" || (risk.reviewed === 0 && risk.decision === "review"))) {
    throw Object.assign(new Error("This deal has not cleared risk review."), { code: "RISK_REVIEW_REQUIRED" });
  }

  // Negotiation status is the authoritative workflow gate here.
  // The owner-approval endpoint only transitions a pending_approval deal
  // to accepted after validating the owner's registered email and writing
  // the approval audit record. A mandate's requires_approval flag describes
  // whether approval was needed; it must not block payment after the deal
  // has legitimately reached accepted status.
  return negotiation;
}

async function createAndInitiatePayment(negotiationId, phone, options = {}) {
  const normalizedPhone = normalizeKenyanPhone(phone);
  const negotiation = eligibleNegotiation(negotiationId);
  const amount = validateKesAmount(negotiation.final_price * negotiation.quantity);
  if (!Number.isSafeInteger(amount)) throw new Error("Payment amount is outside the supported range.");

  let payment = db.prepare("SELECT * FROM payment_intents WHERE negotiation_id = ?").get(negotiationId);
  if (payment && ["initiated", "processing", "paid"].includes(payment.status)) return payment;
  if (payment && payment.status === "cancelled") {
    throw Object.assign(new Error("This payment was cancelled. Contact support before trying again."), { code: "PAYMENT_CANCELLED" });
  }

  if (!payment) {
    const id = randomUUID();
    const key = negotiationId + ":attempt:1";
    db.prepare(`
      INSERT INTO payment_intents (
        id, negotiation_id, buyer_agent_id, seller_agent_id, amount,
        currency, provider, idempotency_key, status, phone, attempt_count
      ) VALUES (?, ?, ?, ?, ?, 'KES', ?, ?, 'pending', ?, 1)
    `).run(id, negotiation.id, negotiation.buyer_agent_id, negotiation.seller_agent_id,
      amount, process.env.PAYMENT_PROVIDER || "mock", key, maskKenyanPhone(normalizedPhone));
    payment = getPayment(id);
    addEvent(id, "created", { negotiationId, amount, provider: payment.provider });
    audit(id, "payment_created", { negotiationId, amount, provider: payment.provider });
  } else {
    if (payment.status !== "failed") return payment;
    if (!options.allowRetry) return payment;
    if (payment.failure_reason === "Timed out waiting for M-Pesa") {
      throw Object.assign(new Error("Payment outcome needs manual reconciliation. Do not retry until you confirm whether money was deducted."), { code: "MANUAL_RECONCILIATION_REQUIRED" });
    }
    if (payment.amount !== amount) throw new Error("Deal amount changed after the original payment attempt.");
    const nextAttempt = (payment.attempt_count || 1) + 1;
    transition(payment, "pending", {
      provider: process.env.PAYMENT_PROVIDER || "mock",
      idempotency_key: negotiationId + ":attempt:" + nextAttempt,
      phone: maskKenyanPhone(normalizedPhone),
      failure_reason: null,
      provider_reference: null,
      checkout_request_id: null,
      mpesa_receipt: null,
      initiated_at: null,
      completed_at: null,
      callback_received_at: null,
      attempt_count: nextAttempt
    });
    payment = getPayment(payment.id);
    addEvent(payment.id, "retried", { attempt: nextAttempt });
    audit(payment.id, "payment_retried", { attempt: nextAttempt });
  }

  try {
    const result = await provider.initiatePayment({
      paymentId: payment.id, amount, phone: normalizedPhone
    });
    const current = getPayment(payment.id);
    const updated = transition(current, "initiated", {
      provider_reference: result.reference,
      checkout_request_id: result.checkoutRequestId,
      initiated_at: new Date().toISOString()
    });
    addEvent(payment.id, "prompt_sent", { reference: result.reference, providerResponse: result.raw });
    audit(payment.id, "payment_prompt_sent", { phone: payment.phone, amount });
    syncTracking(getPayment(payment.id));
    return getPayment(payment.id);
  } catch (error) {
    const current = getPayment(payment.id);
    if (error instanceof ProviderError && error.ambiguous) {
      addEvent(payment.id, "initiation_unconfirmed", { code: error.code });
      return current;
    }
    if (current.status === "pending") {
      transition(current, "failed", { failure_reason: error.message, completed_at: new Date().toISOString() });
      syncTracking(getPayment(payment.id));
    }
    throw error;
  }
}

function syncTracking(payment) {
  const map = {
    pending: "payment_pending", initiated: "payment_initiated",
    processing: "payment_processing", paid: "completed",
    failed: "payment_failed", cancelled: "cancelled"
  };
  const next = map[payment.status] || "agreement_reached";
  let tracking = db.prepare("SELECT * FROM transaction_tracking WHERE negotiation_id = ?").get(payment.negotiation_id);
  if (!tracking) {
    const id = randomUUID();
    db.prepare(`
      INSERT INTO transaction_tracking (id, negotiation_id, payment_intent_id, transaction_status)
      VALUES (?, ?, ?, ?)
    `).run(id, payment.negotiation_id, payment.id, next);
    tracking = { id };
  } else {
    db.prepare(`
      UPDATE transaction_tracking SET payment_intent_id = ?, transaction_status = ?,
        updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(payment.id, next, tracking.id);
  }
  db.prepare(`
    INSERT INTO transaction_events (id, tracking_id, event_type, description)
    VALUES (?, ?, ?, ?)
  `).run(randomUUID(), tracking.id, "payment_" + payment.status,
    "Payment " + payment.status + " (" + payment.provider + ")");
}

async function handleCallback(payload) {
  const parsed = provider.parseCallback(payload);
  const payment = getPayment(parsed.externalReference);
  if (!payment) throw Object.assign(new Error("Unknown payment reference."), { code: "PAYMENT_NOT_FOUND" });
  if (Number(parsed.amount) !== Number(payment.amount)) {
    addEvent(payment.id, "callback_amount_mismatch", payload);
    audit(payment.id, "payment_callback_rejected", { reason: "amount_mismatch" });
    throw Object.assign(new Error("Payment amount mismatch."), { code: "AMOUNT_MISMATCH" });
  }

  if (payment.status === "paid") return payment;
  const callbackJson = JSON.stringify(payload);
  const duplicate = db.prepare("SELECT 1 FROM payment_events WHERE payment_id = ? AND type = ? AND raw_payload = ?").get(payment.id, "callback_received", callbackJson);
  if (duplicate) return payment;
  addEvent(payment.id, "callback_received", payload);
  db.prepare("UPDATE payment_intents SET callback_received_at = CURRENT_TIMESTAMP WHERE id = ?").run(payment.id);

  const status = String(parsed.status || "").toUpperCase();
  let next = null;
  if (status === "SUCCESS" || status === "SUCCESSFUL" || Number(parsed.resultCode) === 0) {
    const confirmed = await provider.getStatus(payment.provider_reference);
    addEvent(payment.id, "status_checked", confirmed);
    const confirmedStatus = String(confirmed.status || confirmed.Status || "").toUpperCase();
    if (confirmedStatus !== "SUCCESS") {
      if (payment.status === "initiated") transition(payment, "processing");
      return getPayment(payment.id);
    }
    next = "paid";
  } else if (status === "FAILED" || status === "FAILURE") {
    next = "failed";
  } else if (status === "CANCELLED" || status === "CANCELED") {
    next = "cancelled";
  } else if (status === "PROCESSING" || status === "QUEUED") {
    next = "processing";
  } else {
    addEvent(payment.id, "callback_unmapped_status", { status: parsed.status });
    return payment;
  }

  const latest = getPayment(payment.id);
  if (latest.status === next) return latest;
  const fields = {};
  if (next === "paid") {
    fields.mpesa_receipt = parsed.mpesaReceiptNumber;
    fields.completed_at = new Date().toISOString();
    fields.failure_reason = null;
  } else if (next === "failed" || next === "cancelled") {
    fields.failure_reason = parsed.resultDesc || ("PayHero reported " + next);
    fields.completed_at = new Date().toISOString();
  }
  const updated = transition(latest, next, fields);
  syncTracking(getPayment(payment.id));
  return updated;
}

async function reconcile() {
  const rows = db.prepare(`
    SELECT * FROM payment_intents
    WHERE status IN ('initiated', 'processing')
      AND initiated_at IS NOT NULL
      AND julianday(initiated_at) <= julianday('now', '-2 minutes')
  `).all();

  for (const payment of rows) {
    const ageMs = Date.now() - new Date(payment.initiated_at).getTime();
    if (ageMs >= 10 * 60 * 1000) {
      const current = getPayment(payment.id);
      if (!FINAL.has(current.status)) {
        transition(current, "failed", {
          failure_reason: "Timed out waiting for M-Pesa",
          completed_at: new Date().toISOString()
        });
        addEvent(payment.id, "reconciliation_timeout");
        syncTracking(getPayment(payment.id));
      }
      continue;
    }

    try {
      const status = await provider.getStatus(payment.provider_reference);
      addEvent(payment.id, "status_checked", status);
      const value = String(status.status || status.Status || "").toUpperCase();
      if (value === "SUCCESS") {
        // A status lookup is the authoritative confirmation.
        const current = getPayment(payment.id);
        if (current.status !== "paid") {
          transition(current, "paid", {
            mpesa_receipt: status.MpesaReceiptNumber || status.mpesaReceiptNumber || null,
            completed_at: new Date().toISOString()
          });
          syncTracking(getPayment(payment.id));
        }
      } else if (value === "FAILED") {
        const current = getPayment(payment.id);
        if (["initiated", "processing"].includes(current.status)) {
          transition(current, "failed", { failure_reason: "PayHero reported failed", completed_at: new Date().toISOString() });
          syncTracking(getPayment(payment.id));
        }
      } else {
        if (payment.status === "initiated") {
          transition(getPayment(payment.id), "processing");
          syncTracking(getPayment(payment.id));
        }
      }
    } catch (error) {
      addEvent(payment.id, "status_check_error", { code: error.code || "STATUS_ERROR" });
    }
  }
}

module.exports = {
  createAndInitiatePayment, handleCallback, reconcile, getPayment,
  provider, transitions, transition, syncTracking, addEvent, audit
};
