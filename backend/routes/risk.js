const express = require("express");
const db = require("../database/db");
const { randomUUID } = require("crypto");

const router = express.Router();

// ======================================================
// GET ALL RISK ASSESSMENTS
// ======================================================
router.get("/", (req, res) => {
  try {
    const assessments = db.prepare(`
      SELECT
        r.*,
        n.item_description,
        n.quantity,
        n.final_price,
        n.status AS negotiation_status,
        buyer.name AS buyer_name,
        seller.name AS seller_name
      FROM risk_assessments r
      JOIN negotiations n ON n.id = r.negotiation_id
      JOIN agents buyer ON buyer.id = n.buyer_agent_id
      JOIN agents seller ON seller.id = n.seller_agent_id
      ORDER BY r.created_at DESC
    `).all();

    res.json({
      system: "BATN Risk Monitoring",
      count: assessments.length,
      assessments: assessments.map(item => ({
        ...item,
        flags: JSON.parse(item.flags)
      }))
    });

  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Unable to retrieve assessments." });
  }
});


// ======================================================
// GET CRITICAL ASSESSMENTS
// ======================================================
router.get("/critical", (req, res) => {
  try {
    const assessments = db.prepare(`
      SELECT *
      FROM risk_assessments
      WHERE risk_level = 'critical'
        OR decision = 'block'
      ORDER BY created_at DESC
    `).all();

    res.json({
      count: assessments.length,
      assessments: assessments.map(item => ({
        ...item,
        flags: JSON.parse(item.flags)
      }))
    });

  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Unable to retrieve critical assessments." });
  }
});


// ======================================================
// GET NEGOTIATIONS AWAITING HUMAN RISK REVIEW
// ======================================================
router.get("/review-queue", (req, res) => {
  try {
    const queue = db.prepare(`
      SELECT
        r.*,
        n.item_description,
        n.quantity,
        n.initial_offer,
        n.buyer_max_price,
        n.seller_min_price,
        n.buyer_agent_id,
        n.seller_agent_id,
        n.status AS negotiation_status,
        buyer.name AS buyer_name,
        seller.name AS seller_name
      FROM risk_assessments r
      JOIN negotiations n ON n.id = r.negotiation_id
      JOIN agents buyer ON buyer.id = n.buyer_agent_id
      JOIN agents seller ON seller.id = n.seller_agent_id
      WHERE r.decision = 'review'
        AND r.reviewed = 0
        AND n.status = 'pending_risk_review'
      ORDER BY r.created_at ASC
    `).all();

    res.json({
      count: queue.length,
      reviews: queue.map(item => ({
        ...item,
        flags: JSON.parse(item.flags)
      }))
    });

  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Unable to retrieve review queue." });
  }
});


