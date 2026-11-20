
import { useEffect, useState } from "react";
import {
  ShieldAlert,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertTriangle,
} from "lucide-react";

import "./RiskPage.css";

const API = "http://localhost:5000/api/risk";

function RiskPage() {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState("");

  const fetchReviews = async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(`${API}/review-queue`);

      if (!response.ok) {
        throw new Error("Failed to load review queue.");
      }

      const data = await response.json();

      setReviews(
        Array.isArray(data)
          ? data
          : data.reviews || data.queue || data.data || []
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReviews();
  }, []);

  const reviewTransaction = async (
    negotiationId,
    action
  ) => {
    const confirmed = window.confirm(
      `Are you sure you want to ${action} this negotiation?`
    );

    if (!confirmed) return;

    setProcessing(negotiationId);
    setError("");

    try {
      const response = await fetch(
        `${API}/${negotiationId}/review`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.message || "Review action failed."
        );
      }

      await fetchReviews();

      window.alert(
        `Negotiation ${action}d successfully.`
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setProcessing("");
    }
  };

  const getScore = (review) =>
    review.risk_score ??
    review.score ??
    0;

  const getFlags = (review) => {
    const flags =
      review.risk_flags ??
      review.flags ??
      [];

    if (typeof flags === "string") {
      try {
        return JSON.parse(flags);
      } catch {
        return [flags];
      }
    }

    return Array.isArray(flags) ? flags : [];
  };

  const getNegotiationId = (review) =>
    review.negotiation_id ??
    review.negotiationId ??
    review.id;

  const getRiskLevel = (score) => {
    if (score >= 70) return "high";
    if (score >= 30) return "medium";
    return "low";
  };

  return (
    <div className="risk-page">

      <div className="risk-toolbar">
        <div>
          <h3>Review Queue</h3>

          <p>
            Investigate flagged transactions before
            authorization.
          </p>
        </div>

        <button
          className="risk-refresh"
          onClick={fetchReviews}
          disabled={loading}
        >
          <RefreshCw size={17} />
          Refresh
        </button>
      </div>

      <div className="risk-summary">
        <div className="risk-summary-card">
          <ShieldAlert size={22} />

          <div>
            <span>Pending Reviews</span>
            <h2>{reviews.length}</h2>
          </div>
        </div>

        <div className="risk-summary-card">
          <AlertTriangle size={22} />

          <div>
            <span>Requires Attention</span>
            <h2>
              {
                reviews.filter(
                  (r) => getScore(r) >= 30
                ).length
              }
            </h2>
          </div>
        </div>
      </div>

      {error && (
        <div className="risk-error">
          {error}
        </div>
      )}

      {loading ? (
        <div className="risk-empty">
          Loading review queue...
        </div>
      ) : reviews.length === 0 ? (
        <div className="risk-empty">
          <CheckCircle size={35} />

          <h3>No pending reviews</h3>

          <p>
            No transactions currently require manual review.
          </p>
        </div>
      ) : (
        <div className="risk-list">

          {reviews.map((review, index) => {
            const score = getScore(review);
            const level = getRiskLevel(score);
            const flags = getFlags(review);
            const negotiationId =
              getNegotiationId(review);

            return (
              <div
                className="risk-card"
                key={negotiationId || index}
              >
                <div className="risk-card-header">

                  <div className="risk-card-title">
                    <ShieldAlert size={20} />

                    <div>
                      <h4>
                        Negotiation Review
                      </h4>

                      <small>
                        ID: {negotiationId}
                      </small>
                    </div>
                  </div>

                  <span
                    className={`risk-badge ${level}`}
                  >
                    {level} risk
                  </span>
                </div>

                <div className="risk-details">

                  <div>
                    <span>Risk Score</span>

                    <strong>
                      {score}/100
                    </strong>
                  </div>

                  <div>
                    <span>Status</span>

                    <strong>
                      {review.status ||
                        review.negotiation_status ||
                        "Pending review"}
                    </strong>
                  </div>

                  <div>
                    <span>Amount</span>

                    <strong>
                      {review.amount != null
                        ? `KES ${Number(
                            review.amount
                          ).toLocaleString()}`
                        : review.total_amount != null
                        ? `KES ${Number(
                            review.total_amount
                          ).toLocaleString()}`
                        : "Not available"}
                    </strong>
                  </div>
                </div>

                <div className="risk-flags">
                  <h5>Risk Indicators</h5>

                  {flags.length > 0 ? (
                    flags.map((flag, i) => (
                      <div
                        className="risk-flag"
                        key={i}
                      >
                        <AlertTriangle size={15} />

                        <span>
                          {typeof flag === "object"
                            ? flag.description ||
                              flag.reason ||
                              flag.flag ||
                              JSON.stringify(flag)
                            : flag}
                        </span>
                      </div>
                    ))
                  ) : (
                    <p>
                      No detailed risk indicators available.
                    </p>
                  )}
                </div>

                <div className="risk-actions">

                  <button
                    className="risk-approve"
                    disabled={
                      processing === negotiationId
                    }
                    onClick={() =>
                      reviewTransaction(
                        negotiationId,
                        "approve"
                      )
                    }
                  >
                    <CheckCircle size={17} />

                    Approve
                  </button>

                  <button
                    className="risk-reject"
                    disabled={
                      processing === negotiationId
                    }
                    onClick={() =>
                      reviewTransaction(
                        negotiationId,
                        "reject"
                      )
                    }
                  >
                    <XCircle size={17} />

                    Reject
                  </button>

                </div>

              </div>
            );
          })}

        </div>
      )}

    </div>
  );
}

export default RiskPage;
