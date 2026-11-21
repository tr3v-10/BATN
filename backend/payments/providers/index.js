const MockProvider = require("./MockProvider");
const PayHeroProvider = require("./PayHeroProvider");

function createPaymentProvider(config = process.env) {
  const selected = String(config.PAYMENT_PROVIDER || "mock").toLowerCase();
  if (selected === "mock") return new MockProvider();
  if (selected === "payhero") return new PayHeroProvider(config);
  throw new Error("PAYMENT_PROVIDER must be either 'mock' or 'payhero'.");
}

module.exports = { createPaymentProvider };