// ======================================================
// REVIEW A NEGOTIATION
// POST /api/risk/:negotiationId/review
// ======================================================
router.post("/:negotiationId/review", (req, res) => {
  try {
    const { action, reviewer, notes } = req.body;
    const negotiationId = req.params.negotiationId;

    if (!["approve", "reject"].includes(action)) {
      return res.status(400).json({
        error: "Action must be approve or reject."
      });
    }

    if (typeof reviewer !== "string" || !reviewer.trim()) {
      return res.status(400).json({
        error: "Reviewer identification is required."
      });
    }

    const assessment = db.prepare(`
      SELECT *
      FROM risk_assessments
      WHERE negotiation_id = ?
    `).get(negotiationId);

    if (!assessment) {
      return res.status(404).json({
        error: "Risk assessment not found."
      });
    }

    if (
      assessment.decision !== "review" ||
      assessment.reviewed !== 0
    ) {
      return res.status(400).json({
        error: "This assessment is not awaiting review."
      });
    }

    const negotiation = db.prepare(`
      SELECT *
      FROM negotiations
      WHERE id = ?
    `).get(negotiationId);

    if (!negotiation || negotiation.status !== "pending_risk_review") {
      return res.status(400).json({
        error: "Negotiation is not awaiting risk review."
      });
    }

    const candidatePrice =
      negotiation.initial_offer >= negotiation.seller_min_price
        ? negotiation.initial_offer
        : negotiation.seller_min_price;

    const finalStatus = action === "reject"
      ? "rejected"
      : (
          db.prepare(`
            SELECT
              buyer.requires_approval AS buyer_approval,
              seller.requires_approval AS seller_approval
            FROM agent_mandates buyer
            JOIN agent_mandates seller
              ON seller.agent_id = ?
            WHERE buyer.agent_id = ?
          `).get(
            negotiation.seller_agent_id,
            negotiation.buyer_agent_id
          )?.buyer_approval === 1 ||
          db.prepare(`
            SELECT requires_approval
            FROM agent_mandates
            WHERE agent_id = ?
          `).get(negotiation.seller_agent_id)?.requires_approval === 1
        )
          ? "pending_approval"
          : "accepted";

    const finalPrice = action === "approve" ? candidatePrice : null;

    const reviewNotes = typeof notes === "string" ? notes.trim() : null;

    const processReview = db.transaction(() => {

      // UPDATE NEGOTIATION
      db.prepare(`
        UPDATE negotiations
        SET status = ?,
            final_price = ?
        WHERE id = ?
      `).run(finalStatus, finalPrice, negotiationId);

      // UPDATE LEGACY SESSION
      db.prepare(`
        UPDATE negotiation_sessions
        SET status = ?,
            agreed_amount = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(finalStatus, finalPrice, negotiationId);

      // UPDATE RISK ASSESSMENT
      db.prepare(`
        UPDATE risk_assessments
        SET reviewed = 1,
            review_notes = ?,
            decision = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE negotiation_id = ?
      `).run(
        reviewNotes,
        action === "approve" ? "allow" : "block",
        negotiationId
      );

      // AUDIT LOG
      db.prepare(`
        INSERT INTO audit_logs (
          id,
          actor,
          action,
          entity_type,
          entity_id,
          details
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        reviewer.trim(),
        action === "approve" ? "risk_review_approved" : "risk_review_rejected",
        "negotiation",
        negotiationId,
        JSON.stringify({
          reviewer: reviewer.trim(),
          notes: reviewNotes,
          risk_score: assessment.risk_score
        })
      );
    });

    processReview();

    res.json({
      message: `Negotiation ${action}d after risk review.`,
      negotiation_id: negotiationId,
      reviewer: reviewer.trim(),
      action,
      status: finalStatus,
      final_price: finalPrice,
      risk_score: assessment.risk_score,
      notes: reviewNotes
    });

  } catch (error) {
    console.error("Risk review error:", error.message);

    res.status(500).json({
      error: "Unable to process risk review.",
      details: error.message
    });
  }
});


// ======================================================
// OWNER APPROVAL QUEUE
// Demo identity check: owner email must match a party owner.
// Production must enforce authenticated sessions and roles.
// ======================================================
router.get("/approval-queue", (req, res) => {
  try {
    const approvals = db.prepare(`
      SELECT n.id AS negotiation_id, n.item_description, n.quantity,
        n.initial_offer, n.final_price, n.buyer_agent_id, n.seller_agent_id,
        n.status, n.created_at,
        buyer.name AS buyer_name, seller.name AS seller_name,
        buyer_owner.id AS buyer_owner_id, buyer_owner.name AS buyer_owner_name,
        seller_owner.id AS seller_owner_id, seller_owner.name AS seller_owner_name
      FROM negotiations n
      JOIN agents buyer ON buyer.id = n.buyer_agent_id
      JOIN agents seller ON seller.id = n.seller_agent_id
      JOIN users buyer_owner ON buyer_owner.id = buyer.owner_id
      JOIN users seller_owner ON seller_owner.id = seller.owner_id
      WHERE n.status = 'pending_approval'
      ORDER BY n.created_at ASC
    `).all();
    res.json({ count: approvals.length, approvals });
  } catch (error) {
    console.error("Owner approval queue error:", error.message);
    res.status(500).json({ error: "Unable to retrieve owner approvals." });
  }
});

// ======================================================
// OWNER APPROVAL / REJECTION
// POST /api/risk/:negotiationId/owner-approval
// ======================================================
router.post("/:negotiationId/owner-approval", (req, res) => {
  try {
    const { action, owner_email, notes } = req.body;
    const negotiationId = req.params.negotiationId;
    if (!["approve", "reject"].includes(action)) {
      return res.status(400).json({ error: "Action must be approve or reject." });
    }
    if (typeof owner_email !== "string" || !owner_email.trim()) {
      return res.status(400).json({ error: "The owner's registered email is required." });
    }
    const record = db.prepare(`
      SELECT n.*, buyer.owner_id AS buyer_owner_id,
        seller.owner_id AS seller_owner_id,
        buyer_owner.name AS buyer_owner_name, buyer_owner.email AS buyer_owner_email,
        seller_owner.name AS seller_owner_name, seller_owner.email AS seller_owner_email
      FROM negotiations n
      JOIN agents buyer ON buyer.id = n.buyer_agent_id
      JOIN agents seller ON seller.id = n.seller_agent_id
      JOIN users buyer_owner ON buyer_owner.id = buyer.owner_id
      JOIN users seller_owner ON seller_owner.id = seller.owner_id
      WHERE n.id = ?
    `).get(negotiationId);
    if (!record) return res.status(404).json({ error: "Negotiation not found." });
    if (record.status !== "pending_approval") {
      return res.status(409).json({ error: "This negotiation is no longer awaiting owner approval." });
    }
    const email = owner_email.trim().toLowerCase();
    const matchedOwner = [
      { id: record.buyer_owner_id, name: record.buyer_owner_name, email: record.buyer_owner_email },
      { id: record.seller_owner_id, name: record.seller_owner_name, email: record.seller_owner_email }
    ].find(owner => owner.email && owner.email.toLowerCase() === email);
    if (!matchedOwner) {
      return res.status(403).json({ error: "That email does not belong to either agent owner in this negotiation." });
    }
    const price = Math.max(Number(record.initial_offer), Number(record.seller_min_price));
    if (!Number.isFinite(price) || price <= 0) {
      return res.status(409).json({ error: "The proposed agreement price is invalid." });
    }
    const finalStatus = action === "approve" ? "accepted" : "rejected";
    const finalPrice = action === "approve" ? price : null;
    const reviewNotes = typeof notes === "string" ? notes.trim() : "";
    db.transaction(() => {
      const changed = db.prepare(`
        UPDATE negotiations SET status = ?, final_price = ?
        WHERE id = ? AND status = 'pending_approval'
      `).run(finalStatus, finalPrice, negotiationId);
      if (changed.changes !== 1) throw new Error("Approval state changed; refresh and try again.");
      db.prepare(`
        UPDATE negotiation_sessions SET status = ?, agreed_amount = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(finalStatus, finalPrice, negotiationId);
      db.prepare(`
        INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
        VALUES (?, ?, ?, 'negotiation', ?, ?)
      `).run(randomUUID(), matchedOwner.name,
        action === "approve" ? "owner_approval_granted" : "owner_approval_rejected",
        negotiationId, JSON.stringify({ owner_id: matchedOwner.id, owner_email: email, notes: reviewNotes }));
    })();
    res.json({
      message: action === "approve" ? "Negotiation approved by an agent owner." : "Negotiation rejected by an agent owner.",
      negotiation_id: negotiationId, action, status: finalStatus, final_price: finalPrice,
      owner: matchedOwner.name
    });
  } catch (error) {
    console.error("Owner approval error:", error.message);
    res.status(500).json({ error: "Unable to process owner approval." });
  }
});

module.exports = router;