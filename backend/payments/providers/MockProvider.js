class MockProvider {
  constructor() { this.statuses = new Map(); }
  setStatus(reference, status, extra = {}) { this.statuses.set(reference, { success: true, status, reference, ...extra }); }

  async initiatePayment({ paymentId }) {
    this.statuses.set("MOCK-" + paymentId, { success: true, status: "QUEUED", reference: "MOCK-" + paymentId });
    return {
      success: true,
      status: "QUEUED",
      reference: "MOCK-" + paymentId,
      checkoutRequestId: null,
      raw: { provider: "mock", status: "QUEUED" }
    };
  }

  async getStatus(providerReference) {
    return this.statuses.get(providerReference) || { success: true, status: "QUEUED", reference: providerReference, provider: "mock" };
  }

  parseCallback(body) {
    const response = body && body.response ? body.response : body;
    if (!response || typeof response !== "object") {
      throw new Error("Invalid mock callback payload.");
    }
    return {
      amount: Number(response.Amount ?? response.amount),
      checkoutRequestId: response.CheckoutRequestID || response.checkoutRequestId || null,
      externalReference: response.ExternalReference || response.externalReference,
      merchantRequestId: response.MerchantRequestID || response.merchantRequestId || null,
      mpesaReceiptNumber: response.MpesaReceiptNumber || response.mpesaReceiptNumber || null,
      phone: response.Phone || response.phone || null,
      resultCode: response.ResultCode ?? response.resultCode ?? null,
      resultDesc: response.ResultDesc || response.resultDesc || "",
      status: response.Status || response.status || "",
      raw: body
    };
  }
}

module.exports = MockProvider;
