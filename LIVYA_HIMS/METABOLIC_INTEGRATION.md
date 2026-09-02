# LIVYA HIMS + Metabolic Reset integration

## Data ownership

HIMS is the master system for shared identity data:

- `patients` owns client identity: patient ID, name, gender, DOB, mobile, email and status.
- `users` owns staff identity: auth user, name, email, role, job title and status.

Metabolic Reset remains a separate domain inside the same Supabase project. Its `metabolic_*` tables store metabolic-specific information such as programmes, measurements, reports, check-ins, diet plans, recipes, messages, files and notes.

## Link tables

- `metabolic_clients.hims_patient_id` links each metabolic client to the HIMS patient master.
- `metabolic_profiles.hims_user_id` links each metabolic staff profile to the HIMS staff master.

The existing `metabolic_clients.id` remains the internal metabolic-domain key so existing reports, programmes, check-ins and other metabolic records do not need to be rewritten.

## Synchronisation rules

1. Existing HIMS patients are automatically represented in `metabolic_clients`.
2. New or changed HIMS patient identity data is propagated to the linked metabolic client record.
3. Once a metabolic client is linked to HIMS, its common identity fields are guarded and read from HIMS. Metabolic-specific fields remain local to Metabolic Reset.
4. HIMS staff with Supabase Auth identities are represented in `metabolic_profiles` and remain tied to the HIMS staff record.
5. Existing unmatched metabolic records are intentionally not deleted. They remain isolated until a deliberate HIMS match is made.

This keeps one source of truth for common data without flattening the Metabolic Reset domain into the HIMS schema.
