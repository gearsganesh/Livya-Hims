-- LIVYA HIMS V8.2.6
-- READ-ONLY schema verification. This script does not INSERT, UPDATE, DELETE, ALTER or DROP anything.

SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'users','patients','appointments','visits','departments','case_sheets','vitals',
    'visit_prescriptions','visit_screenings','patient_files','encounter_documents',
    'hims_billing_items','hims_bills','payments','audit_log','notifications',
    'pharmacy_medicines','pharmacy_batches','pharmacy_prescriptions','pharmacy_prescription_items',
    'pharmacy_invoices','pharmacy_invoice_items','pharmacy_purchase_orders','pharmacy_purchase_order_items',
    'pharmacy_grn','pharmacy_suppliers','pharmacy_manufacturers','pharmacy_stock_transactions',
    'pharmacy_stock_adjustments','pharmacy_sales_returns','pharmacy_supplier_returns'
  )
ORDER BY table_name;

SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    table_name IN ('users','patients','appointments','visits','departments','case_sheets','vitals','visit_prescriptions','visit_screenings','patient_files','encounter_documents','hims_billing_items','hims_bills','payments','audit_log','notifications')
    OR table_name LIKE 'pharmacy_%'
  )
ORDER BY table_name, ordinal_position;
