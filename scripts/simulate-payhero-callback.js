const base = (process.env.PUBLIC_BASE_URL || "http://localhost:5000").replace(/\/$/, "");
const secret = process.env.PAYHERO_CALLBACK_SECRET;
const paymentId = process.argv[2];
const amount = Number(process.argv[3] || 1);
if (!secret || !paymentId || !Number.isInteger(amount) || amount < 1) {
  console.error("Usage: PAYHERO_CALLBACK_SECRET=... node scripts/simulate-payhero-callback.js <payment-id> [amount]");
  process.exit(1);
}
const payload = {
  forward_url: "",
  response: {
    Amount: amount,
    CheckoutRequestID: "SIMULATED-CHECKOUT",
    ExternalReference: paymentId,
    MerchantRequestID: "SIMULATED-MERCHANT",
    MpesaReceiptNumber: "SIM" + Date.now(),
    Phone: "254700000000",
    ResultCode: 0,
    ResultDesc: "Simulated success callback",
    Status: "Success"
  },
  status: true
};
fetch(base + "/api/payments/callback/" + encodeURIComponent(secret), {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload)
}).then(async response => {
  console.log("Callback HTTP status:", response.status);
  console.log(await response.text());
}).catch(error => {
  console.error("Could not send callback:", error.message);
  process.exitCode = 1;
});
