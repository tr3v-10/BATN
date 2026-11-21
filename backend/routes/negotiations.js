const express = require("express");
const { randomUUID } = require("crypto");
const db = require("../database/db");
const { assessRisk, saveRiskAssessment } = require("../services/riskengine");

const router = express.Router();

// ======================================================
// HELPER: CHECK WHETHER AN ITEM IS ALLOWED
// ======================================================
function isItemAllowed(allowedItems, itemDescription) {
  if (allowedItems === "*") return true;

  try {
    const items = JSON.parse(allowedItems);

    return items.some(
      item => item.toLowerCase() === itemDescription.trim().toLowerCase()
    );
  } catch {
    return false;
  }
}


// ======================================================
// GET: RETRIEVE ALL NEGOTIATIONS
// ======================================================
router.get("/", (req, res) => {
  try {
    const negotiations = db.prepare(`
      SELECT
        n.*,
        buyer.name AS buyer_name,
        seller.name AS seller_name
      FROM negotiations n
      JOIN agents buyer ON buyer.id = n.buyer_agent_id
      JOIN agents seller ON seller.id = n.seller_agent_id
      ORDER BY n.created_at DESC
    `).all();

    res.json({
      system: "BATN Negotiation Engine",
      status: "online",
      count: negotiations.length,
      negotiations
    });

  } catch (error) {
    console.error("Negotiation retrieval error:", error.message);

    res.status(500).json({
      error: "Unable to retrieve negotiations."
    });
  }
});


