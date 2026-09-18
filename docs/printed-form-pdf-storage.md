# Immutable printed-form PDFs

RadiologyOS keeps the canonical business-document render payload in D1 (`printed_form_snapshots`) and the generated PDF bytes in a **private Cloudflare R2 bucket**. D1 `sha256` remains the canonical JSON payload hash; the PDF binary SHA-256 is R2 object metadata.

## One-time provisioning

Create the bucket before the first deployment with the `PRINTED_FORMS` binding:

```bash
npx wrangler r2 bucket create radiologyos-printed-forms
npx wrangler r2 bucket info radiologyos-printed-forms --config wrangler.cloudflare.toml --json
```

Do **not** expose the bucket through an R2 public URL or custom domain. PDF retrieval goes only through the authenticated RadiologyOS staff endpoint.

`wrangler.cloudflare.toml` binds Browser Run as `BROWSER` for HTML → PDF rendering and the private bucket as `PRINTED_FORMS`. Both production deploy paths verify the bucket before the D1 recovery/migration phase, so missing storage fails before database mutation.

## Artifact lifecycle

1. A print endpoint creates or reuses an immutable D1 snapshot.
2. New snapshots reserve a deterministic R2 key from organization, document, form, state, template version and payload SHA-256.
3. Historical snapshots with an empty `storage_key` derive the same key in memory without updating the row.
4. The first PDF request renders only the saved snapshot payload and performs a conditional create-only R2 write.
5. Later requests reuse the exact object after tenant/form metadata, content type, `%PDF-` signature and binary SHA-256 validation.
6. Integrity failures fail closed and are audited; the object is never silently overwritten.

Rendering is lazy and idempotent so repeated reprints do not consume Browser Run time after successful materialization.

Production remains manual-only: provision the bucket once, merge a green PR, then use `Deploy to Cloudflare` with explicit `DEPLOY` confirmation.
