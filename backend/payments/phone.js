const PHONE_ERROR = "Enter a valid Kenyan M-Pesa number, e.g. 0712345678.";

function normalizeKenyanPhone(value) {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(PHONE_ERROR);
  }

  const raw = String(value).trim();
  const digits = raw.replace(/[\s()-]/g, "").replace(/^\+/, "");

  if (/^0[17]\d{8}$/.test(digits)) return "254" + digits.slice(1);
  if (/^254[17]\d{8}$/.test(digits)) return digits;

  throw new Error(PHONE_ERROR);
}

function maskKenyanPhone(phone) {
  const normalized = normalizeKenyanPhone(phone);
  return normalized.slice(0, 4) + "****" + normalized.slice(-4);
}

function validateKesAmount(amount) {
  if (!Number.isInteger(amount) || amount < 1) {
    throw new Error("Payment amount must be a whole number of at least KES 1.");
  }
  return amount;
}

module.exports = { normalizeKenyanPhone, maskKenyanPhone, validateKesAmount, PHONE_ERROR };
