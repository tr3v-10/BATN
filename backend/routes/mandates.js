
const express = require("express");
const { randomUUID } = require("crypto");
const db = require("../database/db");
const { normalizeAllowedItems } = require("../services/mandateUtils");

const router = express.Router();

// ======================================================
// GET: RETRIEVE ALL MANDATES
// ======================================================
router.get("/", (req, res) => {
  try {
    const mandates = db.prepare(`
      SELECT
        m.*,
        a.name AS agent_name,
        a.role AS agent_role,
        a.owner_id AS owner_id
      FROM agent_mandates m
      JOIN agents a ON a.id = m.agent_id
      ORDER BY m.created_at DESC
    `).all();

    res.json({
      system: "BATN Mandate Engine",
      count: mandates.length,
      mandates
    });

  } catch (error) {
    console.error("Mandate retrieval error:", error.message);

    res.status(500).json({
      error: "Unable to retrieve mandates."
    });
  }
});


// ======================================================
// GET: RETRIEVE A MANDATE FOR A SPECIFIC AGENT
// ======================================================
router.get("/:agentId", (req, res) => {
  try {
    const mandate = db.prepare(`
      SELECT
        m.*,
        a.name AS agent_name,
        a.role AS agent_role,
        a.owner_id AS owner_id
      FROM agent_mandates m
      JOIN agents a ON a.id = m.agent_id
      WHERE m.agent_id = ?
    `).get(req.params.agentId);

    if (!mandate) {
      return res.status(404).json({
        error: "Mandate not found for this agent."
      });
    }

    res.json(mandate);

  } catch (error) {
    console.error("Mandate retrieval error:", error.message);

    res.status(500).json({
      error: "Unable to retrieve mandate."
    });
  }
});


// ======================================================
// PUT: CREATE OR UPDATE AN AGENT MANDATE
// ======================================================
router.put("/:agentId", (req, res) => {
  try {
    const agentId = req.params.agentId;

    const {
      max_unit_price,
      min_unit_price,
      max_quantity,
      max_total_amount,
      allowed_items,
      requires_approval
    } = req.body;


    // VERIFY AGENT EXISTS
    const agent = db.prepare(`
      SELECT id, name, role, status
      FROM agents
      WHERE id = ?
    `).get(agentId);

    if (!agent) {
      return res.status(404).json({
        error: "Agent not found."
      });
    }


    // VALIDATE GENERAL RULES
    if (
      !Number.isInteger(max_quantity) ||
      max_quantity <= 0 ||
      !Number.isFinite(max_total_amount) ||
      max_total_amount <= 0 ||
      typeof requires_approval !== "boolean"
    ) {
      return res.status(400).json({
        error: "Invalid quantity, transaction limit or approval setting."
      });
    }


    // ROLE-SPECIFIC PRICE VALIDATION
    if (agent.role === "buyer") {

      if (
        !Number.isFinite(max_unit_price) ||
        max_unit_price <= 0 ||
        min_unit_price !== null &&
        min_unit_price !== undefined
      ) {
        return res.status(400).json({
          error: "Buyer mandates require a valid maximum unit price and no seller minimum."
        });
      }

    } else if (agent.role === "seller") {

      if (
        !Number.isFinite(min_unit_price) ||
        min_unit_price <= 0 ||
        max_unit_price !== null &&
        max_unit_price !== undefined
      ) {
        return res.status(400).json({
          error: "Seller mandates require a valid minimum unit price and no buyer maximum."
        });
      }

    } else {

      return res.status(400).json({
        error: "Only buyer and seller agents can receive trading mandates."
      });

    }


    // ACCEPT arrays, JSON-encoded arrays and legacy comma-separated values.
    const normalizedItems = normalizeAllowedItems(allowed_items);
    if (normalizedItems !== "*" && normalizedItems.length === 0) {
      return res.status(400).json({
        error: "Allowed items must be '*' or a non-empty list of product names."
      });
    }
    const itemsValue = normalizedItems === "*"
      ? "*"
      : JSON.stringify(normalizedItems);


    // NORMALIZE ROLE-SPECIFIC PRICE VALUES
    const buyerMaxPrice =
      agent.role === "buyer" ? max_unit_price : null;

    const sellerMinPrice =
      agent.role === "seller" ? min_unit_price : null;


    // CREATE OR UPDATE MANDATE
    const mandateId = randomUUID();

    db.prepare(`
      INSERT INTO agent_mandates (
        id,
        agent_id,
        max_unit_price,
        min_unit_price,
        max_quantity,
        max_total_amount,
        allowed_items,
        requires_approval,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)

      ON CONFLICT(agent_id) DO UPDATE SET
        max_unit_price = excluded.max_unit_price,
        min_unit_price = excluded.min_unit_price,
        max_quantity = excluded.max_quantity,
        max_total_amount = excluded.max_total_amount,
        allowed_items = excluded.allowed_items,
        requires_approval = excluded.requires_approval,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      mandateId,
      agentId,
      buyerMaxPrice,
      sellerMinPrice,
      max_quantity,
      max_total_amount,
      itemsValue,
      requires_approval ? 1 : 0
    );


    // RETRIEVE SAVED MANDATE
    const savedMandate = db.prepare(`
      SELECT
        m.*,
        a.name AS agent_name,
        a.role AS agent_role
      FROM agent_mandates m
      JOIN agents a ON a.id = m.agent_id
      WHERE m.agent_id = ?
    `).get(agentId);


    res.status(200).json({
      message: "Agent mandate saved successfully.",
      mandate: savedMandate
    });


  } catch (error) {

    console.error("Mandate creation error:", error.message);

    res.status(500).json({
      error: "Unable to save agent mandate.",
      details: error.message
    });

  }
});


// ======================================================
// EXPORT ROUTER
// ======================================================
module.exports = router;
