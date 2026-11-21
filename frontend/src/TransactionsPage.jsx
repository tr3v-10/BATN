
import { useEffect, useState } from "react";
import { RefreshCw, Search, Eye, X } from "lucide-react";
import "./TransactionsPage.css";

const API = `${(import.meta.env.VITE_API_URL || "http://localhost:5000").replace(/\/+$/, "")}/api/transactions`;

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);

  async function loadTransactions() {
    try {
      setLoading(true);
      setError("");

      const response = await fetch(API);
      if (!response.ok) throw new Error("Failed to load transactions.");

      const data = await response.json();
      setTransactions(data.transactions || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function viewTransaction(id) {
    try {
      setDetailLoading(true);
      setSelected(null);
      setTimeline([]);

      const response = await fetch(`${API}/${id}`);
      if (!response.ok) throw new Error("Failed to load transaction details.");

      const data = await response.json();

      setSelected(data.transaction);
      setTimeline(data.timeline || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    loadTransactions();
  }, []);

  const filtered = transactions.filter((t) =>
    [
      t.item_description,
      t.buyer_name,
      t.seller_name,
      t.transaction_status,
      t.payment_status,
      t.provider_reference
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  function statusClass(status) {
    return (status || "unknown").replace(/_/g, "-");
  }

  return (
    <div className="transactions-page">
      <div className="transactions-heading">
        <div>
          <h2>Transactions</h2>
          <p>Track agreements, payment status and transaction history.</p>
        </div>

        <button className="transaction-refresh" onClick={loadTransactions}>
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      <div className="transaction-stats">
        <div className="transaction-stat">
          <span>Total tracked</span>
          <strong>{transactions.length}</strong>
        </div>

        <div className="transaction-stat">
          <span>Completed</span>
          <strong>
            {transactions.filter(t => t.transaction_status === "completed").length}
          </strong>
        </div>

        <div className="transaction-stat">
          <span>Pending</span>
          <strong>
            {transactions.filter(t =>
              ["agreement_reached", "payment_pending", "payment_initiated",
               "payment_processing"].includes(t.transaction_status)
            ).length}
          </strong>
        </div>

        <div className="transaction-stat">
          <span>Failed</span>
          <strong>
            {transactions.filter(t =>
              t.transaction_status === "payment_failed"
            ).length}
          </strong>
        </div>
      </div>

      <div className="transactions-toolbar">
        <div className="transaction-search">
          <Search size={17} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search transactions..."
          />
        </div>
      </div>

      {error && <div className="transaction-error">{error}</div>}

      {loading ? (
        <div className="transaction-empty">Loading transactions...</div>
      ) : filtered.length === 0 ? (
        <div className="transaction-empty">No transactions found.</div>
      ) : (
        <div className="transaction-table-wrap">
          <table className="transaction-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Buyer</th>
                <th>Seller</th>
                <th>Amount</th>
                <th>Payment</th>
                <th>Transaction</th>
                <th></th>
              </tr>
            </thead>

            <tbody>
              {filtered.map((t) => (
                <tr key={t.id}>
                  <td>
                    <strong>{t.item_description}</strong>
                    <small>Qty: {t.quantity}</small>
                  </td>
                  <td>{t.buyer_name}</td>
                  <td>{t.seller_name}</td>
                  <td>
                    {t.currency} {Number(t.amount || 0).toLocaleString()}
                  </td>
                  <td>
                    <span className={`transaction-status ${statusClass(t.payment_status)}`}>
                      {t.payment_status}
                    </span>
                  </td>
                  <td>
                    <span className={`transaction-status ${statusClass(t.transaction_status)}`}>
                      {t.transaction_status.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td>
                    <button
                      className="transaction-view"
                      onClick={() => viewTransaction(t.id)}
                      title="View details"
                    >
                      <Eye size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detailLoading && (
        <div className="transaction-modal-overlay">
          <div className="transaction-modal">Loading transaction details...</div>
        </div>
      )}

      {selected && (
        <div className="transaction-modal-overlay" onClick={() => setSelected(null)}>
          <div
            className="transaction-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="transaction-modal-heading">
              <div>
                <h3>Transaction Details</h3>
                <p>{selected.item_description}</p>
              </div>
              <button onClick={() => setSelected(null)}>
                <X size={20} />
              </button>
            </div>

            <div className="transaction-detail-grid">
              <div>
                <span>Buyer</span>
                <strong>{selected.buyer_name}</strong>
              </div>
              <div>
                <span>Seller</span>
                <strong>{selected.seller_name}</strong>
              </div>
              <div>
                <span>Quantity</span>
                <strong>{selected.quantity}</strong>
              </div>
              <div>
                <span>Total amount</span>
                <strong>
                  {selected.currency} {Number(selected.amount || 0).toLocaleString()}
                </strong>
              </div>
              <div>
                <span>Payment status</span>
                <strong>{selected.payment_status}</strong>
              </div>
              <div>
                <span>Transaction status</span>
                <strong>{selected.transaction_status.replace(/_/g, " ")}</strong>
              </div>
              <div>
                <span>Provider</span>
                <strong>{selected.provider}</strong>
              </div>
              <div>
                <span>Reference</span>
                <strong className="reference-text">
                  {selected.provider_reference || "Not available"}
                </strong>
              </div>
            </div>

            <div className="transaction-timeline">
              <h4>Transaction Timeline</h4>

              {timeline.length === 0 ? (
                <p>No events recorded.</p>
              ) : (
                timeline.map((event) => (
                  <div className="transaction-event" key={event.id}>
                    <div className="transaction-event-dot"></div>
                    <div>
                      <strong>{event.event_type.replace(/_/g, " ")}</strong>
                      <p>{event.description}</p>
                      <small>{event.created_at}</small>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
