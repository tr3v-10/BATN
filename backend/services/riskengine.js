const db = require("../database/db");

function assessRisk(negotiation) {
  const flags = [];
  let score = 0;

  const {
    id,
    buyer_agent_id,
    seller_agent_id,
    item_description,
    quantity,
    final_price,
    total_amount,
    buyer_status,
    seller_status,
    buyer_max_total,
    seller_max_total,
  } = negotiation;

  // RULE 1: Inactive agents
  if (buyer_status !== "active") {
    flags.push("Buyer agent is inactive");
    score += 100;
  }

  if (seller_status !== "active") {
    flags.push("Seller agent is inactive");
    score += 100;
  }

  // RULE 2: High transaction value
  if (total_amount >= 100000) {
    flags.push("High-value transaction");
    score += 30;
  }

  // RULE 3: Repeated negotiations between the same agents
  const repeated = db.prepare(`
    SELECT COUNT(*) AS count
    FROM negotiations
    WHERE buyer_agent_id = ?
      AND seller_agent_id = ?
      AND LOWER(item_description) = LOWER(?)
      AND created_at >= datetime('now', '-10 minutes')
      AND id != ?
  `).get(
    buyer_agent_id,
    seller_agent_id,
    item_description,
    id
  );

  if (repeated.count >= 2) {
    flags.push("Repeated negotiation attempts");
    score += 25;
  }

  // RULE 4: Rapid activity by buyer
  const buyerActivity = db.prepare(`
    SELECT COUNT(*) AS count
    FROM negotiations
    WHERE buyer_agent_id = ?
      AND created_at >= datetime('now', '-5 minutes')
      AND id != ?
  `).get(buyer_agent_id, id);

  if (buyerActivity.count >= 3) {
    flags.push("High buyer negotiation activity");
    score += 25;
  }

  // RULE 5: Rapid activity by seller
  const sellerActivity = db.prepare(`
    SELECT COUNT(*) AS count
    FROM negotiations
    WHERE seller_agent_id = ?
      AND created_at >= datetime('now', '-5 minutes')
      AND id != ?
  `).get(seller_agent_id, id);

  if (sellerActivity.count >= 3) {
    flags.push("High seller negotiation activity");
    score += 25;
  }

  // RULE 6: Transaction approaching authorized limits
  if (
    buyer_max_total > 0 &&
    total_amount >= buyer_max_total * 0.9
  ) {
    flags.push("Transaction approaching buyer mandate limit");
    score += 20;
  }

  if (
    seller_max_total > 0 &&
    total_amount >= seller_max_total * 0.9
  ) {
    flags.push("Transaction approaching seller mandate limit");
    score += 20;
  }

  // Cap score at 100
  score = Math.min(score, 100);

  // Determine risk level
  let riskLevel = "low";

  if (score >= 70) {
    riskLevel = "critical";
  } else if (score >= 50) {
    riskLevel = "high";
  } else if (score >= 30) {
    riskLevel = "medium";
  }

  // Determine system decision
  let decision = "allow";

  if (score >= 70) {
    decision = "block";
  } else if (score >= 30) {
    decision = "review";
  }

  return {
    negotiation_id: id,
    risk_score: score,
    risk_level: riskLevel,
    flags,
    decision,
  };
}

function saveRiskAssessment(assessment) {
  const insert = db.prepare(`
    INSERT INTO risk_assessments (
      id,
      negotiation_id,
      risk_score,
      risk_level,
      flags,
      decision
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  insert.run(
    require("crypto").randomUUID(),
    assessment.negotiation_id,
    assessment.risk_score,
    assessment.risk_level,
    JSON.stringify(assessment.flags),
    assessment.decision
  );
}

module.exports = {
  assessRisk,
  saveRiskAssessment,
};