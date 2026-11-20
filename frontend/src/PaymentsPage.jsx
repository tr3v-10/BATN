
import { useEffect, useState } from "react";
import {
  Wallet,
  RefreshCw,
  ArrowRight,
  CheckCircle,
  XCircle,
} from "lucide-react";

import "./PaymentsPage.css";

const API = "http://localhost:5000/api/payments";

function PaymentsPage() {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState("");

  const fetchPayments = async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(API);

      if (!response.ok) {
        throw new Error("Failed to fetch payments.");
      }

      const data = await response.json();

      setPayments(
        Array.isArray(data)
          ? data
          : data.payments || data.data || []
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPayments();
  }, []);

  const updatePayment = async (id, status) => {
    if (
      !window.confirm(
        `Change this payment status to ${status}?`
      )
    ) {
      return;
    }

    setProcessing(id);
    setError("");

    try {
      const response = await fetch(
        `${API}/${id}/status`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ status }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.message || "Payment update failed."
        );
      }

      await fetchPayments();
    } catch (err) {
      setError(err.message);
    } finally {
      setProcessing("");
    }
  };

  const nextAction = (status) => {
    switch (status) {
      case "pending":
        return "initiated";

      case "initiated":
        return "processing";

      case "processing":
        return "paid";

      default:
        return null;
    }
  };

  const getStats = (status) =>
    payments.filter(
      (payment) => payment.status === status
    ).length;

  const formatAmount = (payment) =>
    `${payment.currency || "KES"} ${Number(
      payment.amount || 0
    ).toLocaleString()}`;

  return (
    <div className="payments-page">

      <div className="payments-toolbar">
        <div>
          <h3>Payment Management</h3>

          <p>
            Track payment intents and simulated payment
            lifecycle events.
          </p>
        </div>

        <button
          className="payment-refresh"
          onClick={fetchPayments}
          disabled={loading}
        >
          <RefreshCw size={17} />
          Refresh
        </button>
      </div>

      <div className="payments-stats">

        <div className="payment-stat">
          <span>Total Payments</span>
          <h2>{payments.length}</h2>
        </div>

        <div className="payment-stat">
          <span>Pending</span>
          <h2>{getStats("pending")}</h2>
        </div>

        <div className="payment-stat">
          <span>Processing</span>
          <h2>{getStats("processing")}</h2>
        </div>

        <div className="payment-stat">
          <span>Completed</span>
          <h2>{getStats("paid")}</h2>
        </div>

        <div className="payment-stat">
          <span>Failed</span>
          <h2>{getStats("failed")}</h2>
        </div>

      </div>

      {error && (
        <div className="payment-error">
          {error}
        </div>
      )}

      <div className="payments-panel">

        <div className="payments-panel-header">
          <div>
            <h3>Payment Records</h3>

            <p>
              Payment intents registered in BATN.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="payments-empty">
            Loading payment records...
          </div>
        ) : payments.length === 0 ? (
          <div className="payments-empty">
            <Wallet size={35} />

            <h3>No payments found</h3>

            <p>
              Payment intents will appear here once created.
            </p>
          </div>
        ) : (
          <div className="payments-table-wrapper">
            <table className="payments-table">

              <thead>
                <tr>
                  <th>Payment</th>
                  <th>Amount</th>
                  <th>Provider</th>
                  <th>Status</th>
                  <th>Reference</th>
                  <th>Action</th>
                </tr>
              </thead>

              <tbody>
                {payments.map((payment) => {
                  const next = nextAction(
                    payment.status
                  );

                  return (
                    <tr key={payment.id}>

                      <td>
                        <div className="payment-id">
                          <Wallet size={16} />

                          <span>
                            {payment.id}
                          </span>
                        </div>
                      </td>

                      <td>
                        <strong>
                          {formatAmount(payment)}
                        </strong>
                      </td>

                      <td>
                        {payment.provider || "Unknown"}
                      </td>

                      <td>
                        <span
                          className={`payment-status ${payment.status}`}
                        >
                          {payment.status}
                        </span>
                      </td>

                      <td>
                        <span className="payment-reference">
                          {payment.provider_reference ||
                            "—"}
                        </span>
                      </td>

                      <td>
                        {next &&
                        payment.provider === "mock" ? (
                          <button
                            className="payment-action"
                            disabled={
                              processing === payment.id
                            }
                            onClick={() =>
                              updatePayment(
                                payment.id,
                                next
                              )
                            }
                          >
                            {processing === payment.id
                              ? "Updating..."
                              : next === "paid"
                              ? "Complete"
                              : "Advance"}

                            <ArrowRight size={15} />
                          </button>
                        ) : payment.status === "paid" ? (
                          <span className="payment-terminal">
                            <CheckCircle size={15} />
                            Completed
                          </span>
                        ) : payment.status === "failed" ||
                          payment.status === "cancelled" ? (
                          <span className="payment-terminal">
                            <XCircle size={15} />
                            Closed
                          </span>
                        ) : (
                          <span className="payment-terminal">
                            Provider managed
                          </span>
                        )}
                      </td>

                    </tr>
                  );
                })}
              </tbody>

            </table>
          </div>
        )}

      </div>
    </div>
  );
}

export default PaymentsPage;
