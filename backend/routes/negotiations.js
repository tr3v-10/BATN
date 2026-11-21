const express = require("express");
const { randomUUID } = require("crypto");
const db = require("../database/db");
const {
  assessRisk,
  saveRiskAssessment
} = require("../services/riskEngine");

const router = express.Router();

function isItemAllowed(allowedItems, itemDescription) {
  if (!allowedItems || allowedItems === "*") return true;

  try {
    const items = JSON.parse(allowedItems);
    return items.some(
      item =>
        item.toLowerCase() ===
        itemDescription.trim().toLowerCase()
    );
  } catch {
    return false;
  }
}

// GET ALL NEGOTIATIONS
router.get("/", (req, res) => {
  try {
    const negotiations = db.prepare(`
      SELECT n.*,
             b.name AS buyer_name,
             s.name AS seller_name
      FROM negotiations n
      JOIN agents b ON b.id = n.buyer_agent_id
      JOIN agents s ON s.id = n.seller_agent_id
      ORDER BY n.created_at DESC
    `).all();

    res.json({ count: negotiations.length, negotiations });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Could not retrieve negotiations." });
  }
});

// CREATE NEGOTIATION
router.post("/", (req, res) => {
  try {
    const {
      buyer_agent_id,
      seller_agent_id,
      item_description,
      quantity,
      initial_offer
    } = req.body || {};

    if (
      !buyer_agent_id ||
      !seller_agent_id ||
      !item_description ||
      !Number.isInteger(Number(quantity)) ||
      Number(quantity) <= 0 ||
      !Number.isFinite(Number(initial_offer)) ||
      Number(initial_offer) <= 0
    ) {
      return res.status(400).json({
        message: "Valid agent IDs, item, quantity and initial offer are required."
      });
    }

    if (buyer_agent_id === seller_agent_id) {
      return res.status(400).json({
        message: "An agent cannot negotiate with itself."
      });
    }

    const buyer = db.prepare(`
      SELECT * FROM agents WHERE id = ?
    `).get(buyer_agent_id);

    const seller = db.prepare(`
      SELECT * FROM agents WHERE id = ?
    `).get(seller_agent_id);

    if (!buyer || !seller) {
      return res.status(404).json({ message: "One or both agents not found." });
    }

    if (buyer.role !== "buyer" || seller.role !== "seller") {
      return res.status(400).json({
        message: "The selected agents must be a buyer and a seller."
      });
    }

    if (buyer.status !== "active" || seller.status !== "active") {
      return res.status(403).json({ message: "Both agents must be active." });
    }

    const buyerMandate = db.prepare(`
      SELECT * FROM agent_mandates WHERE agent_id = ?
    `).get(buyer_agent_id);

    const sellerMandate = db.prepare(`
      SELECT * FROM agent_mandates WHERE agent_id = ?
    `).get(seller_agent_id);

    if (!buyerMandate || !sellerMandate) {
      return res.status(403).json({
        message: "Both agents must have configured mandates."
      });
    }

    const item = item_description.trim();
    const qty = Number(quantity);
    const offer = Number(initial_offer);

    if (
      !isItemAllowed(buyerMandate.allowed_items, item) ||
      !isItemAllowed(sellerMandate.allowed_items, item)
    ) {
      return res.status(403).json({
        message: "The item is not permitted by one or both mandates."
      });
    }

    if (
      qty > buyerMandate.max_quantity ||
      qty > sellerMandate.max_quantity
    ) {
      return res.status(403).json({
        message: "Quantity exceeds mandate limits."
      });
    }

    if (offer > buyerMandate.max_unit_price) {
      return res.status(403).json({
        message: "Initial offer exceeds buyer's maximum unit price."
      });
    }

    const buyerMax = buyerMandate.max_unit_price;
    const sellerMin = sellerMandate.min_unit_price;

    let finalPrice = null;
    let negotiationStatus = "rejected";
    let responseType = "rejection";
    let responseMessage = "No agreement could be reached.";

    if (offer >= sellerMin) {
      finalPrice = offer;
      negotiationStatus = "accepted";
      responseType = "acceptance";
      responseMessage = "Seller accepted the buyer's offer.";
    } else if (sellerMin <= buyerMax) {
      finalPrice = sellerMin;
      negotiationStatus = "accepted";
      responseType = "counteroffer";
      responseMessage = "Seller countered at its minimum acceptable price.";
    }

    const candidatePrice = finalPrice;
    const candidateTotal = candidatePrice ? candidatePrice * qty : 0;

    if (
      candidatePrice !== null &&
      (
        candidateTotal > buyerMandate.max_total_amount ||
        candidateTotal > sellerMandate.max_total_amount
      )
    ) {
      finalPrice = null;
      negotiationStatus = "rejected";
      responseType = "rejection";
      responseMessage = "Proposed agreement exceeds mandate total limits.";
    }

    let riskAssessment = null;

    if (candidatePrice !== null && negotiationStatus === "accepted") {
      riskAssessment = assessRisk({
        id: randomUUID(),
        buyer_agent_id,
        seller_agent_id,
        item_description: item,
        quantity: qty,
        total_amount: candidateTotal,
        buyer_status: buyer.status,
        seller_status: seller.status,
        buyer_max_total: buyerMandate.max_total_amount,
        seller_max_total: sellerMandate.max_total_amount
      });

      if (riskAssessment.decision === "block") {
        negotiationStatus = "blocked";
        finalPrice = null;
        responseType = "risk_block";
        responseMessage = "Negotiation blocked by BATN risk engine.";
      } else if (riskAssessment.decision === "review") {
        negotiationStatus = "pending_risk_review";
        finalPrice = null;
        responseType = "risk_review";
        responseMessage = "Negotiation flagged for human risk review.";
      }
    }

    if (
      negotiationStatus === "accepted" &&
      (buyerMandate.requires_approval || sellerMandate.requires_approval)
    ) {
      negotiationStatus = "pending_approval";
      finalPrice = null;
      responseType = "approval_required";
      responseMessage = "Owner approval is required before proceeding.";
    }

    const negotiationId = randomUUID();
    const sessionId = randomUUID();

    const saveNegotiation = db.transaction(() => {
      db.prepare(`
        INSERT INTO negotiation_sessions (
          id, buyer_agent_id, seller_agent_id,
          status, agreed_amount, currency, description
        )
        VALUES (?, ?, ?, ?, ?, 'KES', ?)
      `).run(
        sessionId,
        buyer_agent_id,
        seller_agent_id,
        negotiationStatus,
        finalPrice,
        item
      );

      db.prepare(`
        INSERT INTO negotiations (
          id, buyer_agent_id, seller_agent_id,
          item_description, quantity, buyer_max_price,
          seller_min_price, initial_offer, final_price,
          status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        negotiationId,
        buyer_agent_id,
        seller_agent_id,
        item,
        qty,
        buyerMax,
        sellerMin,
        offer,
        finalPrice,
        negotiationStatus
      );

      db.prepare(`
        INSERT INTO negotiation_messages (
          session_id, sender_agent_id, message_type,
          message, proposed_amount
        )
        VALUES (?, ?, ?, ?, ?)
      `).run(
        sessionId,
        buyer_agent_id,
        "proposal",
        `Buyer proposed KES ${offer} per unit for ${qty} ${item}.`,
        offer
      );

      db.prepare(`
        INSERT INTO negotiation_messages (
          session_id, sender_agent_id, message_type,
          message, proposed_amount
        )
        VALUES (?, ?, ?, ?, ?)
      `).run(
        sessionId,
        seller_agent_id,
        responseType,
        responseMessage,
        finalPrice
      );

      if (riskAssessment) {
        riskAssessment.negotiation_id = negotiationId;
        saveRiskAssessment(riskAssessment);
      }

      db.prepare(`
        INSERT INTO audit_logs (
          id, actor, action, entity_type,
          entity_id, details
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        "BATN Negotiation Engine",
        "negotiation_created",
        "negotiation",
        negotiationId,
        JSON.stringify({
          item,
          quantity: qty,
          initial_offer: offer,
          final_price: finalPrice,
          status: negotiationStatus
        })
      );
    });

    saveNegotiation();

    return res.status(201).json({
      message: "Negotiation processed.",
      negotiation: {
        id: negotiationId,
        session_id: sessionId,
        buyer_agent_id,
        seller_agent_id,
        item_description: item,
        quantity: qty,
        initial_offer: offer,
        final_price: finalPrice,
        status: negotiationStatus
      },
      risk: riskAssessment
    });

  } catch (error) {
    console.error("Negotiation error:", error);

    return res.status(500).json({
      message: "Negotiation failed.",
      error: error.message
    });
  }
});

// GET NEGOTIATION MESSAGES
router.get("/:id/messages", (req, res) => {
  try {
    const session = db.prepare(`
      SELECT id FROM negotiation_sessions WHERE id = ?
    `).get(req.params.id);

    const messages = db.prepare(`
      SELECT * FROM negotiation_messages
      WHERE session_id = ?
      ORDER BY created_at ASC
    `).all(req.params.id);

    res.json({ count: messages.length, messages });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Could not retrieve messages." });
  }
});

module.exports = router;