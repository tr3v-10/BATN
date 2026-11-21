import { useEffect, useState } from "react";
import {
  Bot,
  Plus,
  RefreshCw,
  Power,
  ShieldCheck,
  ShoppingCart,
  Store,
  AlertCircle,
  LoaderCircle
} from "lucide-react";

import "./AgentsPage.css";

const API = "http://localhost:5000/api";

function formatAllowedItems(value) {
  if (value === undefined || value === null || value === "") return "*";
  if (value === "*") return "*";

  let parsed = value;
  for (let attempt = 0; attempt < 3 && typeof parsed === "string"; attempt++) {
    const trimmed = parsed.trim();
    if (!trimmed) return "*";
    if (trimmed === "*") return "*";
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      break;
    }
  }

  const items = (Array.isArray(parsed) ? parsed : String(parsed).split(","))
    .flat(Infinity)
    .filter(item => typeof item === "string")
    .map(item => item.trim().replace(/^[\s\[\]"]+|[\s\[\]"]+$/g, ""))
    .filter(Boolean);

  return items.length ? [...new Set(items)].join(", ") : "*";
}

function parseAllowedItemsInput(value) {
  const normalized = formatAllowedItems(value);
  if (normalized === "*") return "*";
  return [...new Set(normalized.split(",").map(item => item.trim()).filter(Boolean))];
}


