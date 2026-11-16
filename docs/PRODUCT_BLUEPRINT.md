# SUHOOL TECH — Product Blueprint

## Vision
A secure, Arabic-first, bilingual workspace that unifies company operations. Shared identity, organization context, role-based access, notifications, global search, and audit history are consistent across all modules.

## Product principles
- Arabic RTL by default; English LTR across every screen.
- Responsive desktop, tablet, and mobile.
- Brand palette: deep navy, vivid blue, turquoise, and green, with accessible contrast.
- Role-aware navigation and least-privilege access.
- Fast workflows: global search, saved filters, approvals, clear status and error states.
- Production dashboards use live data only; no invented KPI figures.

## Recommended modules
1. Executive dashboard: KPIs, pending approvals, deadlines, workload, sales pipeline, operational alerts.
2. CRM & customers: customer directory, contacts, communication timeline, follow-ups, ownership.
3. Projects & tasks: boards, assignments, priorities, due dates, dependencies, comments, attachments.
4. Quotations & sales: itemized quotes, tax, versioning, approvals, PDF generation, status tracking.
5. HR: employee directory, departments, onboarding, leave requests, attendance integration after provider selection.
6. Internal services & approvals: purchase, IT/helpdesk, travel/expense requests, approval chains, SLA tracking.
7. Documents & knowledge: private files, version history, metadata, access groups, retention, searchable procedures.
8. Assets & inventory: equipment register, assignment, handover, maintenance, lifecycle.
9. Finance: invoices, expenses, receivables, payment status, exports; integrations require regulatory review.
10. Reports & analytics: role-based reports, date filters, exports, traceable source data.
11. Password vault: client-side authenticated encryption, key management outside the database, MFA, access audit; enable only after threat modelling.
12. Administration: users, invitations, roles, permissions, departments, module access, settings, audit logs.

## Delivery roadmap
### Foundation
- Separate development, staging, and production environments.
- Configure managed authentication, email, MFA, organization provisioning, and first administrator.
- Apply reviewed SQL migrations and test tenant isolation.
- Establish CI checks, backups, monitoring, and secrets management.
### First usable release
- Shared portal shell, dashboard, profiles, user administration, roles and permissions.
- CRM, projects/tasks, quotations, notifications, audit history.
### Operations release
- HR workflows, internal requests/approvals, document management, assets.
### Intelligence release
- Finance, reports, integrations, automation, and password vault after a dedicated security review.

## Release gates
- A module is not labelled active until backend, permissions, validation, error handling, and acceptance tests work.
- Every tenant-owned record is organization-scoped and protected by server-side authorization.
- Sensitive actions are audited.
- Financial totals are recalculated and validated server-side.
- Confidential uploads use private storage and short-lived signed URLs.
- Tests must prove cross-organization access is denied.
