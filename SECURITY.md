# Security Policy — SUHOOL TECH

## Baseline
- Use managed authentication; never build or store passwords ourselves.
- Require MFA for administrators and privileged roles; prefer it for all staff.
- Keep service-role keys, database credentials, signing keys, and encryption keys out of browser code and Git.
- Enforce tenant isolation and authorization in PostgreSQL Row Level Security (RLS). Hiding UI controls is not authorization.
- Deny access by default and grant the least privilege by role and module.
- Use private object storage and short-lived signed URLs for confidential files.
- Audit privileged changes, approvals, exports, role changes, and vault access. Never log secrets or sensitive payloads.
- Validate and authorize server-side; rate-limit authentication and sensitive actions.
- Enable backups and test restoration before production.

## Password vault requirements
- Never store plaintext passwords, recovery codes, or encryption keys.
- Encrypt secret payloads client-side using authenticated encryption; store ciphertext and a format/version identifier only.
- Design sharing, key rotation, revocation, recovery, and emergency access before enabling the module.
- Require MFA and re-authentication for sensitive vault actions.
- Audit access metadata, never secret contents.
- Complete a threat model and security review before production.

## Production checklist
1. Create separate development, staging, and production environments.
2. Configure trusted redirect URLs, email verification, MFA, and session policy.
3. Review all RLS, storage policies, and privileged database functions.
4. Test that organization A cannot read or modify organization B data.
5. Provision the first organization and administrator through a trusted server-side process.
6. Configure monitoring, backups, recovery contacts, and incident response.
7. Define data retention and privacy policies for company operations.

Report suspected vulnerabilities privately. Never include real customer data or credentials in issues.
