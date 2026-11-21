const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jadili-payments-"));
process.env.BATN_DB_PATH = path.join(tempDir, "test.db");
process.env.PAYMENT_PROVIDER = "mock";

const db = require("../database/db");
const { normalizeKenyanPhone, maskKenyanPhone, validateKesAmount } = require("../payments/phone");
const service = require("../payments/paymentService");
test.after(() => { db.close(); fs.rmSync(tempDir, { recursive: true, force: true }); });

function fixture() {
  const user1 = randomUUID(), user2 = randomUUID();
  const buyer = randomUUID(), seller = randomUUID(), negotiation = randomUUID();
  db.prepare("INSERT INTO users (id,name) VALUES (?,?)").run(user1, "Buyer owner");
  db.prepare("INSERT INTO users (id,name) VALUES (?,?)").run(user2, "Seller owner");
  db.prepare("INSERT INTO agents (id,owner_id,name,role,status) VALUES (?,?,?,'buyer','active')").run(buyer,user1,"Buyer agent");
  db.prepare("INSERT INTO agents (id,owner_id,name,role,status) VALUES (?,?,?,'seller','active')").run(seller,user2,"Seller agent");
  db.prepare("INSERT INTO agent_mandates (id,agent_id,max_unit_price,max_quantity,max_total_amount,requires_approval) VALUES (?,?,1000,10,10000,0)").run(randomUUID(),buyer);
  db.prepare("INSERT INTO agent_mandates (id,agent_id,min_unit_price,max_quantity,max_total_amount,requires_approval) VALUES (?,?,100,10,10000,0)").run(randomUUID(),seller);
  db.prepare(`INSERT INTO negotiations (id,buyer_agent_id,seller_agent_id,item_description,quantity,buyer_max_price,seller_min_price,initial_offer,final_price,status)
    VALUES (?,?,?,'Test goods',2,1000,100,200,200,'accepted')`).run(negotiation,buyer,seller);
  return negotiation;
}

test("Kenyan phone normalisation and masking", () => {
  assert.equal(normalizeKenyanPhone("0712345678"), "254712345678");
  assert.equal(normalizeKenyanPhone("+254 712 345 678"), "254712345678");
  assert.equal(normalizeKenyanPhone("0112345678"), "254112345678");
  assert.equal(maskKenyanPhone("0712345678"), "2547****5678");
  assert.throws(() => normalizeKenyanPhone("12345"));
});

test("KES amount must be a positive integer", () => {
  assert.equal(validateKesAmount(1), 1);
  assert.throws(() => validateKesAmount(1.5));
  assert.throws(() => validateKesAmount(0));
});

test("same negotiation creates one payment intent", async () => {
  const negotiationId = fixture();
  const first = await service.createAndInitiatePayment(negotiationId, "0712345678");
  const second = await service.createAndInitiatePayment(negotiationId, "0712345678");
  assert.equal(first.id, second.id);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM payment_intents WHERE negotiation_id=?").get(negotiationId).n, 1);
  assert.equal(second.status, "initiated");
});

test("confirmed mock callback pays once; repeated paid callback changes nothing", async () => {
  const negotiationId = fixture();
  const payment = await service.createAndInitiatePayment(negotiationId, "0712345678");
  service.provider.setStatus(payment.provider_reference, "SUCCESS", { MpesaReceiptNumber: "TEST123" });
  const payload = { response: { Amount: 400, ExternalReference: payment.id, Status: "Success", ResultCode: 0, MpesaReceiptNumber: "TEST123" } };
  const paid = await service.handleCallback(payload);
  assert.equal(paid.status, "paid");
  assert.equal(paid.mpesa_receipt, "TEST123");
  const before = db.prepare("SELECT COUNT(*) AS n FROM payment_events WHERE payment_id=?").get(payment.id).n;
  await service.handleCallback(payload);
  const after = db.prepare("SELECT COUNT(*) AS n FROM payment_events WHERE payment_id=?").get(payment.id).n;
  assert.equal(after, before);
});

test("callback amount mismatch is rejected", async () => {
  const negotiationId = fixture();
  const payment = await service.createAndInitiatePayment(negotiationId, "0712345678");
  await assert.rejects(
    service.handleCallback({ response: { Amount: 1, ExternalReference: payment.id, Status: "Success", ResultCode: 0 } }),
    { code: "AMOUNT_MISMATCH" }
  );
  assert.equal(service.getPayment(payment.id).status, "initiated");
});

test("invalid state transition is rejected", () => {
  const negotiationId = fixture();
  assert.deepEqual(service.transitions.pending, ["initiated", "failed", "cancelled"]);
  assert.equal(service.transitions.paid.length, 0);
});

test("invalid state transition is rejected and audited", async () => {
  const negotiationId = fixture();
  const payment = await service.createAndInitiatePayment(negotiationId, "0712345678");
  assert.throws(() => service.transition(payment, "pending"), { code: "INVALID_TRANSITION" });
  assert.equal(service.getPayment(payment.id).status, "initiated");
  assert.ok(db.prepare("SELECT 1 FROM payment_events WHERE payment_id=? AND type='invalid_transition'").get(payment.id));
});
