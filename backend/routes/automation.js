const express = require("express");
const db = require("../database/db");
const engine = require("../services/automationEngine");

const router = express.Router();

// GET AUTOMATION JOBS
router.get("/", (req, res) => {
  try {
    const jobs = db.prepare(`
      SELECT j.*,
             b.name AS buyer_name,
             s.name AS seller_name
      FROM automation_jobs j
      LEFT JOIN agents b ON b.id = j.buyer_agent_id
      LEFT JOIN agents s ON s.id = j.seller_agent_id
      ORDER BY j.created_at DESC
    `).all();

    res.json({ count: jobs.length, jobs });
  } catch (error) {
    res.status(500).json({
      message: "Unable to retrieve automation jobs.",
      error: error.message
    });
  }
});

// CREATE AUTOMATION JOB
router.post("/", (req, res) => {
  try {
    const job = engine.createJob(req.body || {});

    res.status(201).json({
      message: "Automation job created.",
      job
    });
  } catch (error) {
    res.status(400).json({
      message: error.message
    });
  }
});

// GET SINGLE JOB
router.get("/:id", (req, res) => {
  try {
    const job = db.prepare(`
      SELECT j.*,
             b.name AS buyer_name,
             s.name AS seller_name
      FROM automation_jobs j
      LEFT JOIN agents b ON b.id = j.buyer_agent_id
      LEFT JOIN agents s ON s.id = j.seller_agent_id
      WHERE j.id = ?
    `).get(req.params.id);

    if (!job) {
      return res.status(404).json({
        message: "Automation job not found."
      });
    }

    res.json({ job });
  } catch (error) {
    res.status(500).json({
      message: "Unable to retrieve job.",
      error: error.message
    });
  }
});

// GET AUTOMATED NEGOTIATION MESSAGES
router.get("/:id/messages", (req, res) => {
  try {
    const job = engine.getJob(req.params.id);

    if (!job) {
      return res.status(404).json({
        message: "Automation job not found."
      });
    }

    if (!job.negotiation_id) {
      return res.json({ messages: [] });
    }

    res.json({
      messages: engine.getMessages(job.negotiation_id)
    });
  } catch (error) {
    res.status(500).json({
      message: "Unable to retrieve messages.",
      error: error.message
    });
  }
});

// CANCEL AUTOMATION
router.post("/:id/cancel", (req, res) => {
  try {
    const job = engine.cancelJob(req.params.id);

    res.json({
      message: "Automation cancelled.",
      job
    });
  } catch (error) {
    res.status(400).json({
      message: error.message
    });
  }
});

module.exports = router;