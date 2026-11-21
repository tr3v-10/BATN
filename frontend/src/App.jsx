import AgentsPage from "./AgentsPage";
import NegotiationLab from "./NegotiationLab";
import TransactionsPage from "./TransactionsPage";
import { useEffect, useState } from "react";

import {
  LayoutDashboard,
  ArrowLeftRight,
  Bot,
  ShieldCheck,
  Activity,
  Settings,
  Bell,
  Search,
  ArrowUpRight,
  ArrowDownLeft,
  Clock3,
  CheckCircle2,
  AlertTriangle,
  CircleDollarSign,
  Menu,
  X,
  ChevronRight,
  Zap,
  ShieldAlert,
  RefreshCw,
  MessageCircle
} from "lucide-react";

import "./App.css";
import VoiceChat from "./VoiceChat";

const navigation = [
  { label: "Voice Chat", icon: MessageCircle },
  { label: "Negotiation Lab", icon: Zap },
  { label: "Overview", icon: LayoutDashboard },
  { label: "Transactions", icon: ArrowLeftRight },
  { label: "Agents", icon: Bot },
  { label: "Security", icon: ShieldCheck },
  { label: "Activity", icon: Activity },
];
function App() {
  const [activePage, setActivePage] = useState("Overview");
  const [dashboard, setDashboard] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [search, setSearch] = useState("");

   useEffect(() => {
  async function fetchDashboardData() {
    try {
      const [dashboardResponse, transactionsResponse] =
        await Promise.all([
          fetch("http://localhost:5000/api/dashboard"),
          fetch("http://localhost:5000/api/transactions"),
        ]);

      if (!dashboardResponse.ok || !transactionsResponse.ok) {
        throw new Error("Failed to fetch dashboard data");
      }

      const dashboardData = await dashboardResponse.json();
      const transactionData = await transactionsResponse.json();

      setDashboard(dashboardData);

      const records = transactionData.transactions || [];

      setTransactions(
        records.map((transaction) => {
          const status =
            transaction.transaction_status ||
            transaction.payment_status ||
            "unknown";

          const formattedStatus =
            status === "completed" || status === "paid"
              ? "Completed"
              : status === "payment_pending" ||
                status === "payment_initiated" ||
                status === "payment_processing" ||
                status === "pending" ||
                status === "initiated" ||
                status === "processing"
              ? "Pending"
              : status === "payment_failed" ||
                status === "failed" ||
                status === "cancelled"
              ? status === "cancelled"
                ? "Cancelled"
                : "Failed"
              : status === "pending_risk_review" ||
                status === "review_required"
              ? "Review"
              : status.replace(/_/g, " ");

          return {
            id: transaction.id,

            name: `${transaction.buyer_name || "Buyer"} → ${
              transaction.seller_name || "Seller"
            }`,

            detail: `${transaction.item_description || "Transaction"} · ${
              transaction.quantity ?? 0
            } units`,

            amount: `${transaction.currency || "KES"} ${Number(
              transaction.amount || 0
            ).toLocaleString()}`,

            status: formattedStatus,

            date: transaction.created_at
              ? new Date(
                  transaction.created_at.replace(" ", "T") + "Z"
                ).toLocaleString()
              : "Unknown date",

            icon: ArrowUpRight,
          };
        })
      );

      setApiError(false);
    } catch (error) {
      console.error("Dashboard fetch error:", error);
      setApiError(true);
    } finally {
      setLoading(false);
    }
  }

  fetchDashboardData();
}, []);

        

       

  const filteredTransactions = transactions.filter((transaction) =>
    `${transaction.name} ${transaction.id} ${transaction.detail}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  const stats = [
    {
      label: "Total transactions",
      value: dashboard?.totalTransactions ?? "--",
      note: "All recorded transactions",
      icon: ArrowLeftRight,
      color: "blue",
    },
    {
      label: "Completed",
      value: dashboard?.completedTransactions ?? "--",
      note: "Successfully completed",
      icon: CheckCircle2,
      color: "green",
    },
    {
      label: "Pending",
      value: dashboard?.pendingTransactions ?? "--",
      note: "Awaiting confirmation",
      icon: Clock3,
      color: "amber",
    },
    {
      label: "Flagged",
      value: dashboard?.flaggedTransactions ?? "--",
      note: "Require attention",
      icon: ShieldAlert,
      color: "red",
    },
  ];

  return (
    <div className="app-shell">
      {mobileMenu && (
        <div
          className="mobile-overlay"
          onClick={() => setMobileMenu(false)}
        />
      )}

      <aside className={`sidebar ${mobileMenu ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-symbol">
            <Zap size={21} />
          </div>
          <div>
            <h1>BATN</h1>
            <span>TRANSACTION NETWORK</span>
          </div>
          <button
            className="mobile-close"
            onClick={() => setMobileMenu(false)}
          >
            <X size={19} />
          </button>
        </div>

        <div className="nav-caption">WORKSPACE</div>

        <nav className="navigation">
          {navigation.map((item) => {
            const Icon = item.icon;

            return (
              <button
                key={item.label}
                className={`nav-item ${
                  activePage === item.label ? "active" : ""
                }`}
                onClick={() => {
                  setActivePage(item.label);
                  setMobileMenu(false);
                }}
              >
                <Icon size={19} />
                <span>{item.label}</span>
                {item.label === "Security" && (
                  <span className="nav-indicator">!</span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-bottom">
          <div className="security-mini">
            <ShieldCheck size={20} />
            <div>
              <strong>Security layer</strong>
              <span>Policy-based control</span>
            </div>
          </div>

          <button className="nav-item settings-item">
            <Settings size={19} />
            <span>Settings</span>
          </button>

          <div className="profile">
            <div className="avatar">B</div>
            <div className="profile-info">
              <strong>BATN Workspace</strong>
              <span>Administrator</span>
            </div>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <button
            className="menu-button"
            onClick={() => setMobileMenu(true)}
          >
            <Menu size={21} />
          </button>

          <div className="breadcrumb">
            <span>Workspace</span>
            <ChevronRight size={15} />
            <strong>{activePage}</strong>
          </div>

          <div className="topbar-actions">
            <div className="system-status">
              <span className={`status-dot ${apiError ? "offline" : ""}`} />
              {apiError ? "API disconnected" : "System online"}
            </div>

            <button className="icon-button notification-button">
              <Bell size={19} />
              <span className="notification-dot" />
            </button>
          </div>
        </header>

        <div className="page-content">
          <section className="welcome-section">
            <div>
              <div className="eyebrow">BILATERAL AGENT NETWORK</div>
              <h2>
                {activePage === "Overview"
                  ? "Overview"
                  : activePage}
              </h2>
              <p>
                Monitor agent activity, transactions and trust
                across your network.
              </p>
            </div>

            <div className="date-chip">
              <Activity size={16} />
              Live workspace
            </div>
          </section>

          {apiError && (
            <div className="api-warning">
              <AlertTriangle size={18} />
              <div>
                <strong>Backend unavailable</strong>
                <p>
                  Dashboard statistics cannot be retrieved.
                  Check that the BATN backend is running.
                </p>
              </div>
              <button
                onClick={() => window.location.reload()}
                className="retry-button"
              >
                <RefreshCw size={15} />
                Retry
              </button>
            </div>
          )}

          {activePage === "Overview" ? (
            <>
              <section className="stats-grid">
                {stats.map((stat) => {
                  const Icon = stat.icon;

                  return (
                    <div className="stat-card" key={stat.label}>
                      <div className="stat-top">
                        <span>{stat.label}</span>
                        <div className={`stat-icon ${stat.color}`}>
                          <Icon size={19} />
                        </div>
                      </div>

                      <div className="stat-value">
                        {loading ? "..." : stat.value}
                      </div>

                      <div className="stat-note">
                        {stat.note}
                      </div>
                    </div>
                  );
                })}
              </section>

              <section className="feature-grid">
                <div className="network-card">
                  <div className="network-header">
                    <div>
                      <div className="eyebrow">
                        NETWORK STATUS
                      </div>
                      <h3>Agent infrastructure</h3>
                    </div>
                    <span className="live-tag">
                      <span className="status-dot" />
                      Operational
                    </span>
                  </div>

                  <div className="network-visual">
                    <div className="network-node">
                      <div className="node-icon buyer">
                        <Bot size={24} />
                      </div>
                      <strong>Buyer Agent</strong>
                      <span>Requesting</span>
                    </div>

                    <div className="connection">
                      <div className="connection-line" />
                      <div className="connection-label">
                        Protocol
                      </div>
                    </div>

                    <div className="network-node">
                      <div className="node-icon seller">
                        <Bot size={24} />
                      </div>
                      <strong>Seller Agent</strong>
                      <span>Responding</span>
                    </div>
                  </div>

                  <div className="network-footer">
                    <div>
                      <span className="footer-label">
                        Active agents
                      </span>
                      <strong>
                        {loading
                          ? "..."
                          : dashboard?.activeAgents ?? 0}
                      </strong>
                    </div>
                    <div>
                      <span className="footer-label">
                        Protocol
                      </span>
                      <strong>BATN Core</strong>
                    </div>
                    <div>
                      <span className="footer-label">
                        Trust layer
                      </span>
                      <strong>Policy enforced</strong>
                    </div>
                  </div>
                </div>

                <div className="security-card">
                  <div className="security-heading">
                    <div className="security-icon-large">
                      <ShieldCheck size={25} />
                    </div>
                    <div>
                      <div className="eyebrow">
                        TRUST & SAFETY
                      </div>
                      <h3>Security control</h3>
                    </div>
                  </div>

                  <p>
                    Transactions will be checked against
                    permissions, limits and risk rules before
                    payment execution.
                  </p>

                  <div className="security-rule">
                    <span className="rule-dot green-dot" />
                    <span>Authorized actions</span>
                    <strong>Proceed</strong>
                  </div>

                  <div className="security-rule">
                    <span className="rule-dot amber-dot" />
                    <span>Unusual actions</span>
                    <strong>Review</strong>
                  </div>

                  <div className="security-rule">
                    <span className="rule-dot red-dot" />
                    <span>Prohibited actions</span>
                    <strong>Block</strong>
                  </div>

                  <div className="security-disclaimer">
                    <ShieldCheck size={15} />
                    <span>
                      Illustrative rules. Enforcement will be
                      implemented in later modules.
                    </span>
                  </div>
                </div>
              </section>

              <section className="transactions-card">
                <div className="section-header">
                  <div>
                    <div className="eyebrow">
                      TRANSACTION ACTIVITY
                    </div>
                    <h3>Recent transactions</h3>
                  </div>

                  <button
                    className="view-button"
                    onClick={() => setActivePage("Transactions")}
                  >
                    View all
                    <ChevronRight size={16} />
                  </button>
                </div>

                <div className="table-toolbar">
                  <div className="search-box">
                    <Search size={17} />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search transactions..."
                    />
                  </div>
                </div>

                <div className="transaction-table-wrapper">
                  <table className="transaction-table">
                    <thead>
                      <tr>
                        <th>TRANSACTION</th>
                        <th>REFERENCE</th>
                        <th>AMOUNT</th>
                        <th>STATUS</th>
                        <th>DATE</th>
                      </tr>
                    </thead>

                    <tbody>
                      {filteredTransactions.map((transaction) => (
                        <tr key={transaction.id}>
                          <td>
                            <div className="transaction-name">
                              <div className="transaction-icon">
                                <transaction.icon size={17} />
                              </div>
                              <div>
                                <strong>{transaction.name}</strong>
                                <span>{transaction.detail}</span>
                              </div>
                            </div>
                          </td>
                          <td className="reference">
                            {transaction.id}
                          </td>
                          <td className="amount">
                            {transaction.amount}
                          </td>
                          <td>
                            <span
                              className={`status-badge ${
                                transaction.status.toLowerCase()
                              }`}
                            >
                              {transaction.status}
                            </span>
                          </td>
                          <td className="date-cell">
                            {transaction.date}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="demo-note">
                  <Activity size={15} />
                  <span>
                    Sample transactions shown for interface
                    demonstration. No payments have been made.
                  </span>
                </div>
              </section>
            </>
          ) : activePage === "Voice Chat" ? (
            <VoiceChat />
          ) : activePage === "Negotiation Lab" ? (
            <NegotiationLab />
          ) : activePage === "Agents" ? (
            <AgentsPage />
          ) : (
            <section className="placeholder-page">
              <div className="placeholder-icon">
                {activePage === "Transactions" && (
                  <ArrowLeftRight size={30} />
                )}
                {activePage === "Agents" && <Bot size={30} />}
                {activePage === "Security" && (
                  <ShieldCheck size={30} />
                )}
                {activePage === "Activity" && (
                  <Activity size={30} />
                )}
              </div>

              <h3>{activePage}</h3>
              <p>
                This workspace will be developed in a later
                BATN module.
              </p>
              <button
                className="back-button"
                onClick={() => setActivePage("Overview")}
              >
                Return to overview
              </button>
            </section>
          )}

          <footer className="footer">
            <span>BATN · Bilateral Agent Transaction Network</span>
            <span>Prototype · Development environment</span>
          </footer>
        </div>
      </main>
    </div>
  );
}

export default App;