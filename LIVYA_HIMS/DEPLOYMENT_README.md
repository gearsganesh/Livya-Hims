# LIVYA HIMS V8.3.4 - Deployment Package

## Architecture
- Frontend: Netlify/static frontend mapped to `hims.livyacurehub.com`
- Authentication: Supabase Auth email OTP for HIMS
- HIMS backend: Supabase Edge Function `hims-api`
- Metabolic backend: Supabase Edge Function `metabolic-api`
- Database: single HIMS Supabase project `weqghrrvgunfpsvtrlkw`
- HIMS `patients` and `users` are the shared identity masters
- Metabolic domain data remains in `metabolic_*` tables
- Metabolic files use private Supabase Storage bucket `metabolic-files`

## Metabolic integration
The HIMS dashboard embeds Metabolic Reset without a second login. The active HIMS Supabase session is pre-seeded into the Metabolic iframe before it boots and is synchronized again after load. HIMS logout clears the Metabolic session as well.

Metabolic Reset frontend and `metabolic-api` are synchronized from the `gearsganesh/livyametabolicreset` source repository. The synchronization workflow does not use `[skip ci]`, so the generated HIMS frontend can deploy normally through Netlify.

The live HIMS Supabase project contains the production reconciliation for Metabolic messaging, read receipts, RBAC, storage RLS, realtime publication, HIMS identity links, client-auth auto-linking and the HIMS Metabolic patient summary view.

## Security rules
1. Never expose a Supabase secret/service-role key in frontend files.
2. Do not reset the HIMS database.
3. Do not rerun bulk patient backload SQL.
4. Metabolic staff access is controlled by `metabolic_staff_permissions`; ADMIN accounts retain full access.
5. Metabolic client data is restricted by `client_user_id` and RLS.
6. The legacy Metabolic Supabase project is retired from production routing.

## HIMS login session
A successful HIMS OTP login is remembered by the browser for 3 hours. Refreshing/reopening within that window restores the active session. Explicit Logout clears the remembered marker and requires OTP again. The 3-hour rule is an application-level remembered-login policy; it does not turn an email address into a password.

## First test after deployment
1. Open `hims.livyacurehub.com` in a fresh browser.
2. Complete HIMS OTP login.
3. Refresh HIMS and confirm it remains logged in within 3 hours.
4. Click **Metabolic Reset** from the dashboard.
5. Confirm Metabolic Reset opens directly without another login screen.
6. Confirm Metabolic dashboard/client data loads.
7. Open HIMS logout and confirm both HIMS and Metabolic access are cleared.
8. Log in again with OTP.
9. Test Metabolic staff directory and permissions as ADMIN.
10. Test a controlled report/check-in/note save and confirm the row reaches the HIMS Supabase project.
11. Test messaging and read receipts.
12. Test a private metabolic file upload/download.
13. Test a HIMS patient against `hims_metabolic_patient_summary` to confirm the identity bridge.

## Backend deployment
HIMS:
`supabase/functions/hims-api/index.ts`

Metabolic:
`supabase/functions/metabolic-api/index.ts`

Both functions must remain JWT protected. Server-only Supabase secrets belong only in Edge Function secrets.
