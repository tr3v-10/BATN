const ProviderError = require("./ProviderError");
const { validateKesAmount, normalizeKenyanPhone } = require("../phone");

class PayHeroProvider {
  constructor(config = process.env) {
    this.baseUrl = (config.PAYHERO_BASE_URL || "https://backend.payhero.co.ke").replace(/\/$/, "");
    this.username = config.PAYHERO_API_USERNAME;
    this.password = config.PAYHERO_API_PASSWORD;
    this.channelId = Number(config.PAYHERO_CHANNEL_ID);
    this.publicBaseUrl = (config.PUBLIC_BASE_URL || "").replace(/\/$/, "");
    this.callbackSecret = config.PAYHERO_CALLBACK_SECRET;

    if (!this.username || !this.password || !Number.isInteger(this.channelId) || this.channelId < 1) {
      throw new Error("PayHero credentials and a valid PAYHERO_CHANNEL_ID are required.");
    }
    if (!this.publicBaseUrl || !this.callbackSecret) {
      throw new Error("PUBLIC_BASE_URL and PAYHERO_CALLBACK_SECRET are required for PayHero callbacks.");
    }
  }

  get authorization() {
    return "Basic " + Buffer.from(this.username + ":" + this.password).toString("base64");
  }

  async request(method, path, body, safeRetry = false) {
    const attempts = safeRetry ? 2 : 1;
    let lastError;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      try {
        const response = await fetch(this.baseUrl + path, {
          method,
          headers: {
            Authorization: this.authorization,
            "Content-Type": "application/json"
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          const ambiguous = method === "POST" && response.status >= 500;
          throw new ProviderError(
            "PAYHERO_HTTP_" + response.status,
            ambiguous
              ? "PayHero did not confirm whether the payment request was accepted."
              : "PayHero rejected the payment request.",
            { ambiguous, httpStatus: response.status }
          );
        }
        return data;
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        lastError = error;
        if (safeRetry && attempt + 1 < attempts) continue;

        throw new ProviderError(
          method === "POST" ? "PAYHERO_INITIATION_UNCONFIRMED" : "PAYHERO_NETWORK_ERROR",
          method === "POST"
            ? "The payment request outcome could not be confirmed. Do not send another prompt yet."
            : "Could not retrieve the payment status from PayHero.",
          { ambiguous: method === "POST" }
        );
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError || new ProviderError("PAYHERO_NETWORK_ERROR", "PayHero request failed.");
  }

  async initiatePayment({ paymentId, amount, phone, customerName }) {
    validateKesAmount(amount);
    const normalizedPhone = normalizeKenyanPhone(phone);
    const callbackUrl = this.publicBaseUrl + "/api/payments/callback/" + encodeURIComponent(this.callbackSecret);

    const result = await this.request("POST", "/api/v2/payments", {
      amount,
      phone_number: normalizedPhone,
      channel_id: this.channelId,
      provider: "m-pesa",
      external_reference: paymentId,
      ...(customerName ? { customer_name: customerName } : {}),
      callback_url: callbackUrl
    });

    if (!result || result.success !== true || !result.reference) {
      throw new ProviderError(
        "PAYHERO_UNEXPECTED_RESPONSE",
        "PayHero returned an unexpected response. The payment outcome needs reconciliation.",
        { ambiguous: true }
      );
    }

    return {
      success: true,
      status: result.status || "QUEUED",
      reference: result.reference,
      checkoutRequestId: result.CheckoutRequestID || null,
      raw: result
    };
  }

  async getStatus(providerReference) {
    if (!providerReference) throw new ProviderError("PAYHERO_REFERENCE_MISSING", "Payment reference is missing.");
    return this.request(
      "GET",
      "/api/v2/transaction-status?reference=" + encodeURIComponent(providerReference),
      null,
      true
    );
  }

  parseCallback(body) {
    const response = body && body.response;
    if (!response || typeof response !== "object") {
      throw new Error("Invalid PayHero callback payload.");
    }

    const amount = Number(response.Amount);
    const externalReference = response.ExternalReference;
    const status = response.Status;

    if (!Number.isFinite(amount) || !externalReference || typeof status !== "string") {
      throw new Error("PayHero callback is missing required payment fields.");
    }

    return {
      amount,
      checkoutRequestId: response.CheckoutRequestID || null,
      externalReference,
      merchantRequestId: response.MerchantRequestID || null,
      mpesaReceiptNumber: response.MpesaReceiptNumber || null,
      phone: response.Phone || null,
      resultCode: response.ResultCode ?? null,
      resultDesc: response.ResultDesc || "",
      status,
      raw: body
    };
  }
}

module.exports = PayHeroProvider;
