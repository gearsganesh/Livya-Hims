# LIVYA HIMS V8.2.6 - Final Audited Package

This package is the final pre-deployment build reviewed against the agreed LIVYA HIMS workflow.

## Architecture
- Frontend: Netlify/static frontend
- Authentication: Supabase Auth email OTP
- Backend: Supabase Edge Function `hims-api`
- Database: existing Supabase HIMS schema
- Storage: Supabase Storage bucket `livya-hims-documents`

## Important
1. Do NOT run any reset SQL.
2. Do NOT rerun the bulk patient backload merely to fix frontend/backend errors.
3. No database-destructive migration is included in this package.
4. The frontend does NOT persist the Supabase login session. Opening or refreshing the HIMS URL returns to the login screen.
5. The Supabase service-role key must exist only in the Edge Function secrets. It is not included in the frontend.

## Deploy frontend
Deploy the contents of `frontend/` to the Netlify site currently mapped to `hims.livyacurehub.com`.

The frontend contains the current:
- Login / OTP flow
- Dashboard
- Patients
- Appointments
- Active Visits / Case Sheets
- Common Vitals
- Shared Visit Prescription
- Screening / Investigations
- Physiotherapy case sheet
- Nutrition case sheet
- True IV SOP and Nirmal approval workflow
- Reports / patient files
- Billing / checkout / payment collection
- Pharmacy integration and pharmacy workspace
- Consent form launchers
- Administration / user management
- Profile photographs
- Consolidated visit print / PDF

## Deploy backend
Deploy:
`supabase/functions/hims-api/index.ts`

Required Edge Function secrets:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Do not paste the service-role key into `frontend/config.js`.

## First test after deployment
Use an authorised HIMS user and test in this order:
1. Open HIMS URL in a fresh/private browser window.
2. Confirm the login page appears without an automatic login.
3. Enter the authorised email.
4. Request OTP.
5. Verify OTP.
6. Dashboard loads.
7. Patients loads and search works.
8. Appointments loads.
9. Check-in one test appointment.
10. Active Visits opens the visit.
11. Open the case sheet.
12. Save vitals.
13. Save the relevant clinical case sheet.
14. Add prescription/investigation if applicable.
15. Test billing only after the consultation workflow is complete.
16. If True IV is used, submit the SOP and verify that billing is blocked until Nirmal approval.
17. Test Pharmacy only with a controlled test prescription.
18. Test Reports / patient files.
19. Test Administration and run `System Mapping Check` as ADMIN.

## Database check
`sql/01_READONLY_SCHEMA_CHECK.sql` is read-only. Run it in Supabase SQL Editor if you want to verify the required tables/columns before production use.

## Patient backload
The previous patient backload SQL is intentionally NOT part of the deployment package. The bulk import should not be rerun as a remedy for application errors.
