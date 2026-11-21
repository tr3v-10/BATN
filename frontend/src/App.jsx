import React, { useEffect, useState } from "react";
import "./App.css";

const API = (import.meta.env.VITE_API_BASE_URL || "http://localhost:5000").replace(/\/$/, "");
const PAYMENT_ERROR_COPY = {
  INVALID_INPUT: "Enter a valid Kenyan M-Pesa phone number.",
  NEGOTIATION_NOT_FOUND: "We couldn't find this deal. Refresh and try again.",
  NEGOTIATION_NOT_PAYABLE: "This deal is not ready for payment yet.",
  OWNER_APPROVAL_REQUIRED: "Owner approval is required before payment can begin.",
  RISK_REVIEW_REQUIRED: "This deal needs risk clearance before payment.",
  PAYMENT_CANCELLED: "This payment was cancelled. Contact support before trying again.",
  INVALID_TRANSITION: "The payment status has changed. Refresh payment history.",
  MANUAL_RECONCILIATION_REQUIRED: "We could not confirm whether money was deducted. Check your M-Pesa messages or contact support before retrying.",
  RATE_LIMITED: "Too many attempts. Please wait a minute and try again.",
  PROVIDER_CANCEL_UNSUPPORTED: "Payment cancellation is not supported by PayHero for this request."
};
async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(API + "/api" + path, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) }
    });
  } catch {
    throw new Error(path.startsWith("/payments")
      ? "We couldn't reach the payment service. Check your connection and try again."
      : "We couldn't reach the server. Check your connection and try again.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = data.error?.code || data.code;
    const isPaymentRequest = path.startsWith("/payments");
    const message = (isPaymentRequest && PAYMENT_ERROR_COPY[code]) ||
      (isPaymentRequest
        ? "We couldn't complete the payment. Please try again or contact support."
        : (typeof data.error === "string" ? data.error : data.error?.message || data.message || "Request failed (" + response.status + ")"));
    const error = new Error(message);
    error.code = code || "REQUEST_FAILED";
    throw error;
  }
  return data;
}
function auditDescription(entry) {
  let details = {};
  try { details = typeof entry.details === "string" ? JSON.parse(entry.details) : (entry.details || {}); } catch {}
  switch (entry.action) {
    case "payment_created":
      return "Payment created for " + money(details.amount) + ".";
    case "payment_prompt_sent":
      return "M-Pesa prompt sent to " + (details.phone || "the selected number") + " for " + money(details.amount) + ".";
    case "payment_paid":
      return "Payment received" + (details.mpesa_receipt ? ". Receipt: " + details.mpesa_receipt : ".") ;
    case "payment_failed":
      return "Payment failed: " + (details.failure_reason || "please check the payment status") + ".";
    case "payment_retried":
      return "Payment retry started (attempt " + (details.attempt || "next") + ").";
    case "payment_cancelled":
      return "Payment cancelled.";
    case "payment_event_callback_received":
      return "M-Pesa payment update received.";
    default:
      return nice(entry.action);
  }
}
const money = value => "KES " + Number(value || 0).toLocaleString("en-KE");
const nice = value => String(value || "unknown").replaceAll("_", " ");

function Notice({ children, tone = "info" }) {
  return <div className={"notice " + tone}>{children}</div>;
}
function Button({ children, onClick, kind = "primary", type = "button", disabled = false }) {
  return <button type={type} disabled={disabled} className={"btn " + kind} onClick={onClick}>{children}</button>;
}
function Empty({ children }) { return <div className="empty">{children}</div>; }

