cc

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