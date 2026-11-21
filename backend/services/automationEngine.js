const { randomUUID } = require("crypto");
const db = require("../database/db");
const { assessRisk, saveRiskAssessment } = require("./riskEngine");
const { allowedItemsMatch } = require("./mandateUtils");

const jobsRunning = new Set();

db.exec(`
CREATE TABLE IF NOT EXISTS automation_jobs (
  id TEXT PRIMARY KEY,
  buyer_agent_id TEXT NOT NULL,
  seller_agent_id TEXT NOT NULL,
  item_description TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  initial_offer REAL NOT NULL,
  response_delay_seconds INTEGER NOT NULL DEFAULT 30,
  scheduled_at TEXT NOT NULL,
  auto_payment INTEGER NOT NULL DEFAULT 1,
  max_rounds INTEGER NOT NULL DEFAULT 8,
  status TEXT NOT NULL DEFAULT 'scheduled',
  negotiation_id TEXT,
  current_round INTEGER NOT NULL DEFAULT 0,
  result TEXT,
  error TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

function log(actor, action, entityId, details = {}) {
  db.prepare(`
    INSERT INTO audit_logs
    (id, actor, action, entity_type, entity_id, details)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    actor,
    action,
    "automation_job",
    entityId,
    JSON.stringify(details)
  );
}

function allowedItem(allowedItems, description) {
  return allowedItemsMatch(allowedItems, description);
}

function getJob(id) {
  return db.prepare(`
    SELECT * FROM automation_jobs WHERE id = ?
  `).get(id);
}

function getMessages(sessionId) {
  return db.prepare(`
    SELECT m.*, a.name AS sender_name, a.role AS sender_role
    FROM negotiation_messages m
    JOIN agents a ON a.id = m.sender_agent_id
    WHERE m.session_id = ?
    ORDER BY m.created_at ASC
  `).all(sessionId);
}

