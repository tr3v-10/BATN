
const express = require("express");
const { randomUUID } = require("crypto");
const db = require("../database/db");

const router = express.Router();

// VALID PAYMENT STATUS TRANSITIONS
const transitions = {
  pending: ["initiated", "cancelled"],
  initiated: ["processing", "failed", "cancelled"],
  processing: ["paid", "failed"],
  paid: [],
  failed: [],
  cancelled: []
};

// CREATE PAYMENT INTENT
router.post("/initiate", (req, res) => {
  try {
    const { negotiation_id, idempotency_key } = req.body || {};

    if (!negotiation_id || !idempotency_key) {
      return res.status(400).json({
        message: "negotiation_id and idempotency_key are required."
      });
    }

    const existing = db.prepare(`
      SELECT * FROM payment_intents
      WHERE negotiation_id = ?
    `).get(negotiation_id);

    if (existing) {
      return res.status(409).json({
        message: "A payment intent already exists.",
        payment: existing
      });
    }

    const negotiation = db.prepare(`
      SELECT * FROM negotiations WHERE id = ?
    `).get(negotiation_id);

    if (!negotiation) {
      return res.status(404).json({
        message: "Negotiation not found."
      });
    }

    if (negotiation.status !== "accepted") {
      return res.status(403).json({
        message: "Negotiation must be accepted before payment."
      });
    }

    if (!negotiation.final_price || negotiation.final_price <= 0) {
      return res.status(400).json({
        message: "Negotiation has no valid final price."
      });
    }

    const buyer = db.prepare(`
      SELECT a.status, m.max_total_amount, m.max_quantity,
             m.requires_approval
      FROM agents a
      JOIN agent_mandates m ON m.agent_id = a.id
      WHERE a.id = ?
    `).get(negotiation.buyer_agent_id);

    const seller = db.prepare(`
      SELECT a.status, m.max_total_amount, m.max_quantity,
             m.requires_approval
      FROM agents a
      JOIN agent_mandates m ON m.agent_id = a.id
      WHERE a.id = ?
    `).get(negotiation.seller_agent_id);

    if (!buyer || !seller) {
      return res.status(403).json({
        message: "Both agents must have valid mandates."
      });
    }

    if (buyer.status !== "active" || seller.status !== "active") {
      return res.status(403).json({
        message: "Both agents must be active."
      });
    }

    const totalAmount =
      negotiation.final_price * negotiation.quantity;

    if (
      negotiation.quantity > buyer.max_quantity ||
      negotiation.quantity > seller.max_quantity ||
      totalAmount > buyer.max_total_amount ||
      totalAmount > seller.max_total_amount
    ) {
      return res.status(403).json({
        message: "Transaction exceeds mandate limits."
      });
    }

    if (buyer.requires_approval || seller.requires_approval) {
      return res.status(403).json({
        message: "Owner approval is required."
      });
    }

    const paymentId = randomUUID();

    const createPayment = db.transaction(() => {
      db.prepare(`
        INSERT INTO payment_intents (
          id, negotiation_id, buyer_agent_id,
          seller_agent_id, amount, currency,
          provider, idempotency_key, status
        )
        VALUES (?, ?, ?, ?, ?, 'KES', 'mock', ?, 'pending')
      `).run(
        paymentId,
        negotiation.id,
        negotiation.buyer_agent_id,
        negotiation.seller_agent_id,
        totalAmount,
        idempotency_key
      );

      db.prepare(`
        INSERT INTO audit_logs (
          id, actor, action, entity_type,
          entity_id, details
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        "BATN Payment Engine",
        "payment_intent_created",
        "payment_intent",
        paymentId,
        JSON.stringify({
          negotiation_id: negotiation.id,
          amount: totalAmount,
          provider: "mock"
        })
      );
    });

    createPayment();

    const payment = db.prepare(`
      SELECT * FROM payment_intents WHERE id = ?
    `).get(paymentId);

    return res.status(201).json({
      message: "Simulated payment intent created.",
      payment
    });

  } catch (error) {
    console.error("Payment initiation error:", error);

    return res.status(500).json({
      message: "Payment initiation failed.",
      error: error.message,
      code: error.code || null
    });
  }
});

// GET ALL PAYMENT INTENTS
router.get("/", (req, res) => {
  try {
    const payments = db.prepare(`
      SELECT p.*, 
             n.item_description, n.quantity,
             a.name AS buyer_name,
             s.name AS seller_name
      FROM payment_intents p
      JOIN negotiations n ON n.id = p.negotiation_id
      JOIN agents a ON a.id = p.buyer_agent_id
      JOIN agents s ON s.id = p.seller_agent_id
      ORDER BY p.created_at DESC
    `).all();

    res.json({
      count: payments.length,
      payments
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Could not retrieve payments."
    });
  }
});

// GET SINGLE PAYMENT
router.get("/:id", (req, res) => {
  try {
    const payment = db.prepare(`
      SELECT * FROM payment_intents WHERE id = ?
    `).get(req.params.id);

    if (!payment) {
      return res.status(404).json({
        message: "Payment not found."
      });
    }

    res.json({ payment });

  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Could not retrieve payment."
    });
  }
});

// SIMULATE PAYMENT STATUS TRANSITION
router.patch("/:id/status", (req, res) => {
  try {
    const { status, note } = req.body || {};

    const payment = db.prepare(`
      SELECT * FROM payment_intents WHERE id = ?
    `).get(req.params.id);

    if (!payment) {
      return res.status(404).json({
        message: "Payment not found."
      });
    }

    // Simulated provider only
    if (payment.provider !== "mock") {
      return res.status(403).json({
        message: "Manual status updates are disabled for real providers."
      });
    }

    if (!transitions[payment.status]?.includes(status)) {
      return res.status(400).json({
        message: "Invalid payment status transition.",
        current_status: payment.status,
        requested_status: status,
        allowed: transitions[payment.status]
      });
    }

    const updatePayment = db.transaction(() => {
      let providerReference = payment.provider_reference;

      if (status === "initiated" && !providerReference) {
        providerReference = `MOCK-${randomUUID()}`;
      }

      db.prepare(`
        UPDATE payment_intents
        SET status = ?,
            provider_reference = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(status, providerReference, payment.id);

      db.prepare(`
        INSERT INTO audit_logs (
          id, actor, action, entity_type,
          entity_id, details
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        "BATN Mock Payment Simulator",
        "payment_status_changed",
        "payment_intent",
        payment.id,
        JSON.stringify({
          previous_status: payment.status,
          new_status: status,
          note: note || null
        })
      );
    });

    updatePayment();

    const updatedPayment = db.prepare(`
      SELECT * FROM payment_intents WHERE id = ?
    `).get(payment.id);

    res.json({
      message: "Simulated payment status updated.",
      payment: updatedPayment
    });

  } catch (error) {
    console.error("Payment status update error:", error);

    res.status(500).json({
      message: "Could not update payment status.",
      error: error.message
    });
  }
});

module.exports = router;
