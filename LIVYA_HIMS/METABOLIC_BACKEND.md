# LIVYA Metabolic Backend

The Livya Metabolic application backend is hosted in the existing **Livya HIMS Supabase project** using a separate `metabolic_*` table namespace. This keeps the metabolic application isolated from HIMS, pharmacy, and stores data while allowing a single Supabase project.

## Backend components

- Supabase Auth: user identity and sessions
- PostgreSQL: metabolic profiles, clients, programmes, reports, measurements, check-ins, diet plans, recipes, messaging, files and audit logs
- Supabase Storage: private `metabolic-files` bucket for client documents
- Edge Function: `metabolic-api`
- Row Level Security: staff/client access boundaries are enforced in PostgreSQL

## API routes

Authenticated requests only:

- `GET /functions/v1/metabolic-api/me`
- `GET /functions/v1/metabolic-api/clients`
- `GET /functions/v1/metabolic-api/dashboard`

The Edge Function forwards the caller's JWT into the Supabase client so database queries remain subject to RLS.

## Frontend migration order

1. Add the Supabase browser client.
2. Replace prototype session/localStorage authentication with Supabase Auth.
3. Replace local client/program/report/check-in state with PostgreSQL reads and writes.
4. Replace IndexedDB document storage with the private `metabolic-files` Storage bucket.
5. Connect realtime conversation updates.
6. Add production error handling, loading states and audit events.
7. Run the application on a Vercel preview before merging to `main`.

## Security

Do not put a Supabase service-role/secret key in browser code. The frontend uses only the publishable/anonymous key; privileged operations belong in authenticated server-side functions. Client-visible data is additionally controlled by RLS.
