PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'inactive',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS agreements (
    id TEXT PRIMARY KEY,
    buyer_agent_id TEXT NOT NULL,
    seller_agent_id TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'KES',
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    expires_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (buyer_agent_id) REFERENCES agents(id),
    FOREIGN KEY (seller_agent_id) REFERENCES agents(id)
);

CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    agreement_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending',
    payment_reference TEXT UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (agreement_id) REFERENCES agreements(id)
);

CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    transaction_id TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'none',
    provider_reference TEXT UNIQUE,
    amount REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'KES',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (transaction_id) REFERENCES transactions(id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
-- NEGOTIATION SESSIONS
CREATE TABLE IF NOT EXISTS negotiation_sessions (
    id TEXT PRIMARY KEY,
    buyer_agent_id TEXT NOT NULL,
    seller_agent_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    agreed_amount REAL,
    currency TEXT NOT NULL DEFAULT 'KES',
    description TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (buyer_agent_id) REFERENCES agents(id),
    FOREIGN KEY (seller_agent_id) REFERENCES agents(id)
);

-- NEGOTIATION MESSAGES
CREATE TABLE IF NOT EXISTS negotiation_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    sender_agent_id TEXT NOT NULL,
    message_type TEXT NOT NULL,
    message TEXT NOT NULL,
    proposed_amount REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (session_id)
        REFERENCES negotiation_sessions(id),

    FOREIGN KEY (sender_agent_id)
        REFERENCES agents(id)
);
-- NEGOTIATION RECORDS
CREATE TABLE IF NOT EXISTS negotiations (
    id TEXT PRIMARY KEY,
    buyer_agent_id TEXT NOT NULL,
    seller_agent_id TEXT NOT NULL,
    item_description TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    buyer_max_price REAL NOT NULL,
    seller_min_price REAL NOT NULL,
    initial_offer REAL NOT NULL,
    final_price REAL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (buyer_agent_id) REFERENCES agents(id),
    FOREIGN KEY (seller_agent_id) REFERENCES agents(id)
);

-- NEGOTIATION MESSAGE HISTORY
CREATE TABLE IF NOT EXISTS negotiation_messages (
    id TEXT PRIMARY KEY,
    negotiation_id TEXT NOT NULL,
    sender_agent_id TEXT,
    message_type TEXT NOT NULL,
    message TEXT NOT NULL,
    price REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (negotiation_id) REFERENCES negotiations(id),
    FOREIGN KEY (sender_agent_id) REFERENCES agents(id)
);
-- =====================================================
-- AGENT MANDATES / POLICY RULES
-- =====================================================

CREATE TABLE IF NOT EXISTS agent_mandates (
    id TEXT PRIMARY KEY,

    agent_id TEXT NOT NULL UNIQUE,

    max_unit_price REAL,
    min_unit_price REAL,

    max_quantity INTEGER NOT NULL DEFAULT 1,

    max_total_amount REAL NOT NULL,

    allowed_items TEXT NOT NULL DEFAULT '*',

    requires_approval INTEGER NOT NULL DEFAULT 0,

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (agent_id) REFERENCES agents(id),

    CHECK (max_quantity > 0),
    CHECK (max_total_amount > 0),
    CHECK (requires_approval IN (0, 1))
);
-- RISK ASSESSMENTS
CREATE TABLE IF NOT EXISTS risk_assessments (
    id TEXT PRIMARY KEY,
    negotiation_id TEXT NOT NULL UNIQUE,

    risk_score INTEGER NOT NULL DEFAULT 0,
    risk_level TEXT NOT NULL DEFAULT 'low',

    flags TEXT NOT NULL DEFAULT '[]',

    decision TEXT NOT NULL DEFAULT 'allow',

    reviewed INTEGER NOT NULL DEFAULT 0,
    review_notes TEXT,

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (negotiation_id) REFERENCES negotiations(id),

    CHECK (risk_score >= 0 AND risk_score <= 100),

    CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),

    CHECK (decision IN ('allow', 'review', 'block'))
);
-- PAYMENT INTENTS
CREATE TABLE IF NOT EXISTS payment_intents (
    id TEXT PRIMARY KEY,
    negotiation_id TEXT NOT NULL UNIQUE,
    buyer_agent_id TEXT NOT NULL,
    seller_agent_id TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'KES',
    provider TEXT NOT NULL DEFAULT 'mock',
    provider_reference TEXT UNIQUE,
    idempotency_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (negotiation_id) REFERENCES negotiations(id),
    FOREIGN KEY (buyer_agent_id) REFERENCES agents(id),
    FOREIGN KEY (seller_agent_id) REFERENCES agents(id),

    CHECK (amount > 0),
    CHECK (status IN (
        'pending',
        'initiated',
        'processing',
        'paid',
        'failed',
        'cancelled'
    ))
);

-- TRANSACTION TRACKING
CREATE TABLE IF NOT EXISTS transaction_tracking (
    id TEXT PRIMARY KEY,
    negotiation_id TEXT NOT NULL UNIQUE,
    payment_intent_id TEXT UNIQUE,
    transaction_status TEXT NOT NULL DEFAULT 'agreement_reached',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (negotiation_id) REFERENCES negotiations(id),
    FOREIGN KEY (payment_intent_id) REFERENCES payment_intents(id),

    CHECK (transaction_status IN (
        'agreement_reached',
        'payment_pending',
        'payment_initiated',
        'payment_processing',
        'completed',
        'payment_failed',
        'cancelled'
    ))
);

-- TRANSACTION HISTORY / TIMELINE
CREATE TABLE IF NOT EXISTS transaction_events (
    id TEXT PRIMARY KEY,
    tracking_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    description TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (tracking_id) REFERENCES transaction_tracking(id)
);
