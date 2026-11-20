
const express = require("express");
const { randomUUID } = require("crypto");
const db = require("../database/db");

const router = express.Router();

function mapPaymentStatus(status) {
  const map = {
    pending: "payment_pending",
    initiated: "payment_initiated",
    processing: "payment_processing",
    paid: "completed",
    failed: "payment_failed",
    cancelled: "cancelled"
  };

  return map[status] || "agreement_reached";
}

// CREATE OR SYNCHRONIZE TRACKING RECORD
function syncTracking(payment) {
  const tracking = db.prepare(`
    SELECT * FROM transaction_tracking
    WHERE negotiation_id = ?
  `).get(payment.negotiation_id);

  const mappedStatus = mapPaymentStatus(payment.status);

  if (!tracking) {
    const trackingId = randomUUID();

    db.prepare(`
      INSERT INTO transaction_tracking (
        id, negotiation_id, payment_intent_id, transaction_status
      )
      VALUES (?, ?, ?, ?)
    `).run(
      trackingId,
      payment.negotiation_id,
      payment.id,
      mappedStatus
    );

    db.prepare(`
      INSERT INTO transaction_events (
        id, tracking_id, event_type, description
      )
      VALUES (?, ?, ?, ?)
    `).run(
      randomUUID(),
      trackingId,
      "tracking_created",
      `Transaction tracking created. Current payment status: ${payment.status}`
    );

    return trackingId;
  }

  // Sync status if it changed
  if (tracking.transaction_status !== mappedStatus) {
    db.prepare(`
      UPDATE transaction_tracking
      SET payment_intent_id = ?,
          transaction_status = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(payment.id, mappedStatus, tracking.id);

    db.prepare(`
      INSERT INTO transaction_events (
        id, tracking_id, event_type, description
      )
      VALUES (?, ?, ?, ?)
    `).run(
      randomUUID(),
      tracking.id,
      "status_synchronized",
      `Payment status synchronized to ${payment.status}`
    );
  }

  return tracking.id;
}

// GET ALL TRACKED TRANSACTIONS
router.get("/", (req, res) => {
  try {
    const payments = db.prepare(`
      SELECT * FROM payment_intents
    `).all();

    payments.forEach(syncTracking);

    const records = db.prepare(`
      SELECT t.*,
             n.item_description,
             n.quantity,
             n.final_price,
             p.amount,
             p.currency,
             p.provider,
             p.provider_reference,
             p.status AS payment_status,
             b.name AS buyer_name,
             s.name AS seller_name
      FROM transaction_tracking t
      JOIN negotiations n ON n.id = t.negotiation_id
      LEFT JOIN payment_intents p ON p.id = t.payment_intent_id
      JOIN agents b ON b.id = n.buyer_agent_id
      JOIN agents s ON s.id = n.seller_agent_id
      ORDER BY t.created_at DESC
    `).all();

    res.json({
      count: records.length,
      transactions: records
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Could not retrieve transactions."
    });
  }
});

// GET ONE TRANSACTION AND ITS TIMELINE
router.get("/:id", (req, res) => {
  try {
    const payment = db.prepare(`
      SELECT * FROM payment_intents
      WHERE negotiation_id = ? OR id = ?
    `).get(req.params.id, req.params.id);

    if (payment) {
      syncTracking(payment);
    }

    const tracking = db.prepare(`
      SELECT t.*,
             n.item_description,
             n.quantity,
             n.final_price,
             p.amount,
             p.currency,
             p.provider,
             p.provider_reference,
             p.status AS payment_status,
             b.name AS buyer_name,
             s.name AS seller_name
      FROM transaction_tracking t
      JOIN negotiations n ON n.id = t.negotiation_id
      LEFT JOIN payment_intents p ON p.id = t.payment_intent_id
      JOIN agents b ON b.id = n.buyer_agent_id
      JOIN agents s ON s.id = n.seller_agent_id
      WHERE t.negotiation_id = ? OR t.id = ?
    `).get(req.params.id, req.params.id);

    if (!tracking) {
      return res.status(404).json({
        message: "Transaction not found."
      });
    }

    const events = db.prepare(`
      SELECT * FROM transaction_events
      WHERE tracking_id = ?
      ORDER BY created_at ASC
    `).all(tracking.id);

    res.json({
      transaction: tracking,
      timeline: events
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Could not retrieve transaction."
    });
  }
});

module.exports = router;