function insertMessage(sessionId, agentId, type, message, price) {
  db.prepare(`
    INSERT INTO negotiation_messages (
      id, session_id, sender_agent_id,
      message_type, message, proposed_amount
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    sessionId,
    agentId,
    type,
    message,
    price ?? null
  );
}

function updateJob(id, updates) {
  const fields = Object.keys(updates);
  const values = Object.values(updates);

  const setClause = fields.map(field => `${field} = ?`).join(", ");

  db.prepare(`
    UPDATE automation_jobs
    SET ${setClause}, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(...values, id);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function validateJob(job) {
    const buyer = db.prepare(`
    SELECT
      a.id,
      a.owner_id,
      a.name,
      a.role,
      a.status,
      m.max_unit_price,
      m.min_unit_price,
      m.max_quantity,
      m.max_total_amount,
      m.allowed_items,
      m.requires_approval
    FROM agents a
    JOIN agent_mandates m ON m.agent_id = a.id
    WHERE a.id = ?
  `).get(job.buyer_agent_id);

  const seller = db.prepare(`
    SELECT
      a.id,
      a.owner_id,
      a.name,
      a.role,
      a.status,
      m.max_unit_price,
      m.min_unit_price,
      m.max_quantity,
      m.max_total_amount,
      m.allowed_items,
      m.requires_approval
    FROM agents a
    JOIN agent_mandates m ON m.agent_id = a.id
    WHERE a.id = ?
  `).get(job.seller_agent_id);
  if (!buyer || !seller) throw new Error("Both agents need mandates.");
  if (buyer.role !== "buyer" || seller.role !== "seller") {
    throw new Error("The selected agents must be buyer and seller respectively.");
  }
  if (buyer.status !== "active" || seller.status !== "active") {
    throw new Error("Both agents must be active.");
  }
  if (buyer.id === seller.id) throw new Error("Agents cannot negotiate with themselves.");

  if (
    job.quantity > buyer.max_quantity ||
    job.quantity > seller.max_quantity
  ) {
    throw new Error("Requested quantity exceeds agent mandates.");
  }

  if (
    !allowedItem(buyer.allowed_items, job.item_description) ||
    !allowedItem(seller.allowed_items, job.item_description)
  ) {
    throw new Error("The item is not permitted by both agent mandates.");
  }

  if (
    !buyer.max_unit_price ||
    !seller.min_unit_price ||
    job.initial_offer <= 0 ||
    job.initial_offer > buyer.max_unit_price
  ) {
    throw new Error("The opening offer or price mandates are invalid.");
  }

  if (
    job.initial_offer * job.quantity > buyer.max_total_amount ||
    seller.min_unit_price * job.quantity > seller.max_total_amount
  ) {
    throw new Error("The proposed transaction exceeds a mandate total.");
  }

  return { buyer, seller };
}

async function runJob(jobId) {
  if (jobsRunning.has(jobId)) return;
  jobsRunning.add(jobId);

  try {
    const job = getJob(jobId);
    if (!job || ["cancelled", "completed", "failed"].includes(job.status)) return;

    updateJob(jobId, { status: "running", error: null });
    log("BATN Automation", "automation_started", jobId);

    const { buyer, seller } = validateJob(job);

    const buyerMax = buyer.max_unit_price;
    const sellerMin = seller.min_unit_price;

    const negotiationId = randomUUID();
    const sessionId = negotiationId;

    db.prepare(`
      INSERT INTO negotiation_sessions (
        id, buyer_agent_id, seller_agent_id,
        status, description
      )
      VALUES (?, ?, ?, 'open', ?)
    `).run(
      sessionId,
      buyer.id,
      seller.id,
      job.item_description
    );

    db.prepare(`
      INSERT INTO negotiations (
        id, buyer_agent_id, seller_agent_id,
        item_description, quantity,
        buyer_max_price, seller_min_price,
        initial_offer, final_price, status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'pending')
    `).run(
      negotiationId,
      buyer.id,
      seller.id,
      job.item_description,
      job.quantity,
      buyerMax,
      sellerMin,
      job.initial_offer
    );

    updateJob(jobId, { negotiation_id: negotiationId });

    insertMessage(
      sessionId,
      buyer.id,
      "proposal",
      `Buyer opens at KES ${job.initial_offer.toLocaleString()} per unit for ${job.quantity} ${job.item_description}.`,
      job.initial_offer
    );

    let buyerOffer = job.initial_offer;
    let sellerOffer = sellerMin;
    let agreement = null;
    let rounds = 1;

    // Seller evaluates the initial buyer offer.
    if (buyerOffer >= sellerMin) {
      agreement = buyerOffer;
      insertMessage(
        sessionId,
        seller.id,
        "acceptance",
        "Seller accepts the opening offer.",
        agreement
      );
    } else {
      insertMessage(
        sessionId,
        seller.id,
        "counteroffer",
        `Seller counters at KES ${sellerOffer.toLocaleString()} per unit.`,
        sellerOffer
      );

      // Buyer and seller make bounded concessions over subsequent rounds.
      while (!agreement && rounds < job.max_rounds) {
        const currentJob = getJob(jobId);

        if (!currentJob || currentJob.status === "cancelled") {
          throw new Error("Automation cancelled.");
        }

        await sleep(job.response_delay_seconds * 1000);

        if (getJob(jobId)?.status === "cancelled") {
          throw new Error("Automation cancelled.");
        }

        rounds++;

        const progress = (rounds - 1) / Math.max(1, job.max_rounds - 1);

        // Buyer gradually raises toward its maximum.
        buyerOffer = Math.min(
          buyerMax,
          job.initial_offer + (buyerMax - job.initial_offer) * progress
        );

        // Seller gradually reduces toward the minimum.
        sellerOffer = Math.max(
          sellerMin,
          seller.min_unit_price + (sellerMin - seller.min_unit_price) * (1 - progress)
        );

        // In this prototype, seller minimum is fixed by mandate.
        sellerOffer = sellerMin;

        if (buyerOffer >= sellerOffer) {
          agreement = sellerOffer;

          insertMessage(
            sessionId,
            buyer.id,
            "proposal",
            `Buyer increases its offer to KES ${buyerOffer.toLocaleString()} per unit.`,
            buyerOffer
          );

          insertMessage(
            sessionId,
            seller.id,
            "acceptance",
            `Seller accepts the offer within its mandate. Agreement reached at KES ${agreement.toLocaleString()} per unit.`,
            agreement
          );

          break;
        }

        insertMessage(
          sessionId,
          buyer.id,
          "proposal",
          `Buyer revises its offer to KES ${buyerOffer.toLocaleString()} per unit.`,
          buyerOffer
        );

        insertMessage(
          sessionId,
          seller.id,
          "counteroffer",
          `Seller maintains its minimum authorized price of KES ${sellerOffer.toLocaleString()} per unit.`,
          sellerOffer
        );

        updateJob(jobId, { current_round: rounds });
      }
    }

    if (!agreement) {
      db.prepare(`
        UPDATE negotiations
        SET status = 'rejected', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(negotiationId);

      db.prepare(`
        UPDATE negotiation_sessions
        SET status = 'rejected', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(sessionId);

      updateJob(jobId, {
        status: "completed",
        result: JSON.stringify({ outcome: "no_agreement", rounds })
      });

      log("BATN Automation", "negotiation_no_agreement", jobId, { rounds });

      return;
    }

    const total = agreement * job.quantity;

    if (
      agreement > buyerMax ||
      agreement < sellerMin ||
      total > buyer.max_total_amount ||
      total > seller.max_total_amount
    ) {
      throw new Error("Final agreement violates mandate limits.");
    }

    const requiresApproval =
      buyer.requires_approval === 1 || seller.requires_approval === 1;

    const assessment = assessRisk({
      id: negotiationId,
      buyer_agent_id: buyer.id,
      seller_agent_id: seller.id,
      item_description: job.item_description,
      quantity: job.quantity,
      final_price: agreement,
      total_amount: total,
      buyer_status: buyer.status,
      seller_status: seller.status,
      buyer_max_total: buyer.max_total_amount,
      seller_max_total: seller.max_total_amount
    });

    saveRiskAssessment(assessment);

    let status = "accepted";
    let finalPrice = agreement;

    if (assessment.decision === "block") {
      status = "blocked";
      finalPrice = null;
    } else if (assessment.decision === "review" || requiresApproval) {
      status = assessment.decision === "review"
        ? "pending_risk_review"
        : "pending_approval";
      finalPrice = null;
    }

    db.prepare(`
      UPDATE negotiations
      SET final_price = ?, status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(finalPrice, status, negotiationId);

    db.prepare(`
      UPDATE negotiation_sessions
      SET status = ?, agreed_amount = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, finalPrice, sessionId);

    if (status !== "accepted") {
      const result = {
        outcome: status,
        risk: assessment,
        requires_approval: requiresApproval,
        rounds
      };

      updateJob(jobId, {
        status: "completed",
        current_round: rounds,
        result: JSON.stringify(result)
      });

      log("BATN Automation", "negotiation_stopped", jobId, result);
      return;
    }

    let payment = null;

    if (job.auto_payment === 1) {
      payment = initiateMockPayment(negotiationId, buyer, seller, total);
    }

    const result = {
      outcome: "agreement_reached",
      negotiation_id: negotiationId,
      agreed_unit_price: agreement,
      quantity: job.quantity,
      total_amount: total,
      risk: assessment,
      payment,
      rounds
    };

    updateJob(jobId, {
      status: "completed",
      current_round: rounds,
      result: JSON.stringify(result)
    });

    log("BATN Automation", "agreement_reached", jobId, result);

  } catch (error) {
    if (error.message === "Automation cancelled.") {
      updateJob(jobId, { status: "cancelled", error: null });
      log("BATN Automation", "automation_cancelled", jobId);
    } else {
      updateJob(jobId, { status: "failed", error: error.message });
      log("BATN Automation", "automation_failed", jobId, {
        error: error.message
      });
    }
  } finally {
    jobsRunning.delete(jobId);
  }
}

function initiateMockPayment(negotiationId, buyer, seller, total) {
  const existing = db.prepare(`
    SELECT * FROM payment_intents WHERE negotiation_id = ?
  `).get(negotiationId);

  if (existing) return existing;

  const paymentId = randomUUID();

  db.prepare(`
    INSERT INTO payment_intents (
      id, negotiation_id, buyer_agent_id,
      seller_agent_id, amount, currency,
      provider, idempotency_key, status
    )
    VALUES (?, ?, ?, ?, ?, 'KES', 'mock', ?, 'pending')
  `).run(
    paymentId,
    negotiationId,
    buyer.id,
    seller.id,
    total,
    `BATN-AUTO-${negotiationId}`
  );

  const trackingId = randomUUID();

  db.prepare(`
    INSERT INTO transaction_tracking (
      id, negotiation_id, payment_intent_id, transaction_status
    )
    VALUES (?, ?, ?, 'payment_pending')
  `).run(trackingId, negotiationId, paymentId);

  db.prepare(`
    INSERT INTO transaction_events (
      id, tracking_id, event_type, description
    )
    VALUES (?, ?, ?, ?)
  `).run(
    randomUUID(),
    trackingId,
    "payment_intent_created",
    "Automated mock payment intent created."
  );

  db.prepare(`
    INSERT INTO audit_logs (
      id, actor, action, entity_type, entity_id, details
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    "BATN Automation",
    "payment_intent_created",
    "payment_intent",
    paymentId,
    JSON.stringify({
      negotiation_id: negotiationId,
      amount: total,
      provider: "mock"
    })
  );

  return db.prepare(`
    SELECT * FROM payment_intents WHERE id = ?
  `).get(paymentId);
}

function createJob(data) {
  const {
    buyer_agent_id,
    seller_agent_id,
    item_description,
    quantity,
    initial_offer,
    response_delay_seconds = 30,
    scheduled_at,
    auto_payment = true,
    max_rounds = 8
  } = data;

  if (
    !buyer_agent_id || !seller_agent_id ||
    !item_description || typeof item_description !== "string" ||
    !Number.isInteger(quantity) || quantity < 1 ||
    !Number.isFinite(initial_offer) || initial_offer <= 0
  ) {
    throw new Error("Invalid automation job parameters.");
  }

  if (
    response_delay_seconds < 1 ||
    response_delay_seconds > 300 ||
    max_rounds < 2 ||
    max_rounds > 20
  ) {
    throw new Error("Invalid timing or round limits.");
  }

  const scheduledDate = scheduled_at ? new Date(scheduled_at) : new Date();

  if (Number.isNaN(scheduledDate.getTime())) {
    throw new Error("Invalid scheduled time.");
  }

  const sqliteDate = scheduledDate.toISOString().slice(0, 19).replace("T", " ");

  const id = randomUUID();

  db.prepare(`
    INSERT INTO automation_jobs (
      id, buyer_agent_id, seller_agent_id,
      item_description, quantity, initial_offer,
      response_delay_seconds, scheduled_at,
      auto_payment, max_rounds, status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled')
  `).run(
    id,
    buyer_agent_id,
    seller_agent_id,
    item_description.trim(),
    quantity,
    initial_offer,
    response_delay_seconds,
    sqliteDate,
    auto_payment ? 1 : 0,
    max_rounds
  );

  log("BATN Automation", "automation_job_created", id, data);

  return getJob(id);
}

function cancelJob(id) {
  const job = getJob(id);

  if (!job) throw new Error("Automation job not found.");

  if (["completed", "failed", "cancelled"].includes(job.status)) {
    throw new Error("This job can no longer be cancelled.");
  }

  updateJob(id, { status: "cancelled" });
  log("BATN Automation", "automation_cancelled", id);

  return getJob(id);
}

function startScheduler() {
  // Recover jobs that were running when the backend stopped.
  db.prepare(`
    UPDATE automation_jobs
    SET status = 'scheduled',
        updated_at = CURRENT_TIMESTAMP
    WHERE status = 'running'
  `).run();

  setInterval(() => {
    const dueJobs = db.prepare(`
      SELECT id FROM automation_jobs
      WHERE status = 'scheduled'
        AND scheduled_at <= datetime('now')
      ORDER BY scheduled_at ASC
      LIMIT 10
    `).all();

    for (const job of dueJobs) {
      runJob(job.id);
    }
  }, 1000);

  console.log("BATN Automation Scheduler running.");
}

module.exports = {
  createJob,
  getJob,
  getMessages,
  cancelJob,
  startScheduler
};