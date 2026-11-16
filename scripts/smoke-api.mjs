import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const port = 4179;
const base = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  PORT: String(port),
  JWT_SECRET: "ci-only-jwt-secret-that-is-longer-than-forty-eight-characters-123456",
  BOOTSTRAP_TOKEN: "ci-bootstrap-token-with-more-than-24-characters",
  CORS_ORIGIN: base,
  VAULT_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64")
};
const child = spawn(process.execPath, ["server/src/index.js"], { env, stdio: ["ignore", "pipe", "pipe"] });
let logs = "";
child.stdout.on("data", chunk => { logs += chunk.toString(); });
child.stderr.on("data", chunk => { logs += chunk.toString(); });

async function request(path, { method = "GET", token, body } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(5000)
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

async function waitForApi() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`API exited early.\n${logs}`);
    try {
      const health = await request("/api/health");
      if (health.status === 200 && health.data.database === "connected") return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`API did not become healthy.\n${logs}`);
}

try {
  await waitForApi();

  assert.equal((await request("/api/projects")).status, 401, "protected routes must reject anonymous requests");

  const bootstrap = await request("/api/auth/bootstrap", {
    method: "POST",
    body: { token: env.BOOTSTRAP_TOKEN, name: "CI Administrator", email: "ci-admin@example.test", password: "CI-Only-Password-2026!" }
  });
  assert.equal(bootstrap.status, 201, JSON.stringify(bootstrap.data));
  const token = bootstrap.data.token;
  assert.ok(token, "bootstrap must return a session token");

  const duplicateBootstrap = await request("/api/auth/bootstrap", {
    method: "POST",
    body: { token: env.BOOTSTRAP_TOKEN, name: "Second Admin", email: "second-admin@example.test", password: "CI-Only-Password-2026!" }
  });
  assert.equal(duplicateBootstrap.status, 409, "bootstrap must be one-time only");

  const login = await request("/api/auth/login", {
    method: "POST",
    body: { email: "ci-admin@example.test", password: "CI-Only-Password-2026!" }
  });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  assert.equal((await request("/api/auth/me", { token })).status, 200);
  assert.equal((await request("/api/dashboard/summary", { token })).status, 200);

  const project = await request("/api/projects", {
    method: "POST", token, body: { name: "CI project", description: "Automated API smoke test" }
  });
  assert.equal(project.status, 201, JSON.stringify(project.data));
  const projects = await request("/api/projects", { token });
  assert.ok(projects.data.projects.some(item => item.id === project.data.project.id));

  const assetAccount = await request("/api/finance/accounts", {
    method: "POST", token, body: { account_code: "CI-1000", account_name: "CI Cash", account_type: "asset" }
  });
  const revenueAccount = await request("/api/finance/accounts", {
    method: "POST", token, body: { account_code: "CI-4000", account_name: "CI Revenue", account_type: "revenue" }
  });
  assert.equal(assetAccount.status, 201, JSON.stringify(assetAccount.data));
  assert.equal(revenueAccount.status, 201, JSON.stringify(revenueAccount.data));

  const journal = await request("/api/finance/journals", {
    method: "POST", token, body: {
      entry_date: "2026-01-15", description: "CI balanced journal",
      lines: [
        { account_id: assetAccount.data.account.id, debit: 100, credit: 0 },
        { account_id: revenueAccount.data.account.id, debit: 0, credit: 100 }
      ]
    }
  });
  assert.equal(journal.status, 201, JSON.stringify(journal.data));
  const posted = await request(`/api/finance/journals/${journal.data.journal.id}/post`, { method: "POST", token });
  assert.equal(posted.status, 200, JSON.stringify(posted.data));

  const unbalanced = await request("/api/finance/journals", {
    method: "POST", token, body: {
      entry_date: "2026-01-15", description: "CI invalid journal",
      lines: [
        { account_id: assetAccount.data.account.id, debit: 100, credit: 0 },
        { account_id: revenueAccount.data.account.id, debit: 0, credit: 90 }
      ]
    }
  });
  assert.equal(unbalanced.status, 400, "unbalanced journals must be rejected");
  const payrollExpense = await request("/api/finance/accounts", {
    method: "POST", token, body: { account_code: "CI-5100", account_name: "CI Payroll Expense", account_type: "expense" }
  });
  const payrollPayable = await request("/api/finance/accounts", {
    method: "POST", token, body: { account_code: "CI-2100", account_name: "CI Payroll Payable", account_type: "liability" }
  });
  const payrollDeductions = await request("/api/finance/accounts", {
    method: "POST", token, body: { account_code: "CI-2110", account_name: "CI Payroll Deductions", account_type: "liability" }
  });
  assert.equal(payrollExpense.status, 201, JSON.stringify(payrollExpense.data));
  assert.equal(payrollPayable.status, 201, JSON.stringify(payrollPayable.data));
  assert.equal(payrollDeductions.status, 201, JSON.stringify(payrollDeductions.data));

  const employee = await request("/api/hr/employees", {
    method: "POST", token, body: { full_name: "CI Payroll Employee", department: "QA", job_title: "Tester" }
  });
  assert.equal(employee.status, 201, JSON.stringify(employee.data));

  const payroll = await request("/api/payroll/runs", {
    method: "POST", token, body: {
      period_start: "2026-01-01", period_end: "2026-01-31",
      items: [{ employee_id: employee.data.employee.id, basic_salary: 1000, allowances: 200, deductions: 100 }]
    }
  });
  assert.equal(payroll.status, 201, JSON.stringify(payroll.data));
  const approvedPayroll = await request("/api/payroll/runs/" + payroll.data.run.id + "/approve", { method: "PATCH", token });
  assert.equal(approvedPayroll.status, 200, JSON.stringify(approvedPayroll.data));

  const payrollPost = await request("/api/payroll/runs/" + payroll.data.run.id + "/post", {
    method: "POST", token, body: {
      expense_account_id: payrollExpense.data.account.id,
      payable_account_id: payrollPayable.data.account.id,
      deductions_account_id: payrollDeductions.data.account.id
    }
  });
  assert.equal(payrollPost.status, 200, JSON.stringify(payrollPost.data));
  assert.ok(payrollPost.data.run.journal_entry_id, "payroll posting must link its journal");
  const payrollPayment = await request("/api/payroll/runs/" + payroll.data.run.id + "/pay", {
    method: "POST", token, body: { payment_account_id: assetAccount.data.account.id }
  });
  assert.equal(payrollPayment.status, 200, JSON.stringify(payrollPayment.data));
  assert.equal(payrollPayment.data.run.status, "paid");
  const duplicatePayrollPayment = await request("/api/payroll/runs/" + payroll.data.run.id + "/pay", {
    method: "POST", token, body: { payment_account_id: assetAccount.data.account.id }
  });
  assert.equal(duplicatePayrollPayment.status, 409, "a payroll run must not be paid twice");

  const warehouse = await request("/api/inventory/warehouses", {
    method: "POST", token, body: { warehouse_code: "CI-WH", name: "CI Warehouse" }
  });
  assert.equal(warehouse.status, 201, JSON.stringify(warehouse.data));
  const item = await request("/api/inventory/items", {
    method: "POST", token, body: { sku: "CI-SKU", name: "CI Stock Item", cost_price: 5, reorder_level: 2 }
  });
  assert.equal(item.status, 201, JSON.stringify(item.data));

  const receipt = await request("/api/inventory/documents", {
    method: "POST", token, body: {
      document_type: "receipt", warehouse_id: warehouse.data.warehouse.id,
      item_id: item.data.item.id, quantity: 10, unit_cost: 5
    }
  });
  assert.equal(receipt.status, 201, JSON.stringify(receipt.data));

  const overIssue = await request("/api/inventory/documents", {
    method: "POST", token, body: {
      document_type: "issue", warehouse_id: warehouse.data.warehouse.id,
      item_id: item.data.item.id, quantity: 11, unit_cost: 5
    }
  });
  assert.equal(overIssue.status, 409, "inventory must reject issues above available stock");

  const issue = await request("/api/inventory/documents", {
    method: "POST", token, body: {
      document_type: "issue", warehouse_id: warehouse.data.warehouse.id,
      item_id: item.data.item.id, quantity: 4, unit_cost: 5
    }
  });
  assert.equal(issue.status, 201, JSON.stringify(issue.data));
  const balances = await request("/api/inventory/balances", { token });
  const balance = balances.data.balances.find(row => row.item_id === item.data.item.id);
  assert.equal(Number(balance.quantity), 6, "stock balance must reflect receipt and issue");

  const zatca = await request("/api/zatca/connection", { token });
  assert.equal(zatca.status, 200, JSON.stringify(zatca.data));
  assert.equal(zatca.data.settings.integration_mode, "manual");

  console.log("API smoke tests passed: auth, one-time bootstrap, projects, balanced GL, stock controls, payroll posting/payment, and ZATCA settings.");
} catch (error) {
  console.error(error);
  console.error(logs);
  process.exitCode = 1;
} finally {
  child.kill("SIGTERM");
  await new Promise(resolve => {
    if (child.exitCode !== null) return resolve();
    child.once("exit", resolve);
    setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 3000);
  });
}