export default function App() {
  const [page, setPage] = useState("Dashboard");
  const [dashboard, setDashboard] = useState(null);
  const [agents, setAgents] = useState([]);
  const [owners, setOwners] = useState([]);
  const [mandates, setMandates] = useState([]);
  const [negotiations, setNegotiations] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [payments, setPayments] = useState([]);
  const [audit, setAudit] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [newDeal, setNewDeal] = useState(false);
  const [status, setStatus] = useState("Checking backend");
  const [payDeal, setPayDeal] = useState(null);

  async function load() {
    setLoading(true); setError("");
    try {
      const health = await request("/status");
      setStatus(health.status || "online");
      const agentData = await request("/agents");
      setAgents(Array.isArray(agentData) ? agentData : agentData.agents || []);
      if (page === "Dashboard") {
        const results = await Promise.all([request("/dashboard"), request("/negotiations"), request("/audit")]);
        setDashboard(results[0]); setNegotiations(results[1].negotiations || []); setAudit(Array.isArray(results[2]) ? results[2] : results[2].logs || []);
      } else if (page === "Agents") {
        const results = await Promise.all([request("/agents"), request("/users"), request("/mandates")]);
        setAgents(Array.isArray(results[0]) ? results[0] : results[0].agents || []);
        setOwners(Array.isArray(results[1]) ? results[1] : results[1].users || []);
        setMandates(results[2].mandates || []);
      } else if (page === "Negotiations") {
        const result = await request("/negotiations"); setNegotiations(result.negotiations || []);
      } else if (page === "Risk review") {
        const result = await request("/risk/review-queue"); setReviews(result.reviews || []);
      } else if (page === "Payments") {
        const results = await Promise.all([request("/payments"), request("/negotiations")]); setPayments(results[0].payments || []); setNegotiations(results[1].negotiations || []);
      } else if (page === "Activity") {
        const results = await Promise.all([request("/audit"), request("/transactions")]);
        setAudit(Array.isArray(results[0]) ? results[0] : results[0].logs || []);
        setTransactions(results[1].transactions || []);
      }
    } catch (e) {
      setStatus("offline"); setError(e.message);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [page]);

  async function createAgent() {
    try {
      let ownerList = owners;
      if (!ownerList.length) {
        const name = window.prompt("No owners exist. Enter the owner's name:");
        if (!name) return;
        const email = window.prompt("Owner email (optional):") || "";
        const created = await request("/users", { method: "POST", body: JSON.stringify({ name, email: email || null }) });
        ownerList = [created.user]; setOwners(ownerList);
      }
      const name = window.prompt("Agent name:");
      if (!name) return;
      const role = window.prompt("Agent role: enter buyer or seller", "buyer");
      if (!["buyer", "seller"].includes((role || "").toLowerCase())) throw new Error("Role must be buyer or seller.");
      await request("/agents", { method: "POST", body: JSON.stringify({ owner_id: ownerList[0].id, name, role: role.toLowerCase() }) });
      setMessage("Agent created. Configure its mandate before activating negotiations."); load();
    } catch (e) { setError(e.message); }
  }
  async function toggleAgent(agent) {
    try {
      await request("/agents/" + agent.id + "/status", { method: "PATCH", body: JSON.stringify({ status: agent.status === "active" ? "inactive" : "active" }) });
      setMessage(agent.name + " status updated."); load();
    } catch (e) { setError(e.message); }
  }
  async function setMandate(agent) {
    try {
      const items = window.prompt("Allowed items, comma-separated, or * for all:", "*");
      if (items === null) return;
      const maxQuantity = Number(window.prompt("Maximum quantity per deal:", "50"));
      const maxTotal = Number(window.prompt("Maximum total amount (KES):", "100000"));
      const unitPrice = Number(window.prompt(agent.role === "buyer" ? "Maximum unit price (KES):" : "Minimum unit price (KES):", "1000"));
      if (!Number.isInteger(maxQuantity) || maxQuantity < 1 || maxTotal <= 0 || unitPrice <= 0) throw new Error("Enter valid positive mandate limits.");
      await request("/mandates/" + agent.id, { method: "PUT", body: JSON.stringify({
        max_unit_price: agent.role === "buyer" ? unitPrice : null,
        min_unit_price: agent.role === "seller" ? unitPrice : null,
        max_quantity: maxQuantity, max_total_amount: maxTotal,
        allowed_items: items.trim() === "*" ? "*" : items.split(",").map(x => x.trim()).filter(Boolean),
        requires_approval: window.confirm("Require owner approval for every negotiation?")
      }) });
      setMessage("Mandate saved for " + agent.name + "."); load();
    } catch (e) { setError(e.message); }
  }
  async function review(item, action) {
    try {
      const reviewer = window.prompt("Your name for the audit record:");
      if (!reviewer) return;
      const notes = window.prompt("Optional review note:") || "";
      const result = await request("/risk/" + item.negotiation_id + "/review", { method: "POST", body: JSON.stringify({ action, reviewer, notes }) });
      setMessage(result.message); load();
    } catch (e) { setError(e.message); }
  }
  async function advancePayment(payment) {
    const next = { pending: "initiated", initiated: "processing", processing: "paid" }[payment.status];
    if (!next) return;
    try {
      await request("/payments/" + payment.id + "/status", { method: "PATCH", body: JSON.stringify({ status: next }) });
      setMessage("Mock payment advanced to " + next + "."); load();
    } catch (e) { setError(e.message); }
  }

  const nav = ["Dashboard", "Agents", "Negotiations", "Risk review", "Payments", "Activity"];
  const activeDeals = negotiations.filter(n => !["rejected", "blocked", "completed"].includes(n.status)).length;
  const content = page === "Dashboard" ? <section>
    <div className="page-head"><div><span className="eyebrow">BILATERAL AGENT TRANSACTION NETWORK</span><h1>Your network at a glance.</h1><p>Live operational data from the BATN backend.</p></div><Button onClick={() => setNewDeal(true)}>＋ Start a negotiation</Button></div>
    {error && <Notice tone="error">Live data unavailable: {error}</Notice>}
    <div className="stats">
      <article><span>Total transactions</span><strong>{dashboard?.totalTransactions ?? "—"}</strong><small>Recorded transactions</small></article>
      <article><span>Active negotiations</span><strong>{activeDeals}</strong><small>From negotiation engine</small></article>
      <article><span>Completed transactions</span><strong>{dashboard?.completedTransactions ?? "—"}</strong><small>Successfully completed</small></article>
      <article><span>Flagged transactions</span><strong>{dashboard?.flaggedTransactions ?? "—"}</strong><small>Require attention</small></article>
    </div>
    <div className="panel"><div className="panel-title"><h2>Recent audit activity</h2><button className="link" onClick={() => setPage("Activity")}>View activity →</button></div>
      {audit.length ? audit.slice(0, 5).map((x, i) => <div className="list-row" key={x.id || i}><span className="dot"></span><div><strong>{auditDescription(x)}</strong><small>{x.actor || "System"} · {x.entity_type || "event"} · {x.created_at || ""}</small></div></div>) : <Empty>No audit activity recorded yet.</Empty>}
    </div>
    <Notice>Authentication, user sessions and role-based access are not implemented in the current backend. This workspace is an integration preview, not a secure production login.</Notice>
  </section> : null;

  return <div className="shell">
    <aside className="sidebar"><div className="brand"><span className="brand-mark">J</span><span>JADILI<small>BATN WORKSPACE</small></span></div>
      <div className="nav-label">WORKSPACE</div>{nav.map(item => <button key={item} className={"nav-item " + (page === item ? "active" : "")} onClick={() => setPage(item)}><span>{({Dashboard:"◫",Agents:"◎",Negotiations:"⇄","Risk review":"⬡",Payments:"▣",Activity:"◷"})[item]}</span>{item}{item === "Risk review" && reviews.length > 0 ? <b>{reviews.length}</b> : null}</button>)}
      <div className="sidebar-bottom"><div className="security-card"><strong>Mandate protection</strong><small>Trading rules are validated by the backend before negotiation.</small></div><small className="branch-label">FEATURE BRANCH PREVIEW</small></div>
    </aside>
    <main className="main">
      <header className="topbar"><div><span className={"health-dot " + (status === "online" ? "online" : "offline")}></span> Backend {status}</div><div className="top-right"><span className="demo-pill">AUTH: NOT CONNECTED</span><button onClick={load}>↻ Refresh</button></div></header>
      <div className="content">
        {page === "Dashboard" && content}
        {page === "Agents" && <section><div className="page-head"><div><span className="eyebrow">LIVE BATN DATA</span><h1>Agent management</h1><p>Create agents, configure mandates and control their status.</p></div><Button onClick={createAgent}>＋ Add agent</Button></div>{error && <Notice tone="error">{error}</Notice>}{message && <Notice tone="success">{message}</Notice>}{loading ? <Empty>Loading agents…</Empty> : agents.length ? <div className="cards">{agents.map(agent => { const mandate = mandates.find(m => m.agent_id === agent.id); return <article className="agent-card" key={agent.id}><div className="card-top"><span className="avatar">{agent.name.split(/\s+/).map(x => x[0]).slice(0,2).join("").toUpperCase()}</span><span className={"status " + agent.status}>{agent.status}</span></div><h2>{agent.name}</h2><p>{agent.role} · {agent.owner_name || owners.find(o => o.id === agent.owner_id)?.name || "Owner"}</p><div className="card-meta"><span>Mandate</span><strong>{mandate ? "Configured" : "Not set"}</strong></div>{mandate && <small>Max quantity {mandate.max_quantity} · Total limit {money(mandate.max_total_amount)}</small>}<div className="actions"><Button kind="secondary" onClick={() => setMandate(agent)}>Set mandate</Button><Button kind="ghost" onClick={() => toggleAgent(agent)}>{agent.status === "active" ? "Deactivate" : "Activate"}</Button></div></article> })}</div> : <Empty>No agents yet. Add an owner and create the first buyer or seller agent.</Empty>}</section>}
        {page === "Negotiations" && <section><div className="page-head"><div><span className="eyebrow">LIVE BATN DATA</span><h1>Negotiations</h1><p>Records returned by the BATN negotiation engine.</p></div><Button onClick={() => setNewDeal(true)}>＋ New negotiation</Button></div>{error && <Notice tone="error">{error}</Notice>}<div className="panel table-wrap"><table><thead><tr><th>Item</th><th>Buyer</th><th>Seller</th><th>Qty</th><th>Final unit price</th><th>Status</th></tr></thead><tbody>{negotiations.map(n => <tr key={n.id}><td><strong>{n.item_description}</strong><small>{n.created_at || n.id}</small></td><td>{n.buyer_name}</td><td>{n.seller_name}</td><td>{n.quantity}</td><td>{n.final_price ? money(n.final_price) : "—"}</td><td><span className="status">{nice(n.status)}</span></td></tr>)}</tbody></table>{!negotiations.length && <Empty>No negotiations recorded.</Empty>}</div></section>}
        {page === "Risk review" && <section><div className="page-head"><div><span className="eyebrow">RISK ENGINE</span><h1>Human review queue</h1><p>Only unreviewed risk assessments with decision “review” appear here.</p></div></div>{error && <Notice tone="error">{error}</Notice>}{reviews.length ? reviews.map(item => <article className="panel review-card" key={item.negotiation_id}><div><span className="eyebrow">RISK SCORE {item.risk_score} · {item.risk_level}</span><h2>{item.item_description} · {item.quantity} units</h2><p>{item.buyer_name} ↔ {item.seller_name}</p><small>{(item.flags || []).join(" · ")}</small></div><div className="actions"><Button onClick={() => review(item, "approve")}>Approve review</Button><Button kind="secondary" onClick={() => review(item, "reject")}>Reject</Button></div></article>) : <Empty>No risk reviews waiting.</Empty>}<Notice>Mandate-based “pending approval” negotiations are not currently exposed through a dedicated approval endpoint. This screen handles the backend’s risk-review queue only.</Notice></section>}
        {page === "Payments" && <section><div className="page-head"><div><span className="eyebrow">PAYMENT INTENTS</span><h1>Payments</h1><p>Pay approved deals and follow M-Pesa status.</p></div></div>{error && <Notice tone="error">{error}</Notice>}{message && <Notice tone="success">{message}</Notice>}<div className="panel"><h2>Approved deals ready for payment</h2>{negotiations.filter(n => n.status === "accepted").map(n => <div className="list-row" key={n.id}><span className="dot"></span><div><strong>{n.item_description} · {n.quantity} units</strong><small>{n.buyer_name} → {n.seller_name} · {money(Number(n.final_price) * Number(n.quantity))}</small></div><Button kind="secondary" onClick={() => setPayDeal(n)}>Pay now</Button></div>)}{!negotiations.some(n => n.status === "accepted") && <Empty>No approved deals are currently awaiting payment.</Empty>}</div><div className="panel table-wrap"><h2>Payment history</h2><table><thead><tr><th>Item</th><th>Parties</th><th>Amount</th><th>Provider</th><th>Phone</th><th>Receipt</th><th>Status</th><th>Action</th></tr></thead><tbody>{payments.map(p => <tr key={p.id}><td><strong>{p.item_description}</strong><small>{p.quantity} units</small></td><td>{p.buyer_name} → {p.seller_name}</td><td>{money(p.amount)}</td><td>{p.provider}</td><td>{p.phone || "—"}</td><td>{p.mpesa_receipt || "—"}</td><td><span className="status">{p.status}</span></td><td>{p.provider === "mock" && ({pending:"initiated",initiated:"processing",processing:"paid"})[p.status] ? <Button kind="secondary" onClick={() => advancePayment(p)}>Advance demo</Button> : "—"}</td></tr>)}</tbody></table>{!payments.length && <Empty>No payment intents yet.</Empty>}</div><Notice>Mock mode is for offline demonstrations. Select PAYMENT_PROVIDER=payhero only after configuring PayHero credentials and a public HTTPS callback URL.</Notice></section>}
        {page === "Activity" && <section><div className="page-head"><div><span className="eyebrow">AUDIT & TRACKING</span><h1>Activity history</h1><p>Backend audit logs and transaction tracking records.</p></div></div>{error && <Notice tone="error">{error}</Notice>}<div className="panel"><h2>Audit log</h2>{audit.map((x,i) => <div className="list-row" key={x.id || i}><span className="dot"></span><div><strong>{auditDescription(x)}</strong><small>{x.actor} · {x.entity_type} · {x.entity_id} · {x.created_at}</small></div></div>)}{!audit.length && <Empty>No audit records.</Empty>}</div><div className="panel"><h2>Transaction tracking</h2>{transactions.map((x,i) => <div className="list-row" key={x.id || i}><span className="dot"></span><div><strong>{x.item_description} · {x.quantity} units</strong><small>{x.buyer_name} → {x.seller_name} · {nice(x.transaction_status)} · {x.created_at}</small></div></div>)}{!transactions.length && <Empty>No tracked transactions yet.</Empty>}</div></section>}
      </div>
    </main>
    {newDeal && <NewNegotiation agents={agents} onClose={() => setNewDeal(false)} onDone={() => { setNewDeal(false); setPage("Negotiations"); }} />}{payDeal && <PaymentFlow deal={payDeal} onClose={() => setPayDeal(null)} onUpdated={() => { load(); }} />}
  </div>;
}

function NewNegotiation({ agents, onClose, onDone }) {
  const [buyer, setBuyer] = useState(agents.find(a => a.role === "buyer" && a.status === "active")?.id || "");
  const [seller, setSeller] = useState(agents.find(a => a.role === "seller" && a.status === "active")?.id || "");
  const [item, setItem] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [offer, setOffer] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const active = agents.filter(a => a.status === "active");
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const result = await request("/negotiations", { method: "POST", body: JSON.stringify({ buyer_agent_id: buyer, seller_agent_id: seller, item_description: item.trim(), quantity: Number(quantity), initial_offer: Number(offer) }) });
      window.alert("BATN response: " + result.status + "\n" + result.message + "\nNegotiation ID: " + result.negotiation_id);
      onDone();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}><form className="modal" onSubmit={submit}><button type="button" className="close" onClick={onClose}>×</button><span className="eyebrow">BACKEND-VALIDATED</span><h2>Start a negotiation</h2><p>Both agents must be active and have valid mandates.</p>{error && <Notice tone="error">{error}</Notice>}{!active.some(a => a.role === "buyer") || !active.some(a => a.role === "seller") ? <Notice tone="error">You need an active buyer and seller agent with saved mandates before starting.</Notice> : <><label>Buyer agent<select value={buyer} onChange={e => setBuyer(e.target.value)} required><option value="">Choose buyer</option>{active.filter(a => a.role === "buyer").map(a => <option value={a.id} key={a.id}>{a.name}</option>)}</select></label><label>Seller agent<select value={seller} onChange={e => setSeller(e.target.value)} required><option value="">Choose seller</option>{active.filter(a => a.role === "seller").map(a => <option value={a.id} key={a.id}>{a.name}</option>)}</select></label><label>Item<input value={item} onChange={e => setItem(e.target.value)} required placeholder="e.g. Cement" /></label><div className="two"><label>Quantity<input type="number" min="1" step="1" value={quantity} onChange={e => setQuantity(e.target.value)} required /></label><label>Initial offer per unit (KES)<input type="number" min="0.01" step="0.01" value={offer} onChange={e => setOffer(e.target.value)} required /></label></div><Button type="submit" disabled={busy}>{busy ? "Submitting…" : "Submit to BATN"}</Button></>}<Button kind="ghost" onClick={onClose}>Cancel</Button></form></div>;
}
function PaymentFlow({ deal, onClose, onUpdated }) {
  const [phone, setPhone] = useState("");
  const [payment, setPayment] = useState(null);
  const [seconds, setSeconds] = useState(60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const finished = payment && ["paid", "failed", "cancelled"].includes(payment.status);
  const activeStep = !payment ? 0 : payment.status === "paid" ? 3 : payment.status === "processing" ? 2 : 1;
  useEffect(() => {
    if (!payment || finished) return;
    const poll = setInterval(async () => {
      try {
        const result = await request("/payments/" + payment.id);
        setPayment(result.payment);
        if (["paid", "failed", "cancelled"].includes(result.payment.status)) onUpdated();
      } catch (_) {}
    }, 3000);
    return () => clearInterval(poll);
  }, [payment?.id, payment?.status, finished]);
  useEffect(() => {
    if (!payment || finished || seconds <= 0) return;
    const timer = setTimeout(() => setSeconds(s => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [payment, finished, seconds]);
  async function start() {
    setBusy(true); setError("");
    try {
      const result = await request("/payments/initiate", { method: "POST", body: JSON.stringify({ negotiationId: deal.id, phone }) });
      setPayment(result.payment); setSeconds(60); onUpdated();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function retry() {
    setBusy(true); setError("");
    try {
      const result = await request("/payments/" + payment.id + "/retry", { method: "POST", body: JSON.stringify({ phone }) });
      setPayment(result.payment); setSeconds(60);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <div className="overlay"><div className="modal"><button className="close" onClick={onClose}>×</button><span className="eyebrow">M-PESA PAYMENT</span><h2>{payment ? "Payment status" : "Pay approved deal"}</h2><p>{deal.item_description} · {deal.quantity} units</p><h2>{money(Number(deal.final_price) * Number(deal.quantity))}</h2><div className="payment-steps">{["Ready", "Sent", "Processing", "Paid"].map((label, index) => <span key={label} className={index <= activeStep ? "status active" : "status"}>{label}</span>)}</div>{error && <Notice tone="error">{error}</Notice>}
    {!payment ? <><label>M-Pesa phone number<input value={phone} onChange={e => setPhone(e.target.value)} placeholder="0712345678" /></label><small>We'll send an M-Pesa prompt to this number.</small><Button onClick={start} disabled={busy || !phone.trim()}>{busy ? "Sending…" : "Send M-Pesa prompt"}</Button></> :
    <><p>{payment.status === "paid" ? "✓ Payment received. Receipt: " + (payment.mpesa_receipt || "confirmed") : payment.failure_reason === "Timed out waiting for M-Pesa" ? "We didn't get a response from M-Pesa. If money left your account, don't pay again. Check History or contact us." : payment.status === "failed" ? "Payment didn't go through. You haven't been charged. Try again." : payment.status === "cancelled" ? "You cancelled the payment." : seconds === 0 ? "Still waiting for M-Pesa. Do not submit another payment while this request is unresolved." : "Check your phone and enter your M-Pesa PIN."}</p>{!finished && <p>Waiting for M-Pesa · {seconds}s</p>}{payment.status === "failed" && payment.failure_reason !== "Timed out waiting for M-Pesa" ? <Button onClick={retry} disabled={busy}>Retry</Button> : null}{(payment.failure_reason === "Timed out waiting for M-Pesa" || (!finished && seconds === 0)) && <Notice tone="error">Do not submit another payment until you confirm whether money left your account.</Notice>}</>}
    <Button kind="ghost" onClick={onClose}>Close</Button>
  </div></div>;
}
