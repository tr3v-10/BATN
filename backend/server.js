require("dotenv").config();
const riskRoutes = require("./routes/risk");
const express = require("express");
const cors = require("cors");
const { randomUUID } = require("crypto");
const db = require("./database/db");
const negotiationsRouter = require("./routes/negotiations");
const mandateRoutes = require("./routes/mandates");
const app = express();
const PORT = process.env.PORT || 5000;
const paymentRoutes = require("./routes/payments");
const transactionRoutes = require("./routes/transactions");
const allowedOrigins = (process.env.FRONTEND_URL || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
app.use(cors({ origin: (origin, callback) => {
  if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
  return callback(new Error("Origin not allowed by CORS"));
} }));
app.use(express.json());
app.use("/api/payments", paymentRoutes);
app.use("/api/negotiations", negotiationsRouter);
app.use("/api/mandates", mandateRoutes);
app.use("/api/risk", riskRoutes);
app.use("/api/transactions", transactionRoutes);
// ------------------------------------
// HELPER: WRITE TO AUDIT LOG
// ------------------------------------
function logAction(actor, action, entityType, entityId, details = {}) {
  db.prepare(`
    INSERT INTO audit_logs
    (id, actor, action, entity_type, entity_id, details)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    actor,
    action,
    entityType,
    entityId,
    JSON.stringify(details)
  );
}

// ------------------------------------
// MAIN ROUTE
// ------------------------------------
app.get("/", (req, res) => {
  res.json({
    name: "BATN",
    description: "Bilateral Agent Transaction Network",
    status: "online"
  });
});

// ------------------------------------
// HEALTH CHECK
// ------------------------------------
app.get("/api/status", (req, res) => {
  res.json({
    system: "BATN",
    status: "online",
    database: "connected"
  });
});

// ------------------------------------
// DASHBOARD STATISTICS
// ------------------------------------
app.get("/api/dashboard", (req, res) => {
  try {
    const totalTransactions = db.prepare(
      "SELECT COUNT(*) AS count FROM transactions"
    ).get().count;

    const completedTransactions = db.prepare(
      "SELECT COUNT(*) AS count FROM transactions WHERE status = 'completed'"
    ).get().count;

    const pendingTransactions = db.prepare(
      "SELECT COUNT(*) AS count FROM transactions WHERE status = 'pending'"
    ).get().count;

    const flaggedTransactions = db.prepare(
      "SELECT COUNT(*) AS count FROM transactions WHERE status = 'review_required'"
    ).get().count;

    const activeAgents = db.prepare(
      "SELECT COUNT(*) AS count FROM agents WHERE status = 'active'"
    ).get().count;

    res.json({
      totalTransactions,
      completedTransactions,
      pendingTransactions,
      flaggedTransactions,
      activeAgents
    });
  } catch (error) {
    console.error("Dashboard error:", error.message);

    res.status(500).json({
      error: "Unable to retrieve dashboard statistics"
    });
  }
});

// ====================================
// MODULE 4: USER MANAGEMENT
// ====================================

// CREATE OWNER
app.post("/api/users", (req, res) => {
  try {
    const { name, email } = req.body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({
        error: "A valid owner name is required"
      });
    }

    const id = randomUUID();

    db.prepare(`
      INSERT INTO users (id, name, email)
      VALUES (?, ?, ?)
    `).run(
      id,
      name.trim(),
      email || null
    );

    logAction("system", "user_created", "user", id, {
      name: name.trim()
    });

    res.status(201).json({
      message: "Owner created successfully",
      user: {
        id,
        name: name.trim(),
        email: email || null
      }
    });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({
        error: "That email is already registered"
      });
    }

    console.error("User creation error:", error.message);

    res.status(500).json({
      error: "Unable to create owner"
    });
  }
});

// GET ALL OWNERS
app.get("/api/users", (req, res) => {
  try {
    const users = db.prepare(`
      SELECT id, name, email, created_at
      FROM users
      ORDER BY created_at DESC
    `).all();

    res.json(users);
  } catch (error) {
    console.error("User retrieval error:", error.message);

    res.status(500).json({
      error: "Unable to retrieve owners"
    });
  }
});

// ====================================
// MODULE 4: AGENT MANAGEMENT
// ====================================

// CREATE AGENT
app.post("/api/agents", (req, res) => {
  try {
    const { owner_id, name, role } = req.body;

    if (!owner_id || !name || !role) {
      return res.status(400).json({
        error: "owner_id, name and role are required"
      });
    }

    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({
        error: "Agent name must be valid"
      });
    }

    if (!["buyer", "seller"].includes(role)) {
      return res.status(400).json({
        error: "Agent role must be buyer or seller"
      });
    }

    const owner = db.prepare(`
      SELECT id FROM users WHERE id = ?
    `).get(owner_id);

    if (!owner) {
      return res.status(404).json({
        error: "Owner does not exist"
      });
    }

    const id = randomUUID();

    db.prepare(`
      INSERT INTO agents (id, owner_id, name, role, status)
      VALUES (?, ?, ?, ?, 'inactive')
    `).run(
      id,
      owner_id,
      name.trim(),
      role
    );

    logAction("system", "agent_created", "agent", id, {
      owner_id,
      name: name.trim(),
      role
    });

    res.status(201).json({
      message: "Agent created successfully",
      agent: {
        id,
        owner_id,
        name: name.trim(),
        role,
        status: "inactive"
      }
    });
  } catch (error) {
    console.error("Agent creation error:", error.message);

    res.status(500).json({
      error: "Unable to create agent"
    });
  }
});

// GET ALL AGENTS
// Optional filter: /api/agents?owner_id=OWNER_ID
app.get("/api/agents", (req, res) => {
  try {
    let agents;

    if (req.query.owner_id) {
      agents = db.prepare(`
        SELECT
          agents.id,
          agents.owner_id,
          agents.name,
          agents.role,
          agents.status,
          agents.created_at,
          users.name AS owner_name
        FROM agents
        JOIN users ON agents.owner_id = users.id
        WHERE agents.owner_id = ?
        ORDER BY agents.created_at DESC
      `).all(req.query.owner_id);
    } else {
      agents = db.prepare(`
        SELECT
          agents.id,
          agents.owner_id,
          agents.name,
          agents.role,
          agents.status,
          agents.created_at,
          users.name AS owner_name
        FROM agents
        JOIN users ON agents.owner_id = users.id
        ORDER BY agents.created_at DESC
      `).all();
    }

    res.json(agents);
  } catch (error) {
    console.error("Agent retrieval error:", error.message);

    res.status(500).json({
      error: "Unable to retrieve agents"
    });
  }
});

// ACTIVATE OR DEACTIVATE AN AGENT
app.patch("/api/agents/:id/status", (req, res) => {
  try {
    const { status } = req.body;
    const agentId = req.params.id;

    if (!["active", "inactive"].includes(status)) {
      return res.status(400).json({
        error: "Status must be active or inactive"
      });
    }

    const agent = db.prepare(`
      SELECT id, name, status
      FROM agents
      WHERE id = ?
    `).get(agentId);

    if (!agent) {
      return res.status(404).json({
        error: "Agent not found"
      });
    }

    db.prepare(`
      UPDATE agents
      SET status = ?
      WHERE id = ?
    `).run(status, agentId);

    logAction("system", "agent_status_changed", "agent", agentId, {
      previous_status: agent.status,
      new_status: status
    });

    res.json({
      message: `Agent ${status} successfully`,
      agent: {
        id: agentId,
        name: agent.name,
        status
      }
    });
  } catch (error) {
    console.error("Agent status error:", error.message);

    res.status(500).json({
      error: "Unable to update agent status"
    });
  }
});

// ====================================
// AUDIT LOGS
// ====================================

// GET RECENT AUDIT LOGS
app.get("/api/audit", (req, res) => {
  try {
    const logs = db.prepare(`
      SELECT *
      FROM audit_logs
      ORDER BY created_at DESC
      LIMIT 100
    `).all();

    res.json(logs);
  } catch (error) {
    console.error("Audit retrieval error:", error.message);

    res.status(500).json({
      error: "Unable to retrieve audit logs"
    });
  }
});

// ------------------------------------
// START SERVER
// ------------------------------------
app.listen(PORT, () => {
  console.log(`BATN backend running on http://localhost:${PORT}`);
});