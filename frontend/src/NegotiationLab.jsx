
import { useEffect, useState } from "react";

const API_BASE = (import.meta.env.VITE_API_URL || "http://localhost:5000").replace(/\/+$/, "");
const API = `${API_BASE}/api`;

export default function NegotiationLab() {
  const [agents, setAgents] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [buyer, setBuyer] = useState("");
  const [seller, setSeller] = useState("");
  const [item, setItem] = useState("Cement");
  const [quantity, setQuantity] = useState(2);
  const [offer, setOffer] = useState(7800);
  const [delay, setDelay] = useState(2);
  const [autoPayment, setAutoPayment] = useState(true);
  const [selectedJob, setSelectedJob] = useState(null);
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function loadData() {
    try {
      const [agentResponse, jobResponse] = await Promise.all([
        fetch(`${API}/agents`),
        fetch(`${API}/automation`)
      ]);

      const agentData = await agentResponse.json();
      const jobData = await jobResponse.json();

      const agentList = Array.isArray(agentData)
        ? agentData
        : agentData.agents || [];

      setAgents(agentList);
      setJobs(jobData.jobs || []);

      if (!buyer) {
        const firstBuyer = agentList.find(a => a.role === "buyer");
        if (firstBuyer) setBuyer(firstBuyer.id);
      }

      if (!seller) {
        const firstSeller = agentList.find(a => a.role === "seller");
        if (firstSeller) setSeller(firstSeller.id);
      }
    } catch {
      setError("Could not load agents or automation jobs. Check the backend.");
    }
  }

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 3000);
    return () => clearInterval(interval);
  }, []);

  async function createJob(e) {
    e.preventDefault();
    setBusy(true);
    setError("");

    try {
      const response = await fetch(`${API}/automation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          buyer_agent_id: buyer,
          seller_agent_id: seller,
          item_description: item,
          quantity: Number(quantity),
          initial_offer: Number(offer),
          response_delay_seconds: Number(delay),
          auto_payment: autoPayment,
          max_rounds: 8
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.message || "Job creation failed");
      }

      setSelectedJob(data.job?.id || data.id || null);
      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function viewJob(id) {
    setSelectedJob(id);
    try {
      const response = await fetch(
        `${API}/automation/${id}/messages`
      );
      const data = await response.json();
      setMessages(data.messages || []);
    } catch {
      setMessages([]);
    }
  }

  useEffect(() => {
    if (!selectedJob) return;

    async function refreshMessages() {
      try {
        const response = await fetch(
          `${API}/automation/${selectedJob}/messages`
        );
        const data = await response.json();
        setMessages(data.messages || []);
      } catch {}
    }

    refreshMessages();
    const interval = setInterval(refreshMessages, 2000);
    return () => clearInterval(interval);
  }, [selectedJob]);

  const buyers = agents.filter(a => a.role === "buyer");
  const sellers = agents.filter(a => a.role === "seller");

  return (
    <div style={{ padding: 24, color: "inherit" }}>
      <div style={{ marginBottom: 24 }}>
        <h2>Negotiation Lab</h2>
        <p style={{ opacity: 0.7 }}>
          Configure and observe autonomous agent negotiations.
        </p>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "minmax(280px, 1fr) minmax(280px, 1fr)",
        gap: 20
      }}>
        <section style={{
          padding: 20,
          border: "1px solid #344155",
          borderRadius: 12
        }}>
          <h3>Create negotiation</h3>

          <form onSubmit={createJob}>
            <label>Buyer agent</label>
            <select value={buyer} onChange={e => setBuyer(e.target.value)}
              required style={fieldStyle}>
              <option value="">Select buyer</option>
              {buyers.map(a => <option key={a.id} value={a.id}>
                {a.name}
              </option>)}
            </select>

            <label>Seller agent</label>
            <select value={seller} onChange={e => setSeller(e.target.value)}
              required style={fieldStyle}>
              <option value="">Select seller</option>
              {sellers.map(a => <option key={a.id} value={a.id}>
                {a.name}
              </option>)}
            </select>

            <label>Item</label>
            <input value={item} onChange={e => setItem(e.target.value)}
              required style={fieldStyle}/>

            <label>Quantity</label>
            <input type="number" min="1" value={quantity}
              onChange={e => setQuantity(e.target.value)}
              required style={fieldStyle}/>

            <label>Opening unit offer (KES)</label>
            <input type="number" min="1" value={offer}
              onChange={e => setOffer(e.target.value)}
              required style={fieldStyle}/>

            <label>Response delay (seconds)</label>
            <input type="number" min="1" max="300" value={delay}
              onChange={e => setDelay(e.target.value)}
              required style={fieldStyle}/>

            <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "12px 0" }}>
              <input type="checkbox" checked={autoPayment}
                onChange={e => setAutoPayment(e.target.checked)}/>
              Enable simulated auto-payment (recommended)
            </label>
            <small style={{ display: "block", opacity: 0.7, margin: "-4px 0 14px" }}>
              This creates a transaction record and a mock payment intent only. No real money moves.
            </small>

            <button disabled={busy || !buyer || !seller || buyer === seller}
              style={buttonStyle}>
              {busy ? "Launching..." : "Launch negotiation"}
            </button>
          </form>

          {error && <p style={{ color: "#ff7676" }}>{error}</p>}
        </section>

        <section style={{
          padding: 20,
          border: "1px solid #344155",
          borderRadius: 12
        }}>
          <h3>Automation jobs</h3>

          <div style={{ maxHeight: 450, overflowY: "auto" }}>
            {jobs.length === 0 && <p>No jobs yet.</p>}

            {jobs.map(job => (
              <div key={job.id} onClick={() => viewJob(job.id)}
                style={{
                  padding: 14,
                  marginBottom: 10,
                  border: "1px solid #344155",
                  borderRadius: 10,
                  cursor: "pointer"
                }}>
                <strong>{job.item_description}</strong>
                <p style={{ margin: "5px 0" }}>
                  {job.buyer_name} → {job.seller_name}
                </p>
                <small>
                  Qty: {job.quantity} · Round: {job.current_round}
                </small>
                <p style={{ margin: "8px 0" }}>
                  Status: <strong>{job.status}</strong>
                </p>
                {job.error && <small style={{ color: "#ff7676" }}>
                  {job.error}
                </small>}
              </div>
            ))}
          </div>
        </section>
      </div>

      <section style={{
        padding: 20,
        border: "1px solid #344155",
        borderRadius: 12,
        marginTop: 20
      }}>
        <h3>Negotiation conversation</h3>
        {!selectedJob && <p>Select a job to view its conversation.</p>}

        {selectedJob && messages.length === 0 &&
          <p>No messages recorded yet.</p>}

        {messages.map(message => (
          <div key={message.id} style={{
            padding: 12,
            marginBottom: 10,
            borderRadius: 8,
            background: "#172233"
          }}>
            <strong>
              {message.sender_name || message.sender_role || message.sender_agent_id}
            </strong>
            <p>{message.message}</p>
            {message.proposed_amount != null &&
              <small>Proposal: KES {Number(message.proposed_amount).toLocaleString()}</small>}
          </div>
        ))}
      </section>
    </div>
  );
}

const fieldStyle = {
  display: "block",
  width: "100%",
  padding: 10,
  margin: "8px 0 16px",
  borderRadius: 8,
  border: "1px solid #344155",
  background: "#101827",
  color: "white",
  boxSizing: "border-box"
};

const buttonStyle = {
  padding: 12,
  width: "100%",
  borderRadius: 8,
  background: "#2563eb",
  color: "white",
  border: "none",
  cursor: "pointer",
  fontWeight: 600
};