export default function AgentsPage() {
  const [agents, setAgents] = useState([]);
  const [owners, setOwners] = useState([]);

  const [ownerId, setOwnerId] = useState("");
  const [agentName, setAgentName] = useState("");
  const [agentRole, setAgentRole] = useState("buyer");

  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [updatingId, setUpdatingId] = useState("");

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  // MANDATE CONFIGURATION
const [selectedMandateAgent, setSelectedMandateAgent] = useState("");
const [mandate, setMandate] = useState({
  max_unit_price: "",
  min_unit_price: "",
  max_quantity: 1,
  max_total_amount: "",
  allowed_items: "*",
  requires_approval: false,
});

const [mandateLoading, setMandateLoading] = useState(false);
const [mandateSaving, setMandateSaving] = useState(false);

  // LOAD OWNERS AND AGENTS
  async function loadData() {
    setLoading(true);
    setError("");

    try {
      const [agentsResponse, ownersResponse] = await Promise.all([
        fetch(`${API}/agents`),
        fetch(`${API}/users`)
      ]);

      if (!agentsResponse.ok || !ownersResponse.ok) {
        throw new Error("Failed to load BATN data.");
      }

      const agentsData = await agentsResponse.json();
      const ownersData = await ownersResponse.json();

      setAgents(agentsData);
      setOwners(ownersData);

      if (ownersData.length > 0 && !ownerId) {
        setOwnerId(ownersData[0].id);
      }
    } catch (err) {
      setError(err.message || "Unable to connect to BATN backend.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  // CREATE AGENT
  async function createAgent(e) {
    e.preventDefault();

    setError("");
    setMessage("");

    if (!ownerId) {
      setError("Please select an owner.");
      return;
    }

    if (!agentName.trim()) {
      setError("Please enter an agent name.");
      return;
    }

    setCreating(true);

    try {
      const response = await fetch(`${API}/agents`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          owner_id: ownerId,
          name: agentName.trim(),
          role: agentRole
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Agent creation failed.");
      }

      setMessage(`${agentName.trim()} created successfully.`);
      setAgentName("");

      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  // CHANGE AGENT STATUS
  async function toggleStatus(agent) {
    setError("");
    setMessage("");
    setUpdatingId(agent.id);

    const newStatus =
      agent.status === "active" ? "inactive" : "active";

    try {
      const response = await fetch(
        `${API}/agents/${agent.id}/status`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            status: newStatus
          })
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Status update failed.");
      }

      setMessage(`${agent.name} is now ${newStatus}.`);

      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setUpdatingId("");
    }
  }
  // LOAD EXISTING MANDATE
async function loadMandate(agentId) {
  if (!agentId) return;

  setSelectedMandateAgent(agentId);
  setMandateLoading(true);
  setError("");
  setMessage("");

  try {
    const response = await fetch(`${API}/mandates/${agentId}`);

    if (!response.ok) {
      if (response.status === 404) {
        setMandate({
          max_unit_price: "",
          min_unit_price: "",
          max_quantity: 1,
          max_total_amount: "",
          allowed_items: "*",
          requires_approval: false,
        });

        return;
      }

      throw new Error("Unable to load agent mandate.");
    }

    const data = await response.json();

    setMandate({
      max_unit_price: data.max_unit_price ?? "",
      min_unit_price: data.min_unit_price ?? "",
      max_quantity: data.max_quantity ?? 1,
      max_total_amount: data.max_total_amount ?? "",
      allowed_items: formatAllowedItems(data.allowed_items),
      requires_approval: Boolean(data.requires_approval),
    });
  } catch (err) {
    setError(err.message);
  } finally {
    setMandateLoading(false);
  }
}

// SAVE MANDATE
async function saveMandate(e) {
  e.preventDefault();

  if (mandateSaving) return;

  setError("");
  setMessage("");

  if (!selectedMandateAgent) {
    setError("Select an agent first.");
    return;
  }

  const selectedAgent = agents.find(
    (agent) => agent.id === selectedMandateAgent
  );

  const isSeller = selectedAgent?.role?.toLowerCase() === "seller";

  if (
    Number(mandate.max_quantity) <= 0 ||
    Number(mandate.max_total_amount) <= 0
  ) {
    setError("Quantity and total transaction limit must be greater than zero.");
    return;
  }

  if (isSeller && Number(mandate.min_unit_price) <= 0) {
    setError("Seller mandates require a valid minimum unit price.");
    return;
  }

  if (!isSeller && Number(mandate.max_unit_price) <= 0) {
    setError("Buyer mandates require a valid maximum unit price.");
    return;
  }

  setMandateSaving(true);

  try {
    const allowedItems = parseAllowedItemsInput(mandate.allowed_items);
    if (Array.isArray(allowedItems) && allowedItems.length === 0) {
      setError("Enter at least one allowed product, or use *.");
      return;
    }

    const response = await fetch(
      `${API}/mandates/${selectedMandateAgent}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          max_unit_price: isSeller
            ? null
            : Number(mandate.max_unit_price),

          min_unit_price: isSeller
            ? Number(mandate.min_unit_price)
            : mandate.min_unit_price === ""
              ? null
              : Number(mandate.min_unit_price),

          max_quantity: Number(mandate.max_quantity),

          max_total_amount: Number(mandate.max_total_amount),

          allowed_items: allowedItems,

          requires_approval: mandate.requires_approval,
        }),
      }
    );
    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error || "Failed to save mandate."
      );
    }

    setMessage("Agent mandate saved successfully.");
  }   catch (err) {
    setError(err.message);
  } finally {
    setMandateSaving(false);
  }
}

// COUNTS
const activeCount = agents.filter(
  (agent) => agent.status === "active"
).length;



  const buyerCount = agents.filter(
    (agent) => agent.role === "buyer"
  ).length;

  const sellerCount = agents.filter(
    (agent) => agent.role === "seller"
  ).length;

  return (
    <div className="agents-page">

      {/* HEADER */}
      <div className="agents-header">
        <div>
          <div className="agents-eyebrow">
            <Bot size={16} />
            BATN AGENT NETWORK
          </div>

          <h1>Agent Management</h1>

          <p>
            Create, monitor and control your transaction agents.
          </p>
        </div>

        <button
          className="agents-refresh"
          onClick={loadData}
          disabled={loading}
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      {/* STATISTICS */}
      <div className="agents-stats">

        <div className="agent-stat-card">
          <div className="agent-stat-icon blue">
            <Bot size={20} />
          </div>

          <div>
            <span>Total agents</span>
            <h2>{agents.length}</h2>
          </div>
        </div>

        <div className="agent-stat-card">
          <div className="agent-stat-icon green">
            <ShieldCheck size={20} />
          </div>

          <div>
            <span>Active agents</span>
            <h2>{activeCount}</h2>
          </div>
        </div>

        <div className="agent-stat-card">
          <div className="agent-stat-icon purple">
            <ShoppingCart size={20} />
          </div>

          <div>
            <span>Buyer agents</span>
            <h2>{buyerCount}</h2>
          </div>
        </div>

        <div className="agent-stat-card">
          <div className="agent-stat-icon orange">
            <Store size={20} />
          </div>

          <div>
            <span>Seller agents</span>
            <h2>{sellerCount}</h2>
          </div>
        </div>

      </div>

      {/* NOTIFICATIONS */}
      {error && (
        <div className="agents-alert error">
          <AlertCircle size={18} />
          {error}
        </div>
      )}

      {message && (
        <div className="agents-alert success">
          <ShieldCheck size={18} />
          {message}
        </div>
      )}

      {/* MAIN CONTENT */}
      <div className="agents-content">

        {/* CREATE AGENT */}
        <section className="agents-panel create-agent-panel">

          <div className="agents-panel-heading">
            <div className="agents-heading-icon">
              <Plus size={20} />
            </div>

            <div>
              <h2>Create Agent</h2>
              <p>Register a new BATN transaction agent.</p>
            </div>
          </div>

          {owners.length === 0 ? (
            <div className="agents-empty-owner">
              <AlertCircle size={20} />

              <p>
                No owners found. Register an owner through
                the backend before creating agents.
              </p>
            </div>
          ) : (
            <form onSubmit={createAgent}>

              <label>Agent owner</label>

              <select
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
                required
              >
                {owners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.name}
                    {owner.email ? ` — ${owner.email}` : ""}
                  </option>
                ))}
              </select>

              <label>Agent name</label>

              <input
                type="text"
                placeholder="e.g. Nia Purchasing Agent"
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                maxLength={100}
                required
              />

              <label>Agent role</label>

              <div className="agent-role-selector">

                <button
                  type="button"
                  className={
                    agentRole === "buyer"
                      ? "role-option selected"
                      : "role-option"
                  }
                  onClick={() => setAgentRole("buyer")}
                >
                  <ShoppingCart size={19} />

                  <div>
                    <strong>Buyer</strong>
                    <span>Purchases</span>
                  </div>
                </button>

                <button
                  type="button"
                  className={
                    agentRole === "seller"
                      ? "role-option selected"
                      : "role-option"
                  }
                  onClick={() => setAgentRole("seller")}
                >
                  <Store size={19} />

                  <div>
                    <strong>Seller</strong>
                    <span>Sells</span>
                  </div>
                </button>

              </div>

              <button
                type="submit"
                className="create-agent-button"
                disabled={creating || loading}
              >
                {creating ? (
                  <>
                    <LoaderCircle size={17} />
                    Creating...
                  </>
                ) : (
                  <>
                    <Plus size={17} />
                    Create agent
                  </>
                )}
              </button>

            </form>
          )}

        </section>

        {/* AGENT LIST */}
        <section className="agents-panel agent-list-panel">

          <div className="agents-panel-heading">
            <div className="agents-heading-icon">
              <Bot size={20} />
            </div>

            <div>
              <h2>Registered agents</h2>
              <p>Your agents and their current status.</p>
            </div>
          </div>

          {loading ? (
            <div className="agents-loading">
              <LoaderCircle size={25} />
              Loading agents...
            </div>
          ) : agents.length === 0 ? (
            <div className="agents-empty">
              <Bot size={35} />

              <p>No agents registered yet.</p>

              <span>Create your first agent to get started.</span>
            </div>
          ) : (
            <div className="agent-list">

              {agents.map((agent) => (

                <div className="agent-card" key={agent.id}>

                  <div className="agent-card-main">

                    <div
                      className={`agent-avatar ${
                        agent.role === "buyer"
                          ? "buyer-avatar"
                          : "seller-avatar"
                      }`}
                    >
                      {agent.role === "buyer" ? (
                        <ShoppingCart size={21} />
                      ) : (
                        <Store size={21} />
                      )}
                    </div>

                    <div className="agent-details">

                      <h3>{agent.name}</h3>

                      <span className="agent-owner">
                        Owner: {agent.owner_name || "Unknown"}
                      </span>

                      <span
                        className={`agent-role-tag ${
                          agent.role === "buyer"
                            ? "buyer-tag"
                            : "seller-tag"
                        }`}
                      >
                        {agent.role}
                      </span>

                    </div>

                  </div>

                  <div className="agent-card-controls">

                    <span
                      className={`agent-status ${
                        agent.status === "active"
                          ? "active-status"
                          : "inactive-status"
                      }`}
                    >
                      <span className="status-dot"></span>
                      {agent.status}
                    </span>

                    <button
                      className={`agent-toggle ${
                        agent.status === "active"
                          ? "deactivate-button"
                          : "activate-button"
                      }`}
                      onClick={() => toggleStatus(agent)}
                      disabled={updatingId === agent.id}
                    >
                      {updatingId === agent.id ? (
                        <LoaderCircle size={16} />
                      ) : (
                        <Power size={16} />
                      )}

                      {agent.status === "active"
                        ? "Deactivate"
                        : "Activate"}
                    </button>

                  </div>

                </div>

              ))}

            </div>
          )}

        </section>

      </div>
{/* MANDATE CONFIGURATION */}
<section className="agents-panel mandate-panel">
  <div className="agents-panel-heading">
    <div className="agents-heading-icon">
      <ShieldCheck size={20} />
    </div>

    <div>
      <h2>Agent Mandates</h2>
      <p>Define the boundaries within which agents can transact.</p>
    </div>
  </div>

  {agents.length === 0 ? (
    <p>Create an agent before configuring its mandate.</p>
  ) : (
    <form onSubmit={saveMandate}>
      {error && (
  <div className="mandate-feedback mandate-error">
    {error}
  </div>
)}

{message && (
  <div className="mandate-feedback mandate-success">
    {message}
  </div>
)}
      <label>Select agent</label>

      <select
        value={selectedMandateAgent}
        onChange={(e) => loadMandate(e.target.value)}
        required
      >
        <option value="">Select an agent</option>

        {agents.map((agent) => (
          <option key={agent.id} value={agent.id}>
            {agent.name} ({agent.role})
          </option>
        ))}
      </select>

      {mandateLoading ? (
        <div className="agents-loading">
          <LoaderCircle size={20} />
          Loading mandate...
        </div>
      ) : (
        <>
          <label>Maximum unit price (KES)</label>

          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="e.g. 8000"
            value={mandate.max_unit_price}
            onChange={(e) =>
              setMandate({
                ...mandate,
                max_unit_price: e.target.value,
              })
            }
          />

          <label>Minimum unit price (KES)</label>

          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="Optional — useful for sellers"
            value={mandate.min_unit_price}
            onChange={(e) =>
              setMandate({
                ...mandate,
                min_unit_price: e.target.value,
              })
            }
          />

          <label>Maximum quantity</label>

          <input
            type="number"
            min="1"
            step="1"
            value={mandate.max_quantity}
            onChange={(e) =>
              setMandate({
                ...mandate,
                max_quantity: e.target.value,
              })
            }
            required
          />

          <label>Maximum total transaction value (KES)</label>

          <input
            type="number"
            min="1"
            step="0.01"
            placeholder="e.g. 160000"
            value={mandate.max_total_amount}
            onChange={(e) =>
              setMandate({
                ...mandate,
                max_total_amount: e.target.value,
              })
            }
            required
          />

          <label>Allowed products</label>

          <input
            type="text"
            placeholder="Cement, Steel, Timber or *"
            value={mandate.allowed_items}
            onChange={(e) =>
              setMandate({
                ...mandate,
                allowed_items: e.target.value,
              })
            }
          />

          <span className="agent-owner">
            Separate product names with commas. Use * to allow any product.
          </span>

          <label className="mandate-approval-option">
            <input
              type="checkbox"
              checked={mandate.requires_approval}
              onChange={(e) =>
                setMandate({
                  ...mandate,
                  requires_approval: e.target.checked,
                })
              }
            />

            Require human approval before transactions
          </label>

          <button
            type="submit"
            className="create-agent-button"
            disabled={mandateSaving || !selectedMandateAgent}
          >
            {mandateSaving ? (
              <>
                <LoaderCircle size={17} />
                Saving mandate...
              </>
            ) : (
              <>
                <ShieldCheck size={17} />
                Save mandate
              </>
            )}
          </button>
        </>
      )}
    </form>
  )}
</section>
      {/* FOOTER NOTICE */}
      <div className="agents-security-note">
        <ShieldCheck size={19} />

        <div>
          <strong>Agent control layer</strong>

          <p>
            Agents are currently managed through BATN's backend.
            Activation is an administrative status and does not
            grant payment permissions. Authorization rules and
            transaction controls will be implemented separately.
          </p>
        </div>
      </div>

    </div>
  );
}