// ======================================================
// POST: PROCESS A MANDATE-CONTROLLED NEGOTIATION
// ======================================================
router.post("/", (req, res) => {
  try {

    const {
      buyer_agent_id,
      seller_agent_id,
      item_description,
      quantity,
      initial_offer
    } = req.body;


    // --------------------------------------------------
    // 1. VALIDATE REQUEST
    // --------------------------------------------------

    if (
      !buyer_agent_id ||
      !seller_agent_id ||
      typeof item_description !== "string" ||
      !item_description.trim() ||
      !Number.isInteger(quantity) ||
      quantity <= 0 ||
      !Number.isFinite(initial_offer) ||
      initial_offer <= 0
    ) {
      return res.status(400).json({
        error: "Invalid negotiation request."
      });
    }

    if (buyer_agent_id === seller_agent_id) {
      return res.status(400).json({
        error: "An agent cannot negotiate with itself."
      });
    }


    // --------------------------------------------------
    // 2. RETRIEVE AGENTS
    // --------------------------------------------------

    const buyer = db.prepare(`
      SELECT id, name, role, status
      FROM agents
      WHERE id = ?
    `).get(buyer_agent_id);

    const seller = db.prepare(`
      SELECT id, name, role, status
      FROM agents
      WHERE id = ?
    `).get(seller_agent_id);

    if (!buyer || !seller) {
      return res.status(404).json({
        error: "One or both agents do not exist."
      });
    }

    if (buyer.role !== "buyer" || seller.role !== "seller") {
      return res.status(400).json({
        error: "A buyer agent and a seller agent are required."
      });
    }

    if (buyer.status !== "active" || seller.status !== "active") {
      return res.status(403).json({
        error: "Both agents must be active."
      });
    }


    // --------------------------------------------------
    // 3. RETRIEVE OWNER-DEFINED MANDATES
    // --------------------------------------------------

    const buyerMandate = db.prepare(`
      SELECT *
      FROM agent_mandates
      WHERE agent_id = ?
    `).get(buyer_agent_id);

    const sellerMandate = db.prepare(`
      SELECT *
      FROM agent_mandates
      WHERE agent_id = ?
    `).get(seller_agent_id);

    if (!buyerMandate || !sellerMandate) {
      return res.status(403).json({
        error: "Both agents must have saved mandates before negotiating."
      });
    }


    // --------------------------------------------------
    // 4. CHECK PRODUCT RESTRICTIONS
    // --------------------------------------------------

    if (
      !isItemAllowed(
        buyerMandate.allowed_items,
        item_description
      )
    ) {
      return res.status(403).json({
        error: "Buyer agent is not authorized to purchase this item."
      });
    }

    if (
      !isItemAllowed(
        sellerMandate.allowed_items,
        item_description
      )
    ) {
      return res.status(403).json({
        error: "Seller agent is not authorized to sell this item."
      });
    }


    // --------------------------------------------------
    // 5. CHECK QUANTITY RESTRICTIONS
    // --------------------------------------------------

    if (quantity > buyerMandate.max_quantity) {
      return res.status(403).json({
        error: "Quantity exceeds the buyer's mandate."
      });
    }

    if (quantity > sellerMandate.max_quantity) {
      return res.status(403).json({
        error: "Quantity exceeds the seller's mandate."
      });
    }


    // --------------------------------------------------
    // 6. READ PRICE LIMITS FROM THE DATABASE
    // --------------------------------------------------

    const buyerMaxPrice = buyerMandate.max_unit_price;
    const sellerMinPrice = sellerMandate.min_unit_price;

    if (
      !Number.isFinite(buyerMaxPrice) ||
      !Number.isFinite(sellerMinPrice) ||
      buyerMaxPrice <= 0 ||
      sellerMinPrice <= 0
    ) {
      return res.status(403).json({
        error: "Agent mandates contain invalid price limits."
      });
    }


    // BUYER CANNOT OFFER ABOVE THEIR SAVED LIMIT

    if (initial_offer > buyerMaxPrice) {
      return res.status(403).json({
        error: "Initial offer exceeds the buyer's authorized unit price."
      });
    }


    // --------------------------------------------------
    // 7. NEGOTIATION DECISION
    // --------------------------------------------------

    let negotiationStatus;
    let candidatePrice = null;
    let responseMessage;
    let responseType;
    let responsePrice = null;

    if (initial_offer >= sellerMinPrice) {

      candidatePrice = initial_offer;
      negotiationStatus = "accepted";
      responseType = "acceptance";
      responseMessage = "Seller accepted the buyer's offer.";
      responsePrice = initial_offer;

    } else if (sellerMinPrice <= buyerMaxPrice) {

      candidatePrice = sellerMinPrice;
      negotiationStatus = "accepted";
      responseType = "counteroffer_accepted";
      responseMessage =
        "Seller counteroffer is within the buyer's authorized price limit.";
      responsePrice = sellerMinPrice;

    } else {

      negotiationStatus = "rejected";
      responseType = "rejection";
      responseMessage =
        "Seller's minimum price exceeds the buyer's authorized maximum.";
    }


    // --------------------------------------------------
    // 8. CHECK TOTAL TRANSACTION LIMITS
    // --------------------------------------------------

    if (candidatePrice !== null) {

      const totalAmount = candidatePrice * quantity;

      if (totalAmount > buyerMandate.max_total_amount) {
        return res.status(403).json({
          error: "Transaction exceeds the buyer's total spending mandate.",
          calculated_total: totalAmount,
          buyer_limit: buyerMandate.max_total_amount
        });
      }

      if (totalAmount > sellerMandate.max_total_amount) {
        return res.status(403).json({
          error: "Transaction exceeds the seller's transaction mandate.",
          calculated_total: totalAmount,
          seller_limit: sellerMandate.max_total_amount
        });
      }
    }


    // --------------------------------------------------
    // 9. REQUIRE HUMAN APPROVAL WHEN MANDATES DEMAND IT
    // --------------------------------------------------

    const requiresApproval =
      buyerMandate.requires_approval === 1 ||
      sellerMandate.requires_approval === 1;

    let finalPrice = candidatePrice;

    if (
      negotiationStatus === "accepted" &&
      requiresApproval
    ) {
      negotiationStatus = "pending_approval";
      finalPrice = null;
      responseType = "approval_required";
      responseMessage =
        "Negotiation reached a proposed agreement but requires human approval.";
    }


    // --------------------------------------------------
    // 10. CREATE NEGOTIATION ID
    // --------------------------------------------------

    const negotiationId = randomUUID();


    // --------------------------------------------------
    // 10.1 RISK ASSESSMENT
    // --------------------------------------------------

    let riskAssessment = null;

    if (candidatePrice !== null) {

      riskAssessment = assessRisk({
        id: negotiationId,
        buyer_agent_id,
        seller_agent_id,
        item_description: item_description.trim(),
        quantity,
        total_amount: candidatePrice * quantity,
        buyer_status: buyer.status,
        seller_status: seller.status,
        buyer_max_total: buyerMandate.max_total_amount,
        seller_max_total: sellerMandate.max_total_amount
      });


      // APPLY RISK DECISION

      if (riskAssessment.decision === "block") {

        negotiationStatus = "blocked";
        finalPrice = null;
        responseType = "risk_block";
        responseMessage =
          "Negotiation blocked by BATN risk engine.";

      } else if (riskAssessment.decision === "review") {

        negotiationStatus = "pending_risk_review";
        finalPrice = null;
        responseType = "risk_review";
        responseMessage =
          "Negotiation flagged for human risk review.";
      }
    }


    // --------------------------------------------------
    // 11. SAVE SESSION, NEGOTIATION, MESSAGES AND RISK
    // --------------------------------------------------

    const saveNegotiation = db.transaction(() => {

      // CREATE LEGACY NEGOTIATION SESSION

      db.prepare(`
        INSERT INTO negotiation_sessions (
          id,
          buyer_agent_id,
          seller_agent_id,
          status,
          agreed_amount,
          currency,
          description
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        negotiationId,
        buyer_agent_id,
        seller_agent_id,
        negotiationStatus,
        finalPrice,
        "KES",
        item_description.trim()
      );


      // CREATE MAIN NEGOTIATION RECORD

      db.prepare(`
        INSERT INTO negotiations (
          id,
          buyer_agent_id,
          seller_agent_id,
          item_description,
          quantity,
          buyer_max_price,
          seller_min_price,
          initial_offer,
          final_price,
          status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        negotiationId,
        buyer_agent_id,
        seller_agent_id,
        item_description.trim(),
        quantity,
        buyerMaxPrice,
        sellerMinPrice,
        initial_offer,
        finalPrice,
        negotiationStatus
      );


      // RECORD BUYER'S PROPOSAL

      db.prepare(`
        INSERT INTO negotiation_messages (
          id,
          session_id,
          sender_agent_id,
          message_type,
          message,
          proposed_amount
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        negotiationId,
        buyer_agent_id,
        "proposal",
        `Buyer proposed KES ${initial_offer} per unit for ${quantity} units of ${item_description.trim()}.`,
        initial_offer
      );


      // RECORD SELLER'S RESPONSE

      db.prepare(`
        INSERT INTO negotiation_messages (
          id,
          session_id,
          sender_agent_id,
          message_type,
          message,
          proposed_amount
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        negotiationId,
        seller_agent_id,
        responseType,
        responseMessage,
        responsePrice
      );


      // SAVE RISK ASSESSMENT

      if (riskAssessment) {
        saveRiskAssessment(riskAssessment);
      }

    });


    // EXECUTE DATABASE TRANSACTION

    saveNegotiation();


    // --------------------------------------------------
    // 12. RETURN RESULT
    // --------------------------------------------------

    res.status(201).json({
      message: "Negotiation processed.",
      negotiation_id: negotiationId,
      buyer: buyer.name,
      seller: seller.name,
      item_description: item_description.trim(),
      quantity,
      buyer_authorized_max_price: buyerMaxPrice,
      seller_authorized_min_price: sellerMinPrice,
      initial_offer,
      proposed_agreement_price: candidatePrice,
      final_price: finalPrice,
      total_amount: candidatePrice === null
        ? null
        : candidatePrice * quantity,
      requires_approval: requiresApproval,
      status: negotiationStatus,
      risk_assessment: riskAssessment
        ? {
            score: riskAssessment.risk_score,
            level: riskAssessment.risk_level,
            flags: riskAssessment.flags,
            decision: riskAssessment.decision
          }
        : null
    });


  } catch (error) {

    console.error("Negotiation error:", error.message);

    res.status(500).json({
      error: "Unable to process negotiation.",
      details: error.message
    });

  }
});


// ======================================================
// GET: RETRIEVE NEGOTIATION MESSAGES
// ======================================================
router.get("/:id/messages", (req, res) => {
  try {

    const messages = db.prepare(`
      SELECT
        negotiation_messages.*,
        agents.name AS agent_name,
        agents.role AS agent_role
      FROM negotiation_messages
      LEFT JOIN agents
        ON negotiation_messages.sender_agent_id = agents.id
      WHERE negotiation_messages.session_id = ?
      ORDER BY negotiation_messages.created_at ASC
    `).all(req.params.id);

    res.json({
      negotiation_id: req.params.id,
      count: messages.length,
      messages
    });

  } catch (error) {

    console.error("Message retrieval error:", error.message);

    res.status(500).json({
      error: "Unable to retrieve negotiation messages."
    });

  }
});


// ======================================================
// EXPORT ROUTER
// ======================================================
module.exports = router;