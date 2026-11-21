
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const dbPath = process.env.BATN_DB_PATH || path.join(__dirname, "batn.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);

// Enable relational integrity enforcement
db.pragma("foreign_keys = ON");

// Schema location
const schemaPath = path.join(
  __dirname,
  "../../database/schema.sql"
);

const schema = fs.readFileSync(schemaPath, "utf8");

// Initialize tables
db.exec(schema);

console.log("BATN database initialized.");

module.exports = db;
