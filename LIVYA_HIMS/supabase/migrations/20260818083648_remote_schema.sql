


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."livya_next_bill_no"() RETURNS bigint
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select nextval('public.livya_bill_seq');
$$;


ALTER FUNCTION "public"."livya_next_bill_no"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pharmacy_approve_adjustment"("p_data" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare d jsonb:=p_data; a record; oldq numeric; newq numeric;
begin
 select a.* into a from pharmacy_stock_adjustments a where id=(d->>'adjustment_id')::uuid for update; if not found then raise exception 'Adjustment not found'; end if;
 if a.status<>'PENDING' then raise exception 'Adjustment is already processed'; end if;
 select quantity_available into oldq from pharmacy_batches where id=a.batch_id for update; newq:=a.new_quantity;
 update pharmacy_batches set quantity_available=newq,updated_at=now() where id=a.batch_id;
 update pharmacy_stock_adjustments set status='APPROVED',approved_by=d->>'approved_by',approved_at=now(),previous_quantity=oldq where id=a.id;
 insert into pharmacy_stock_transactions(transaction_no,medicine_id,batch_id,transaction_type,quantity_in,quantity_out,balance_after,unit_cost,reference_type,reference_id,reason,performed_by)
 values(pharmacy_next_number('STK-','public.pharmacy_txn_seq'),a.medicine_id,a.batch_id,'ADJUSTMENT',greatest(newq-oldq,0),greatest(oldq-newq,0),newq,0,'ADJUSTMENT',a.id,a.reason,coalesce(d->>'approved_by',''));
 return jsonb_build_object('adjustment_id',a.id,'new_quantity',newq);
end $$;


ALTER FUNCTION "public"."pharmacy_approve_adjustment"("p_data" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pharmacy_create_sale"("p_data" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  h jsonb:=p_data->'header'; it jsonb; inv uuid; rx uuid:=nullif(h->>'pharmacy_prescription_id','')::uuid; disp uuid; med uuid; batch uuid; q numeric; price numeric; gst numeric; disc numeric; sub numeric:=0; tax numeric:=0; total numeric:=0; paid numeric:=coalesce((h->>'amount_paid')::numeric,0); bal numeric; cur numeric; rec record; drec record; rxitem uuid;
  created_items jsonb:='[]'::jsonb;
begin
  if jsonb_array_length(coalesce(p_data->'items','[]'::jsonb))=0 then raise exception 'At least one sale item is required'; end if;
  if rx is not null then select * into rec from pharmacy_prescriptions where id=rx for update; if not found then raise exception 'Pharmacy prescription not found'; end if; end if;
  insert into pharmacy_invoices(invoice_no,patient_no,visit_no,pharmacy_prescription_id,customer_name,customer_mobile,status,created_by)
  values(pharmacy_next_number('PHINV-','public.pharmacy_invoice_seq'),nullif(h->>'patient_no',''),nullif(h->>'visit_no',''),rx,coalesce(h->>'customer_name',''),coalesce(h->>'customer_mobile',''),'UNPAID',coalesce(h->>'created_by','')) returning id into inv;
  if rx is not null then insert into pharmacy_dispensings(dispensing_no,pharmacy_prescription_id,patient_no,visit_no,status,dispensed_by,notes) values(pharmacy_next_number('DSP-','public.pharmacy_dispensing_seq'),rx,h->>'patient_no',h->>'visit_no','COMPLETED',h->>'created_by',coalesce(h->>'notes','')) returning id into disp; end if;
  for it in select * from jsonb_array_elements(p_data->'items') loop
    med:=(it->>'medicine_id')::uuid; batch:=(it->>'batch_id')::uuid; q:=(it->>'quantity')::numeric; price:=(it->>'unit_price')::numeric; disc:=coalesce((it->>'discount_amount')::numeric,0); 
    select b.* into rec from pharmacy_batches b where b.id=batch and b.medicine_id=med for update; if not found then raise exception 'Batch not found for sale'; end if;
    if rec.status<>'AVAILABLE' then raise exception 'Batch % is not available',rec.batch_number; end if;
    if rec.expiry_date<=current_date then raise exception 'Expired batch % cannot be dispensed',rec.batch_number; end if;
    if rec.quantity_available<q then raise exception 'Insufficient stock for batch %',rec.batch_number; end if; if q<=0 or price<0 then raise exception 'Invalid sale quantity or rate'; end if; if rec.mrp>0 and price>rec.mrp then raise exception 'Sale rate cannot exceed MRP for batch %',rec.batch_number; end if;
    select m.* into drec from pharmacy_medicines m where m.id=med; if not found then raise exception 'Medicine not found'; end if;
    gst:=coalesce(drec.gst_rate,rec.gst_rate,0); sub:=sub+(price*q); disc:=disc; tax:=tax+greatest((price*q-disc),0)*gst/100; total:=total+greatest((price*q-disc),0)+greatest((price*q-disc),0)*gst/100;
    update pharmacy_batches set quantity_available=quantity_available-q,updated_at=now() where id=batch;
    insert into pharmacy_stock_transactions(transaction_no,medicine_id,batch_id,transaction_type,quantity_in,quantity_out,balance_after,unit_cost,reference_type,reference_id,reason,performed_by)
    values(pharmacy_next_number('STK-','public.pharmacy_txn_seq'),med,batch,'SALE',0,q,rec.quantity_available-q,rec.purchase_rate,'INVOICE',inv,'Pharmacy sale',h->>'created_by');
    if rx is not null then
      rxitem:=nullif(it->>'prescription_item_id','')::uuid;
      if rxitem is null then raise exception 'Prescription item is required for a prescription sale'; end if;
      insert into pharmacy_dispensing_items(dispensing_id,prescription_item_id,medicine_id,batch_id,quantity,unit_price) values(disp,rxitem,med,batch,q,price);
      update pharmacy_prescription_items set quantity_dispensed=quantity_dispensed+q,quantity_remaining=greatest(quantity_prescribed-(quantity_dispensed+q),0),dispensing_status=case when greatest(quantity_prescribed-(quantity_dispensed+q),0)=0 then 'COMPLETED' else 'PARTIAL' end,updated_at=now() where id=rxitem;
    end if;
    insert into pharmacy_invoice_items(invoice_id,medicine_id,batch_id,dispensing_item_id,description,hsn_code,batch_number,expiry_date,quantity,mrp,unit_price,discount_amount,taxable_amount,gst_rate,gst_amount,total_amount)
    values(inv,med,batch,nullif(it->>'dispensing_item_id','')::uuid,drec.brand_name||case when drec.strength<>'' then ' '||drec.strength else '' end,drec.hsn_code,rec.batch_number,rec.expiry_date,q,rec.mrp,price,disc,greatest(price*q-disc,0),gst,greatest(price*q-disc,0)*gst/100,greatest(price*q-disc,0)*(1+gst/100));
  end loop;
  bal:=greatest(total-paid,0);
  update pharmacy_invoices set subtotal=sub,discount_amount=coalesce((h->>'discount_amount')::numeric,0),taxable_amount=greatest(sub-coalesce((h->>'discount_amount')::numeric,0),0),gst_amount=tax,round_off=round(total)-total,total_amount=round(total),amount_paid=least(paid,round(total)),balance_due=greatest(round(total)-paid,0),status=case when paid>=round(total) then 'PAID' when paid>0 then 'PARTIAL' else 'UNPAID' end,updated_at=now() where id=inv;
  if paid>0 then insert into pharmacy_payments(invoice_id,payment_reference,payment_mode,amount,transaction_reference,received_by) values(inv,pharmacy_next_number('PAY-','public.pharmacy_payment_seq'),coalesce(h->>'payment_mode','CASH'),least(paid,round(total)),coalesce(h->>'transaction_reference',''),h->>'created_by'); end if;
  if rx is not null then update pharmacy_prescriptions set pharmacy_status=case when not exists(select 1 from pharmacy_prescription_items where pharmacy_prescription_id=rx and quantity_remaining>0) then 'COMPLETED' else 'PARTIAL' end,updated_at=now() where id=rx; end if;
  return jsonb_build_object('invoice_id',inv,'invoice_no',(select invoice_no from pharmacy_invoices where id=inv),'total_amount',(select total_amount from pharmacy_invoices where id=inv),'balance_due',(select balance_due from pharmacy_invoices where id=inv));
end $$;


ALTER FUNCTION "public"."pharmacy_create_sale"("p_data" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pharmacy_next_number"("prefix" "text", "seq_name" "text") RETURNS "text"
    LANGUAGE "plpgsql"
    AS $$
declare n bigint; begin execute format('select nextval(%L)',seq_name) into n; return prefix||to_char(current_date,'YYYYMMDD')||'-'||lpad(n::text,6,'0'); end $$;


ALTER FUNCTION "public"."pharmacy_next_number"("prefix" "text", "seq_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pharmacy_post_grn"("p_data" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  h jsonb := p_data->'header'; it jsonb; g uuid; po uuid; med uuid; b uuid; qty numeric; freeq numeric; oldqty numeric;
  supplier uuid := nullif(h->>'supplier_id','')::uuid;
  po_id uuid := nullif(h->>'purchase_order_id','')::uuid;
  r record;
begin
  if supplier is null then raise exception 'Supplier is required'; end if;
  if jsonb_array_length(coalesce(p_data->'items','[]'::jsonb))=0 then raise exception 'At least one GRN item is required'; end if;
  insert into pharmacy_grn(grn_number,supplier_id,purchase_order_id,supplier_invoice_no,supplier_invoice_date,received_date,status,notes,created_by)
  values(pharmacy_next_number('GRN-', 'public.pharmacy_grn_seq'),supplier,po_id,coalesce(h->>'supplier_invoice_no',''),nullif(h->>'supplier_invoice_date','')::date,coalesce(nullif(h->>'received_date','')::date,current_date),'POSTED',coalesce(h->>'notes',''),coalesce(h->>'created_by','')) returning id into g;
  for it in select * from jsonb_array_elements(p_data->'items') loop
    med := (it->>'medicine_id')::uuid; qty := (it->>'quantity_received')::numeric; freeq := coalesce(nullif(it->>'free_quantity','')::numeric,0);
    if qty<=0 then raise exception 'Received quantity must be greater than zero'; end if;
    if (it->>'expiry_date')::date <= current_date then raise exception 'Cannot receive an already expired batch'; end if;
    insert into pharmacy_grn_items(grn_id,medicine_id,batch_number,expiry_date,quantity_received,free_quantity,purchase_rate,mrp,gst_rate)
    values(g,med,it->>'batch_number',(it->>'expiry_date')::date,qty,freeq,coalesce((it->>'purchase_rate')::numeric,0),coalesce((it->>'mrp')::numeric,0),coalesce((it->>'gst_rate')::numeric,0));
    select * into r from pharmacy_batches where medicine_id=med and batch_number=it->>'batch_number' and expiry_date=(it->>'expiry_date')::date and supplier_id=supplier for update;
    if found then
      b:=r.id; oldqty:=r.quantity_available;
      update pharmacy_batches set quantity_available=quantity_available+qty+freeq,quantity_received=quantity_received+qty+freeq,purchase_rate=coalesce((it->>'purchase_rate')::numeric,purchase_rate),mrp=coalesce((it->>'mrp')::numeric,mrp),gst_rate=coalesce((it->>'gst_rate')::numeric,gst_rate),status='AVAILABLE',updated_at=now() where id=b;
    else
      insert into pharmacy_batches(medicine_id,batch_number,expiry_date,purchase_rate,mrp,gst_rate,quantity_available,quantity_received,supplier_id,grn_id,status) values(med,it->>'batch_number',(it->>'expiry_date')::date,coalesce((it->>'purchase_rate')::numeric,0),coalesce((it->>'mrp')::numeric,0),coalesce((it->>'gst_rate')::numeric,0),qty+freeq,qty+freeq,supplier,g,'AVAILABLE') returning id into b; oldqty:=0;
    end if;
    insert into pharmacy_stock_transactions(transaction_no,medicine_id,batch_id,transaction_type,quantity_in,quantity_out,balance_after,unit_cost,reference_type,reference_id,reason,performed_by)
    values(pharmacy_next_number('STK-','public.pharmacy_txn_seq'),med,b,'GRN',qty+freeq,0,oldqty+qty+freeq,coalesce((it->>'purchase_rate')::numeric,0),'GRN',g,'Goods received',coalesce(h->>'created_by',''));
  end loop;
  if po_id is not null then update pharmacy_purchase_orders set status='RECEIVED',updated_at=now() where id=po_id; end if;
  return jsonb_build_object('grn_id',g,'grn_number',(select grn_number from pharmacy_grn where id=g));
end $$;


ALTER FUNCTION "public"."pharmacy_post_grn"("p_data" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pharmacy_post_sales_return"("p_data" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare h jsonb:=p_data->'header'; it jsonb; r uuid; inv record; ii record; b record; q numeric; refund numeric:=0; prior numeric;
begin
 select * into inv from pharmacy_invoices where id=(h->>'invoice_id')::uuid for update; if not found then raise exception 'Invoice not found'; end if;
 insert into pharmacy_sales_returns(return_no,invoice_id,patient_no,status,reason,processed_by,approved_by) values(pharmacy_next_number('SRET-','public.pharmacy_sales_return_seq'),inv.id,inv.patient_no,'POSTED',coalesce(h->>'reason',''),h->>'processed_by',h->>'approved_by') returning id into r;
 for it in select * from jsonb_array_elements(p_data->'items') loop
   select * into ii from pharmacy_invoice_items where id=(it->>'invoice_item_id')::uuid and invoice_id=inv.id; if not found then raise exception 'Invoice item not found'; end if;
   q:=(it->>'quantity')::numeric; select coalesce(sum(ri.quantity),0) into prior from pharmacy_sales_return_items ri join pharmacy_sales_returns sr on sr.id=ri.return_id where ri.invoice_item_id=ii.id and sr.status='POSTED';
   if q<=0 or q+prior>ii.quantity then raise exception 'Return quantity exceeds sold quantity for %',ii.description; end if;
   select * into b from pharmacy_batches where id=ii.batch_id for update; if not found then raise exception 'Batch not found'; end if;
   insert into pharmacy_sales_return_items(return_id,invoice_item_id,medicine_id,batch_id,quantity,disposition) values(r,ii.id,ii.medicine_id,b.id,q,coalesce(it->>'disposition','QUARANTINE'));
   if upper(coalesce(it->>'disposition','QUARANTINE'))='RESTOCK' and b.expiry_date>current_date and b.status='AVAILABLE' then
     update pharmacy_batches set quantity_available=quantity_available+q,updated_at=now() where id=b.id;
     insert into pharmacy_stock_transactions(transaction_no,medicine_id,batch_id,transaction_type,quantity_in,quantity_out,balance_after,unit_cost,reference_type,reference_id,reason,performed_by) values(pharmacy_next_number('STK-','public.pharmacy_txn_seq'),ii.medicine_id,b.id,'SALES_RETURN',q,0,b.quantity_available+q,b.purchase_rate,'SALES_RETURN',r,coalesce(h->>'reason',''),h->>'processed_by');
   elsif upper(coalesce(it->>'disposition','QUARANTINE'))='QUARANTINE' then
     update pharmacy_batches set quantity_quarantined=quantity_quarantined+q,status='QUARANTINE',updated_at=now() where id=b.id;
     insert into pharmacy_stock_transactions(transaction_no,medicine_id,batch_id,transaction_type,quantity_in,quantity_out,balance_after,unit_cost,reference_type,reference_id,reason,performed_by) values(pharmacy_next_number('STK-','public.pharmacy_txn_seq'),ii.medicine_id,b.id,'SALES_RETURN_QUARANTINE',0,0,b.quantity_available,b.purchase_rate,'SALES_RETURN',r,coalesce(h->>'reason',''),h->>'processed_by');
   else
     insert into pharmacy_stock_transactions(transaction_no,medicine_id,batch_id,transaction_type,quantity_in,quantity_out,balance_after,unit_cost,reference_type,reference_id,reason,performed_by) values(pharmacy_next_number('STK-','public.pharmacy_txn_seq'),ii.medicine_id,b.id,'SALES_RETURN_DISCARD',0,0,b.quantity_available,b.purchase_rate,'SALES_RETURN',r,coalesce(h->>'reason',''),h->>'processed_by');
   end if;
   refund:=refund+(ii.unit_price*q);
 end loop;
 update pharmacy_sales_returns set refund_amount=refund where id=r;
 return jsonb_build_object('return_id',r,'refund_amount',refund);
end $$;


ALTER FUNCTION "public"."pharmacy_post_sales_return"("p_data" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pharmacy_post_supplier_return"("p_data" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare h jsonb:=p_data->'header'; it jsonb; r uuid; b record; q numeric; oldq numeric;
begin
 insert into pharmacy_supplier_returns(return_no,supplier_id,status,reason,supplier_document_no,created_by,approved_by) values(pharmacy_next_number('PRET-','public.pharmacy_supplier_return_seq'),(h->>'supplier_id')::uuid,'POSTED',coalesce(h->>'reason',''),coalesce(h->>'supplier_document_no',''),h->>'created_by',h->>'approved_by') returning id into r;
 for it in select * from jsonb_array_elements(p_data->'items') loop
   q:=(it->>'quantity')::numeric; select * into b from pharmacy_batches where id=(it->>'batch_id')::uuid for update; if not found then raise exception 'Batch not found'; end if; if q<=0 or q>b.quantity_available then raise exception 'Invalid supplier return quantity'; end if;
   oldq:=b.quantity_available; update pharmacy_batches set quantity_available=quantity_available-q,updated_at=now() where id=b.id;
   insert into pharmacy_supplier_return_items(return_id,medicine_id,batch_id,quantity,unit_cost) values(r,b.medicine_id,b.id,q,b.purchase_rate);
   insert into pharmacy_stock_transactions(transaction_no,medicine_id,batch_id,transaction_type,quantity_in,quantity_out,balance_after,unit_cost,reference_type,reference_id,reason,performed_by) values(pharmacy_next_number('STK-','public.pharmacy_txn_seq'),b.medicine_id,b.id,'SUPPLIER_RETURN',0,q,oldq-q,b.purchase_rate,'SUPPLIER_RETURN',r,coalesce(h->>'reason',''),h->>'created_by');
 end loop;
 return jsonb_build_object('return_id',r);
end $$;


ALTER FUNCTION "public"."pharmacy_post_supplier_return"("p_data" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pharmacy_record_payment"("p_data" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare i record; amt numeric; paid numeric;
begin
 select * into i from pharmacy_invoices where id=(p_data->>'invoice_id')::uuid for update; if not found then raise exception 'Invoice not found'; end if;
 amt:=(p_data->>'amount')::numeric; if amt<=0 then raise exception 'Payment must be greater than zero'; end if; if amt>i.balance_due then raise exception 'Payment exceeds balance due'; end if;
 insert into pharmacy_payments(invoice_id,payment_reference,payment_mode,amount,transaction_reference,received_by) values(i.id,pharmacy_next_number('PAY-','public.pharmacy_payment_seq'),coalesce(p_data->>'payment_mode','CASH'),amt,coalesce(p_data->>'transaction_reference',''),p_data->>'received_by');
 paid:=i.amount_paid+amt; update pharmacy_invoices set amount_paid=paid,balance_due=greatest(total_amount-paid,0),status=case when paid>=total_amount then 'PAID' else 'PARTIAL' end,updated_at=now() where id=i.id;
 return jsonb_build_object('invoice_id',i.id,'amount_paid',paid,'balance_due',greatest(i.total_amount-paid,0));
end $$;


ALTER FUNCTION "public"."pharmacy_record_payment"("p_data" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pharmacy_request_adjustment"("p_data" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare d jsonb:=p_data; b record; a uuid;
begin
 select * into b from pharmacy_batches where id=(d->>'batch_id')::uuid for update; if not found then raise exception 'Batch not found'; end if;
 if (d->>'new_quantity')::numeric<0 then raise exception 'Quantity cannot be negative'; end if;
 insert into pharmacy_stock_adjustments(adjustment_no,medicine_id,batch_id,previous_quantity,adjusted_quantity,new_quantity,reason,status,requested_by)
 values(pharmacy_next_number('ADJ-','public.pharmacy_adjustment_seq'),b.medicine_id,b.id,b.quantity_available,(d->>'new_quantity')::numeric,(d->>'new_quantity')::numeric,coalesce(d->>'reason',''),'PENDING',coalesce(d->>'requested_by','')) returning id into a;
 return jsonb_build_object('adjustment_id',a);
end $$;


ALTER FUNCTION "public"."pharmacy_request_adjustment"("p_data" "jsonb") OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."livya_appointment_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."livya_appointment_seq" OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."appointments" (
    "appointment_no" "text" DEFAULT ('APT'::"text" || "lpad"(("nextval"('"public"."livya_appointment_seq"'::"regclass"))::"text", 6, '0'::"text")) NOT NULL,
    "patient_no" "text" NOT NULL,
    "appointment_date" "date" NOT NULL,
    "appointment_time" time without time zone,
    "doctor_id" "uuid",
    "doctor_name" "text" DEFAULT ''::"text" NOT NULL,
    "speciality" "text" DEFAULT ''::"text" NOT NULL,
    "department" "text" DEFAULT ''::"text" NOT NULL,
    "branch" "text" DEFAULT ''::"text" NOT NULL,
    "reason" "text" DEFAULT ''::"text" NOT NULL,
    "status" "text" DEFAULT 'BOOKED'::"text" NOT NULL,
    "created_by" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."appointments" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."appointments_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."appointments_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_email" "text",
    "user_name" "text",
    "role" "text",
    "action" "text",
    "entity" "text",
    "entity_id" "text",
    "details" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."audit_log" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."auditlog_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."auditlog_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."case_revisions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "case_sheet_id" "text" NOT NULL,
    "visit_no" "text" NOT NULL,
    "patient_no" "text" NOT NULL,
    "changed_by" "text",
    "changed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "snapshot_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "public"."case_revisions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."case_sheet_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "department" "text" NOT NULL,
    "template_key" "text" NOT NULL,
    "title" "text" NOT NULL,
    "schema" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "configured" boolean DEFAULT false NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."case_sheet_templates" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."livya_case_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."livya_case_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."case_sheets" (
    "case_sheet_id" "text" DEFAULT ('CS'::"text" || "lpad"(("nextval"('"public"."livya_case_seq"'::"regclass"))::"text", 6, '0'::"text")) NOT NULL,
    "visit_no" "text" NOT NULL,
    "patient_no" "text" NOT NULL,
    "department_id" "uuid",
    "department" "text" DEFAULT ''::"text" NOT NULL,
    "doctor_id" "uuid",
    "doctor_name" "text" DEFAULT ''::"text" NOT NULL,
    "consultation_fee" numeric(12,2) DEFAULT 0 NOT NULL,
    "billing_enabled" boolean DEFAULT false NOT NULL,
    "template_key" "text" DEFAULT ''::"text" NOT NULL,
    "form_data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "chief_complaint" "text" DEFAULT ''::"text" NOT NULL,
    "history" "text" DEFAULT ''::"text" NOT NULL,
    "examination" "text" DEFAULT ''::"text" NOT NULL,
    "diagnosis" "text" DEFAULT ''::"text" NOT NULL,
    "treatment_plan" "text" DEFAULT ''::"text" NOT NULL,
    "clinical_notes" "text" DEFAULT ''::"text" NOT NULL,
    "follow_up" "text" DEFAULT ''::"text" NOT NULL,
    "status" "text" DEFAULT 'OPEN'::"text" NOT NULL,
    "updated_by" "text" DEFAULT ''::"text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "locked_at" timestamp with time zone,
    "locked_by" "text",
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."case_sheets" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."casesheets_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."casesheets_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."departments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "designation" "text" DEFAULT ''::"text" NOT NULL,
    "consultation_fee" numeric(12,2) DEFAULT 1500 NOT NULL,
    "billing_enabled" boolean DEFAULT true NOT NULL,
    "case_sheet_enabled" boolean DEFAULT true NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 100 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."departments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."encounter_documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "patient_no" "text" NOT NULL,
    "encounter_id" "text" NOT NULL,
    "document_type" "text" NOT NULL,
    "file_name" "text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "created_by" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "text" DEFAULT ''::"text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."encounter_documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."hims_billing_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "patient_no" "text" NOT NULL,
    "appointment_no" "text",
    "visit_no" "text" NOT NULL,
    "case_sheet_id" "text" NOT NULL,
    "department" "text" DEFAULT ''::"text" NOT NULL,
    "provider_id" "uuid",
    "provider_name" "text" DEFAULT ''::"text" NOT NULL,
    "amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'READY'::"text" NOT NULL,
    "bill_id" "uuid",
    "created_by" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "billed_at" timestamp with time zone
);


ALTER TABLE "public"."hims_billing_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."hims_bills" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bill_no" "text" NOT NULL,
    "patient_no" "text" NOT NULL,
    "appointment_no" "text",
    "subtotal" numeric(12,2) DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'UNPAID'::"text" NOT NULL,
    "created_by" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "paid_at" timestamp with time zone,
    "gross_amount" numeric(12,2) DEFAULT 0,
    "discount_amount" numeric(12,2) DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."hims_bills" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."invoiceitems_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."invoiceitems_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoice_items" (
    "invoice_item_id" "text" DEFAULT ('INVI'::"text" || "lpad"(("nextval"('"public"."invoiceitems_seq"'::"regclass"))::"text", 6, '0'::"text")) NOT NULL,
    "invoice_no" "text" NOT NULL,
    "service_id" "text" DEFAULT ''::"text",
    "description" "text" DEFAULT ''::"text",
    "qty" numeric(12,2) DEFAULT 1 NOT NULL,
    "rate" numeric(12,2) DEFAULT 0 NOT NULL,
    "amount" numeric(12,2) DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."invoice_items" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."invoices_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."invoices_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoices" (
    "invoice_no" "text" DEFAULT ('INV'::"text" || "lpad"(("nextval"('"public"."invoices_seq"'::"regclass"))::"text", 6, '0'::"text")) NOT NULL,
    "visit_no" "text" DEFAULT ''::"text",
    "patient_no" "text" NOT NULL,
    "subtotal" numeric(12,2) DEFAULT 0 NOT NULL,
    "discount" numeric(12,2) DEFAULT 0 NOT NULL,
    "tax" numeric(12,2) DEFAULT 0 NOT NULL,
    "total" numeric(12,2) DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'OPEN'::"text" NOT NULL,
    "created_by" "text" DEFAULT ''::"text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."invoices" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."livya_bill_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."livya_bill_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."livya_opening_stock_staging" (
    "sku" "text",
    "batch_number" "text",
    "product_name" "text",
    "location" "text",
    "rack" "text",
    "expiry_date" "date",
    "quantity" numeric,
    "purchase_rate" numeric,
    "sale_price" numeric,
    "mrp" numeric
);


ALTER TABLE "public"."livya_opening_stock_staging" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."livya_patient_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."livya_patient_seq" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."livya_visit_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."livya_visit_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "recipient_user_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "message" "text" NOT NULL,
    "entity_type" "text" DEFAULT ''::"text" NOT NULL,
    "entity_id" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "read_at" timestamp with time zone
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."patient_files" (
    "file_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "patient_no" "text" NOT NULL,
    "visit_no" "text",
    "encounter_id" "text" DEFAULT ''::"text" NOT NULL,
    "file_name" "text" NOT NULL,
    "mime_type" "text" DEFAULT 'application/octet-stream'::"text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "uploaded_by" "text" DEFAULT ''::"text" NOT NULL,
    "uploaded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'ACTIVE'::"text" NOT NULL
);


ALTER TABLE "public"."patient_files" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."patientfiles_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."patientfiles_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."patients" (
    "patient_id" "text" DEFAULT ('PAT'::"text" || "lpad"(("nextval"('"public"."livya_patient_seq"'::"regclass"))::"text", 6, '0'::"text")) NOT NULL,
    "name" "text" NOT NULL,
    "gender" "text" DEFAULT ''::"text" NOT NULL,
    "dob" "date",
    "mobile" "text" NOT NULL,
    "email" "text" DEFAULT ''::"text" NOT NULL,
    "address" "text" DEFAULT ''::"text" NOT NULL,
    "blood_group" "text" DEFAULT ''::"text" NOT NULL,
    "allergies" "text" DEFAULT ''::"text" NOT NULL,
    "emergency_contact" "text" DEFAULT ''::"text" NOT NULL,
    "status" "text" DEFAULT 'ACTIVE'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."patients" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."patients_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."patients_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bill_id" "uuid",
    "patient_no" "text",
    "amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "payment_mode" "text" DEFAULT 'CASH'::"text" NOT NULL,
    "reference_no" "text" DEFAULT ''::"text" NOT NULL,
    "status" "text" DEFAULT 'PAID'::"text" NOT NULL,
    "paid_by" "text" DEFAULT ''::"text" NOT NULL,
    "paid_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."payments" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."payments_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."payments_seq" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."pharmacy_adjustment_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."pharmacy_adjustment_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pharmacy_audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_email" "text" DEFAULT ''::"text" NOT NULL,
    "user_name" "text" DEFAULT ''::"text" NOT NULL,
    "action" "text" NOT NULL,
    "entity" "text" NOT NULL,
    "entity_id" "text" DEFAULT ''::"text" NOT NULL,
    "details" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."pharmacy_audit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pharmacy_batches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "medicine_id" "uuid" NOT NULL,
    "batch_number" "text" NOT NULL,
    "expiry_date" "date",
    "purchase_rate" numeric(12,2) DEFAULT 0 NOT NULL,
    "mrp" numeric(12,2) DEFAULT 0 NOT NULL,
    "gst_rate" numeric(5,2) DEFAULT 0 NOT NULL,
    "quantity_available" numeric(14,3) DEFAULT 0 NOT NULL,
    "quantity_received" numeric(14,3) DEFAULT 0 NOT NULL,
    "supplier_id" "uuid",
    "grn_id" "uuid",
    "status" "text" DEFAULT 'AVAILABLE'::"text" NOT NULL,
    "quarantine_reason" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "quantity_quarantined" numeric(14,3) DEFAULT 0 NOT NULL,
    "sale_price" numeric(12,2) DEFAULT 0 NOT NULL,
    CONSTRAINT "pharmacy_batches_quantity_available_check" CHECK (("quantity_available" >= (0)::numeric)),
    CONSTRAINT "pharmacy_batches_quantity_quarantined_check" CHECK (("quantity_quarantined" >= (0)::numeric)),
    CONSTRAINT "pharmacy_batches_quantity_received_check" CHECK (("quantity_received" >= (0)::numeric))
);


ALTER TABLE "public"."pharmacy_batches" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pharmacy_dispensing_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "dispensing_id" "uuid" NOT NULL,
    "prescription_item_id" "uuid" NOT NULL,
    "medicine_id" "uuid" NOT NULL,
    "batch_id" "uuid" NOT NULL,
    "quantity" numeric(14,3) NOT NULL,
    "unit_price" numeric(12,2) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "pharmacy_dispensing_items_quantity_check" CHECK (("quantity" > (0)::numeric))
);


ALTER TABLE "public"."pharmacy_dispensing_items" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."pharmacy_dispensing_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."pharmacy_dispensing_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pharmacy_dispensings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "dispensing_no" "text" NOT NULL,
    "pharmacy_prescription_id" "uuid" NOT NULL,
    "patient_no" "text" NOT NULL,
    "visit_no" "text" NOT NULL,
    "status" "text" DEFAULT 'COMPLETED'::"text" NOT NULL,
    "dispensed_by" "text" DEFAULT ''::"text" NOT NULL,
    "dispensed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "notes" "text" DEFAULT ''::"text" NOT NULL
);


ALTER TABLE "public"."pharmacy_dispensings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pharmacy_grn" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "grn_number" "text" NOT NULL,
    "supplier_id" "uuid" NOT NULL,
    "purchase_order_id" "uuid",
    "supplier_invoice_no" "text" DEFAULT ''::"text" NOT NULL,
    "supplier_invoice_date" "date",
    "received_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "status" "text" DEFAULT 'POSTED'::"text" NOT NULL,
    "notes" "text" DEFAULT ''::"text" NOT NULL,
    "created_by" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."pharmacy_grn" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pharmacy_grn_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "grn_id" "uuid" NOT NULL,
    "medicine_id" "uuid" NOT NULL,
    "batch_number" "text" NOT NULL,
    "expiry_date" "date" NOT NULL,
    "quantity_received" numeric(14,3) NOT NULL,
    "free_quantity" numeric(14,3) DEFAULT 0 NOT NULL,
    "purchase_rate" numeric(12,2) DEFAULT 0 NOT NULL,
    "mrp" numeric(12,2) DEFAULT 0 NOT NULL,
    "gst_rate" numeric(5,2) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "pharmacy_grn_items_free_quantity_check" CHECK (("free_quantity" >= (0)::numeric)),
    CONSTRAINT "pharmacy_grn_items_quantity_received_check" CHECK (("quantity_received" > (0)::numeric))
);


ALTER TABLE "public"."pharmacy_grn_items" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."pharmacy_grn_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."pharmacy_grn_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pharmacy_invoice_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "invoice_id" "uuid" NOT NULL,
    "medicine_id" "uuid" NOT NULL,
    "batch_id" "uuid" NOT NULL,
    "dispensing_item_id" "uuid",
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "hsn_code" "text" DEFAULT ''::"text" NOT NULL,
    "batch_number" "text" DEFAULT ''::"text" NOT NULL,
    "expiry_date" "date",
    "quantity" numeric(14,3) NOT NULL,
    "mrp" numeric(12,2) DEFAULT 0 NOT NULL,
    "unit_price" numeric(12,2) DEFAULT 0 NOT NULL,
    "discount_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "taxable_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "gst_rate" numeric(5,2) DEFAULT 0 NOT NULL,
    "gst_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "total_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "pharmacy_invoice_items_quantity_check" CHECK (("quantity" > (0)::numeric))
);


ALTER TABLE "public"."pharmacy_invoice_items" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."pharmacy_invoice_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."pharmacy_invoice_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pharmacy_invoices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "invoice_no" "text" NOT NULL,
    "patient_no" "text",
    "visit_no" "text",
    "pharmacy_prescription_id" "uuid",
    "invoice_date" timestamp with time zone DEFAULT "now"() NOT NULL,
    "customer_name" "text" DEFAULT ''::"text" NOT NULL,
    "customer_mobile" "text" DEFAULT ''::"text" NOT NULL,
    "subtotal" numeric(14,2) DEFAULT 0 NOT NULL,
    "discount_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "taxable_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "gst_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "round_off" numeric(14,2) DEFAULT 0 NOT NULL,
    "total_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "amount_paid" numeric(14,2) DEFAULT 0 NOT NULL,
    "balance_due" numeric(14,2) DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'UNPAID'::"text" NOT NULL,
    "created_by" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."pharmacy_invoices" OWNER TO "postgres";


COMMENT ON TABLE "public"."pharmacy_invoices" IS 'Independent pharmacy billing ledger. Not part of HIMS clinical billing.';



CREATE TABLE IF NOT EXISTS "public"."pharmacy_manufacturers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "address" "text" DEFAULT ''::"text" NOT NULL,
    "contact" "text" DEFAULT ''::"text" NOT NULL,
    "gstin" "text" DEFAULT ''::"text" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."pharmacy_manufacturers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pharmacy_medicines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sku" "text" NOT NULL,
    "generic_name" "text" NOT NULL,
    "brand_name" "text" DEFAULT ''::"text" NOT NULL,
    "composition" "text" DEFAULT ''::"text" NOT NULL,
    "strength" "text" DEFAULT ''::"text" NOT NULL,
    "dosage_form" "text" DEFAULT ''::"text" NOT NULL,
    "pack_size" numeric(12,3) DEFAULT 1 NOT NULL,
    "pack_unit" "text" DEFAULT 'UNIT'::"text" NOT NULL,
    "manufacturer_id" "uuid",
    "category" "text" DEFAULT ''::"text" NOT NULL,
    "therapeutic_category" "text" DEFAULT ''::"text" NOT NULL,
    "hsn_code" "text" DEFAULT ''::"text" NOT NULL,
    "gst_rate" numeric(5,2) DEFAULT 0 NOT NULL,
    "default_mrp" numeric(12,2) DEFAULT 0 NOT NULL,
    "default_purchase_rate" numeric(12,2) DEFAULT 0 NOT NULL,
    "prescription_required" boolean DEFAULT true NOT NULL,
    "schedule_classification" "text" DEFAULT ''::"text" NOT NULL,
    "refrigerated" boolean DEFAULT false NOT NULL,
    "cold_chain_required" boolean DEFAULT false NOT NULL,
    "controlled_medicine" boolean DEFAULT false NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "default_sale_price" numeric(12,2) DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."pharmacy_medicines" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."pharmacy_payment_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."pharmacy_payment_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pharmacy_payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "invoice_id" "uuid" NOT NULL,
    "payment_reference" "text" NOT NULL,
    "payment_mode" "text" NOT NULL,
    "amount" numeric(14,2) NOT NULL,
    "transaction_reference" "text" DEFAULT ''::"text" NOT NULL,
    "paid_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "received_by" "text" DEFAULT ''::"text" NOT NULL,
    CONSTRAINT "pharmacy_payments_amount_check" CHECK (("amount" > (0)::numeric))
);


ALTER TABLE "public"."pharmacy_payments" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."pharmacy_po_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."pharmacy_po_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pharmacy_prescription_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "pharmacy_prescription_id" "uuid" NOT NULL,
    "source_visit_prescription_id" "uuid",
    "medicine_id" "uuid",
    "prescribed_name" "text" DEFAULT ''::"text" NOT NULL,
    "strength" "text" DEFAULT ''::"text" NOT NULL,
    "dosage" "text" DEFAULT ''::"text" NOT NULL,
    "route" "text" DEFAULT ''::"text" NOT NULL,
    "frequency" "text" DEFAULT ''::"text" NOT NULL,
    "duration" "text" DEFAULT ''::"text" NOT NULL,
    "quantity_prescribed" numeric(14,3) DEFAULT 0 NOT NULL,
    "quantity_dispensed" numeric(14,3) DEFAULT 0 NOT NULL,
    "quantity_remaining" numeric(14,3) DEFAULT 0 NOT NULL,
    "instructions" "text" DEFAULT ''::"text" NOT NULL,
    "dispensing_status" "text" DEFAULT 'PENDING'::"text" NOT NULL,
    "substitution_allowed" boolean DEFAULT false NOT NULL,
    "substitution_reason" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "availability_status" "text" DEFAULT 'PENDING'::"text" NOT NULL,
    CONSTRAINT "pharmacy_prescription_items_quantity_dispensed_check" CHECK (("quantity_dispensed" >= (0)::numeric)),
    CONSTRAINT "pharmacy_prescription_items_quantity_prescribed_check" CHECK (("quantity_prescribed" >= (0)::numeric)),
    CONSTRAINT "pharmacy_prescription_items_quantity_remaining_check" CHECK (("quantity_remaining" >= (0)::numeric))
);


ALTER TABLE "public"."pharmacy_prescription_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pharmacy_prescriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "visit_no" "text" NOT NULL,
    "patient_no" "text" NOT NULL,
    "source_status" "text" DEFAULT 'ACTIVE'::"text" NOT NULL,
    "pharmacy_status" "text" DEFAULT 'PENDING'::"text" NOT NULL,
    "source_updated_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."pharmacy_prescriptions" OWNER TO "postgres";


COMMENT ON TABLE "public"."pharmacy_prescriptions" IS 'Pharmacy processing representation linked to the HIMS visit.';



CREATE TABLE IF NOT EXISTS "public"."pharmacy_purchase_order_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "purchase_order_id" "uuid" NOT NULL,
    "medicine_id" "uuid" NOT NULL,
    "ordered_qty" numeric(14,3) DEFAULT 0 NOT NULL,
    "free_qty" numeric(14,3) DEFAULT 0 NOT NULL,
    "purchase_rate" numeric(12,2) DEFAULT 0 NOT NULL,
    "mrp" numeric(12,2) DEFAULT 0 NOT NULL,
    "gst_rate" numeric(5,2) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "pharmacy_purchase_order_items_free_qty_check" CHECK (("free_qty" >= (0)::numeric)),
    CONSTRAINT "pharmacy_purchase_order_items_ordered_qty_check" CHECK (("ordered_qty" >= (0)::numeric))
);


ALTER TABLE "public"."pharmacy_purchase_order_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pharmacy_purchase_orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "po_number" "text" NOT NULL,
    "supplier_id" "uuid" NOT NULL,
    "po_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "status" "text" DEFAULT 'DRAFT'::"text" NOT NULL,
    "notes" "text" DEFAULT ''::"text" NOT NULL,
    "created_by" "text" DEFAULT ''::"text" NOT NULL,
    "approved_by" "text" DEFAULT ''::"text" NOT NULL,
    "approved_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."pharmacy_purchase_orders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pharmacy_sales_return_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "return_id" "uuid" NOT NULL,
    "invoice_item_id" "uuid" NOT NULL,
    "medicine_id" "uuid" NOT NULL,
    "batch_id" "uuid" NOT NULL,
    "quantity" numeric(14,3) NOT NULL,
    "disposition" "text" DEFAULT 'QUARANTINE'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "pharmacy_sales_return_items_quantity_check" CHECK (("quantity" > (0)::numeric))
);


ALTER TABLE "public"."pharmacy_sales_return_items" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."pharmacy_sales_return_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."pharmacy_sales_return_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pharmacy_sales_returns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "return_no" "text" NOT NULL,
    "invoice_id" "uuid" NOT NULL,
    "patient_no" "text",
    "return_date" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'POSTED'::"text" NOT NULL,
    "reason" "text" DEFAULT ''::"text" NOT NULL,
    "refund_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "processed_by" "text" DEFAULT ''::"text" NOT NULL,
    "approved_by" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."pharmacy_sales_returns" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pharmacy_settings" (
    "setting_key" "text" NOT NULL,
    "setting_value" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "updated_by" "text" DEFAULT ''::"text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."pharmacy_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pharmacy_stock_adjustments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "adjustment_no" "text" NOT NULL,
    "medicine_id" "uuid" NOT NULL,
    "batch_id" "uuid" NOT NULL,
    "previous_quantity" numeric(14,3) DEFAULT 0 NOT NULL,
    "adjusted_quantity" numeric(14,3) DEFAULT 0 NOT NULL,
    "new_quantity" numeric(14,3) DEFAULT 0 NOT NULL,
    "reason" "text" NOT NULL,
    "status" "text" DEFAULT 'PENDING'::"text" NOT NULL,
    "requested_by" "text" DEFAULT ''::"text" NOT NULL,
    "approved_by" "text" DEFAULT ''::"text" NOT NULL,
    "approved_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."pharmacy_stock_adjustments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pharmacy_stock_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "transaction_no" "text" NOT NULL,
    "medicine_id" "uuid" NOT NULL,
    "batch_id" "uuid",
    "transaction_type" "text" NOT NULL,
    "quantity_in" numeric(14,3) DEFAULT 0 NOT NULL,
    "quantity_out" numeric(14,3) DEFAULT 0 NOT NULL,
    "balance_after" numeric(14,3) DEFAULT 0 NOT NULL,
    "unit_cost" numeric(12,2) DEFAULT 0 NOT NULL,
    "reference_type" "text" DEFAULT ''::"text" NOT NULL,
    "reference_id" "uuid",
    "reason" "text" DEFAULT ''::"text" NOT NULL,
    "performed_by" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "pharmacy_stock_transactions_quantity_in_check" CHECK (("quantity_in" >= (0)::numeric)),
    CONSTRAINT "pharmacy_stock_transactions_quantity_out_check" CHECK (("quantity_out" >= (0)::numeric))
);


ALTER TABLE "public"."pharmacy_stock_transactions" OWNER TO "postgres";


COMMENT ON TABLE "public"."pharmacy_stock_transactions" IS 'Append-only pharmacy stock ledger. Posted transactions must not be deleted or edited.';



CREATE TABLE IF NOT EXISTS "public"."pharmacy_supplier_return_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "return_id" "uuid" NOT NULL,
    "medicine_id" "uuid" NOT NULL,
    "batch_id" "uuid" NOT NULL,
    "quantity" numeric(14,3) NOT NULL,
    "unit_cost" numeric(12,2) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "pharmacy_supplier_return_items_quantity_check" CHECK (("quantity" > (0)::numeric))
);


ALTER TABLE "public"."pharmacy_supplier_return_items" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."pharmacy_supplier_return_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."pharmacy_supplier_return_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pharmacy_supplier_returns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "return_no" "text" NOT NULL,
    "supplier_id" "uuid" NOT NULL,
    "return_date" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'POSTED'::"text" NOT NULL,
    "reason" "text" DEFAULT ''::"text" NOT NULL,
    "supplier_document_no" "text" DEFAULT ''::"text" NOT NULL,
    "created_by" "text" DEFAULT ''::"text" NOT NULL,
    "approved_by" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."pharmacy_supplier_returns" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pharmacy_suppliers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "supplier_code" "text" NOT NULL,
    "address" "text" DEFAULT ''::"text" NOT NULL,
    "contact_person" "text" DEFAULT ''::"text" NOT NULL,
    "phone" "text" DEFAULT ''::"text" NOT NULL,
    "email" "text" DEFAULT ''::"text" NOT NULL,
    "gstin" "text" DEFAULT ''::"text" NOT NULL,
    "drug_license_no" "text" DEFAULT ''::"text" NOT NULL,
    "payment_terms" "text" DEFAULT ''::"text" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."pharmacy_suppliers" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."pharmacy_txn_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."pharmacy_txn_seq" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."prescriptions_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."prescriptions_seq" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."revisions_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."revisions_seq" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."services_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."services_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."services" (
    "service_id" "text" DEFAULT ('SRV'::"text" || "lpad"(("nextval"('"public"."services_seq"'::"regclass"))::"text", 6, '0'::"text")) NOT NULL,
    "service_name" "text" NOT NULL,
    "category" "text" DEFAULT ''::"text",
    "amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'ACTIVE'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."services" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."settings" (
    "key" "text" NOT NULL,
    "value" "text" DEFAULT ''::"text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "user_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "auth_user_id" "uuid",
    "name" "text" NOT NULL,
    "email" "text" NOT NULL,
    "role" "text" DEFAULT 'STAFF'::"text" NOT NULL,
    "job_title" "text" DEFAULT ''::"text" NOT NULL,
    "speciality" "text" DEFAULT ''::"text" NOT NULL,
    "department" "text" DEFAULT ''::"text" NOT NULL,
    "department_id" "uuid",
    "branch" "text" DEFAULT ''::"text" NOT NULL,
    "consultation_fee" numeric(12,2) DEFAULT 0 NOT NULL,
    "billing_enabled" boolean DEFAULT false NOT NULL,
    "case_sheet_enabled" boolean DEFAULT false NOT NULL,
    "profile_photo_path" "text" DEFAULT ''::"text" NOT NULL,
    "status" "text" DEFAULT 'ACTIVE'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_login_at" timestamp with time zone
);


ALTER TABLE "public"."users" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."users_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."users_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."visit_prescriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "visit_no" "text" NOT NULL,
    "patient_no" "text" NOT NULL,
    "medicine_name" "text" DEFAULT ''::"text" NOT NULL,
    "dose" "text" DEFAULT ''::"text" NOT NULL,
    "duration" "text" DEFAULT ''::"text" NOT NULL,
    "instructions" "text" DEFAULT ''::"text" NOT NULL,
    "prescribed_by" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "pharmacy_medicine_id" "uuid"
);


ALTER TABLE "public"."visit_prescriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."visit_screenings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "visit_no" "text" NOT NULL,
    "patient_no" "text" NOT NULL,
    "test_type" "text" DEFAULT 'Other'::"text" NOT NULL,
    "test_name" "text" DEFAULT ''::"text" NOT NULL,
    "indication" "text" DEFAULT ''::"text" NOT NULL,
    "requested_by" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."visit_screenings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."visits" (
    "visit_no" "text" DEFAULT ('VIS'::"text" || "lpad"(("nextval"('"public"."livya_visit_seq"'::"regclass"))::"text", 6, '0'::"text")) NOT NULL,
    "encounter_id" "text" DEFAULT ('ENC'::"text" || "replace"(("gen_random_uuid"())::"text", '-'::"text", ''::"text")) NOT NULL,
    "patient_no" "text" NOT NULL,
    "appointment_no" "text",
    "check_in_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "check_out_at" timestamp with time zone,
    "status" "text" DEFAULT 'OPEN'::"text" NOT NULL,
    "created_by" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."visits" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."visits_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."visits_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vitals" (
    "vital_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "encounter_id" "text" DEFAULT ''::"text" NOT NULL,
    "visit_no" "text" NOT NULL,
    "patient_no" "text" NOT NULL,
    "temperature" "text" DEFAULT ''::"text" NOT NULL,
    "pulse" "text" DEFAULT ''::"text" NOT NULL,
    "respiratory_rate" "text" DEFAULT ''::"text" NOT NULL,
    "blood_pressure" "text" DEFAULT ''::"text" NOT NULL,
    "spo2" "text" DEFAULT ''::"text" NOT NULL,
    "weight" "text" DEFAULT ''::"text" NOT NULL,
    "height" "text" DEFAULT ''::"text" NOT NULL,
    "bmi" "text" DEFAULT ''::"text" NOT NULL,
    "notes" "text" DEFAULT ''::"text" NOT NULL,
    "recorded_by" "text" DEFAULT ''::"text" NOT NULL,
    "recorded_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."vitals" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."vitals_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."vitals_seq" OWNER TO "postgres";


ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_pkey" PRIMARY KEY ("appointment_no");



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."case_revisions"
    ADD CONSTRAINT "case_revisions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."case_sheet_templates"
    ADD CONSTRAINT "case_sheet_templates_department_template_key_key" UNIQUE ("department", "template_key");



ALTER TABLE ONLY "public"."case_sheet_templates"
    ADD CONSTRAINT "case_sheet_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."case_sheets"
    ADD CONSTRAINT "case_sheets_pkey" PRIMARY KEY ("case_sheet_id");



ALTER TABLE ONLY "public"."departments"
    ADD CONSTRAINT "departments_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."departments"
    ADD CONSTRAINT "departments_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."departments"
    ADD CONSTRAINT "departments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."encounter_documents"
    ADD CONSTRAINT "encounter_documents_encounter_id_document_type_key" UNIQUE ("encounter_id", "document_type");



ALTER TABLE ONLY "public"."encounter_documents"
    ADD CONSTRAINT "encounter_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."hims_billing_items"
    ADD CONSTRAINT "hims_billing_items_case_sheet_id_key" UNIQUE ("case_sheet_id");



ALTER TABLE ONLY "public"."hims_billing_items"
    ADD CONSTRAINT "hims_billing_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."hims_bills"
    ADD CONSTRAINT "hims_bills_bill_no_key" UNIQUE ("bill_no");



ALTER TABLE ONLY "public"."hims_bills"
    ADD CONSTRAINT "hims_bills_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoice_items"
    ADD CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("invoice_item_id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_pkey" PRIMARY KEY ("invoice_no");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."patient_files"
    ADD CONSTRAINT "patient_files_pkey" PRIMARY KEY ("file_id");



ALTER TABLE ONLY "public"."patients"
    ADD CONSTRAINT "patients_pkey" PRIMARY KEY ("patient_id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pharmacy_audit_log"
    ADD CONSTRAINT "pharmacy_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pharmacy_batches"
    ADD CONSTRAINT "pharmacy_batches_medicine_id_batch_number_expiry_date_suppl_key" UNIQUE ("medicine_id", "batch_number", "expiry_date", "supplier_id");



ALTER TABLE ONLY "public"."pharmacy_batches"
    ADD CONSTRAINT "pharmacy_batches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pharmacy_dispensing_items"
    ADD CONSTRAINT "pharmacy_dispensing_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pharmacy_dispensings"
    ADD CONSTRAINT "pharmacy_dispensings_dispensing_no_key" UNIQUE ("dispensing_no");



ALTER TABLE ONLY "public"."pharmacy_dispensings"
    ADD CONSTRAINT "pharmacy_dispensings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pharmacy_grn"
    ADD CONSTRAINT "pharmacy_grn_grn_number_key" UNIQUE ("grn_number");



ALTER TABLE ONLY "public"."pharmacy_grn_items"
    ADD CONSTRAINT "pharmacy_grn_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pharmacy_grn"
    ADD CONSTRAINT "pharmacy_grn_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pharmacy_invoice_items"
    ADD CONSTRAINT "pharmacy_invoice_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pharmacy_invoices"
    ADD CONSTRAINT "pharmacy_invoices_invoice_no_key" UNIQUE ("invoice_no");



ALTER TABLE ONLY "public"."pharmacy_invoices"
    ADD CONSTRAINT "pharmacy_invoices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pharmacy_manufacturers"
    ADD CONSTRAINT "pharmacy_manufacturers_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."pharmacy_manufacturers"
    ADD CONSTRAINT "pharmacy_manufacturers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pharmacy_medicines"
    ADD CONSTRAINT "pharmacy_medicines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pharmacy_medicines"
    ADD CONSTRAINT "pharmacy_medicines_sku_key" UNIQUE ("sku");



ALTER TABLE ONLY "public"."pharmacy_payments"
    ADD CONSTRAINT "pharmacy_payments_payment_reference_key" UNIQUE ("payment_reference");



ALTER TABLE ONLY "public"."pharmacy_payments"
    ADD CONSTRAINT "pharmacy_payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pharmacy_prescription_items"
    ADD CONSTRAINT "pharmacy_prescription_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pharmacy_prescriptions"
    ADD CONSTRAINT "pharmacy_prescriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pharmacy_prescriptions"
    ADD CONSTRAINT "pharmacy_prescriptions_visit_no_key" UNIQUE ("visit_no");



ALTER TABLE ONLY "public"."pharmacy_purchase_order_items"
    ADD CONSTRAINT "pharmacy_purchase_order_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pharmacy_purchase_orders"
    ADD CONSTRAINT "pharmacy_purchase_orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pharmacy_purchase_orders"
    ADD CONSTRAINT "pharmacy_purchase_orders_po_number_key" UNIQUE ("po_number");



ALTER TABLE ONLY "public"."pharmacy_sales_return_items"
    ADD CONSTRAINT "pharmacy_sales_return_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pharmacy_sales_returns"
    ADD CONSTRAINT "pharmacy_sales_returns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pharmacy_sales_returns"
    ADD CONSTRAINT "pharmacy_sales_returns_return_no_key" UNIQUE ("return_no");



ALTER TABLE ONLY "public"."pharmacy_settings"
    ADD CONSTRAINT "pharmacy_settings_pkey" PRIMARY KEY ("setting_key");



ALTER TABLE ONLY "public"."pharmacy_stock_adjustments"
    ADD CONSTRAINT "pharmacy_stock_adjustments_adjustment_no_key" UNIQUE ("adjustment_no");



ALTER TABLE ONLY "public"."pharmacy_stock_adjustments"
    ADD CONSTRAINT "pharmacy_stock_adjustments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pharmacy_stock_transactions"
    ADD CONSTRAINT "pharmacy_stock_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pharmacy_stock_transactions"
    ADD CONSTRAINT "pharmacy_stock_transactions_transaction_no_key" UNIQUE ("transaction_no");



ALTER TABLE ONLY "public"."pharmacy_supplier_return_items"
    ADD CONSTRAINT "pharmacy_supplier_return_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pharmacy_supplier_returns"
    ADD CONSTRAINT "pharmacy_supplier_returns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pharmacy_supplier_returns"
    ADD CONSTRAINT "pharmacy_supplier_returns_return_no_key" UNIQUE ("return_no");



ALTER TABLE ONLY "public"."pharmacy_suppliers"
    ADD CONSTRAINT "pharmacy_suppliers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pharmacy_suppliers"
    ADD CONSTRAINT "pharmacy_suppliers_supplier_code_key" UNIQUE ("supplier_code");



ALTER TABLE ONLY "public"."services"
    ADD CONSTRAINT "services_pkey" PRIMARY KEY ("service_id");



ALTER TABLE ONLY "public"."settings"
    ADD CONSTRAINT "settings_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."visit_prescriptions"
    ADD CONSTRAINT "visit_prescriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."visit_screenings"
    ADD CONSTRAINT "visit_screenings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."visits"
    ADD CONSTRAINT "visits_encounter_id_key" UNIQUE ("encounter_id");



ALTER TABLE ONLY "public"."visits"
    ADD CONSTRAINT "visits_pkey" PRIMARY KEY ("visit_no");



ALTER TABLE ONLY "public"."vitals"
    ADD CONSTRAINT "vitals_pkey" PRIMARY KEY ("vital_id");



CREATE INDEX "appointments_date_idx" ON "public"."appointments" USING "btree" ("appointment_date");



CREATE INDEX "appointments_patient_idx" ON "public"."appointments" USING "btree" ("patient_no");



CREATE INDEX "billing_items_status_idx" ON "public"."hims_billing_items" USING "btree" ("status");



CREATE INDEX "billing_items_visit_idx" ON "public"."hims_billing_items" USING "btree" ("visit_no");



CREATE INDEX "case_sheets_patient_idx" ON "public"."case_sheets" USING "btree" ("patient_no");



CREATE UNIQUE INDEX "case_sheets_visit_doctor_department_uq" ON "public"."case_sheets" USING "btree" ("visit_no", "doctor_id", "department");



CREATE INDEX "case_sheets_visit_idx" ON "public"."case_sheets" USING "btree" ("visit_no");



CREATE INDEX "notifications_recipient_created_idx" ON "public"."notifications" USING "btree" ("recipient_user_id", "created_at" DESC);



CREATE INDEX "patient_files_patient_idx" ON "public"."patient_files" USING "btree" ("patient_no");



CREATE INDEX "patient_files_visit_idx" ON "public"."patient_files" USING "btree" ("visit_no");



CREATE INDEX "patients_mobile_idx" ON "public"."patients" USING "btree" ("mobile");



CREATE INDEX "patients_name_idx" ON "public"."patients" USING "btree" ("lower"("name"));



CREATE INDEX "pharmacy_batches_fefo_idx" ON "public"."pharmacy_batches" USING "btree" ("medicine_id", "expiry_date", "quantity_available");



CREATE INDEX "pharmacy_batches_quarantine_idx" ON "public"."pharmacy_batches" USING "btree" ("status", "quantity_quarantined");



CREATE INDEX "pharmacy_grn_items_batch_idx" ON "public"."pharmacy_grn_items" USING "btree" ("medicine_id", "batch_number", "expiry_date");



CREATE INDEX "pharmacy_invoice_date_idx" ON "public"."pharmacy_invoices" USING "btree" ("invoice_date" DESC);



CREATE INDEX "pharmacy_invoice_patient_idx" ON "public"."pharmacy_invoices" USING "btree" ("patient_no", "invoice_date" DESC);



CREATE INDEX "pharmacy_medicines_brand_idx" ON "public"."pharmacy_medicines" USING "btree" ("lower"("brand_name"));



CREATE INDEX "pharmacy_medicines_generic_idx" ON "public"."pharmacy_medicines" USING "btree" ("lower"("generic_name"));



CREATE INDEX "pharmacy_prescriptions_patient_idx" ON "public"."pharmacy_prescriptions" USING "btree" ("patient_no", "created_at" DESC);



CREATE INDEX "pharmacy_rx_items_source_idx" ON "public"."pharmacy_prescription_items" USING "btree" ("source_visit_prescription_id");



CREATE INDEX "pharmacy_stock_txn_batch_idx" ON "public"."pharmacy_stock_transactions" USING "btree" ("batch_id", "created_at" DESC);



CREATE INDEX "pharmacy_stock_txn_medicine_idx" ON "public"."pharmacy_stock_transactions" USING "btree" ("medicine_id", "created_at" DESC);



CREATE UNIQUE INDEX "users_auth_user_id_uq" ON "public"."users" USING "btree" ("auth_user_id") WHERE ("auth_user_id" IS NOT NULL);



CREATE INDEX "visit_prescriptions_pharmacy_medicine_idx" ON "public"."visit_prescriptions" USING "btree" ("pharmacy_medicine_id");



CREATE INDEX "visit_prescriptions_visit_idx" ON "public"."visit_prescriptions" USING "btree" ("visit_no");



CREATE INDEX "visit_screenings_visit_idx" ON "public"."visit_screenings" USING "btree" ("visit_no");



CREATE INDEX "visits_appointment_idx" ON "public"."visits" USING "btree" ("appointment_no");



CREATE INDEX "visits_patient_idx" ON "public"."visits" USING "btree" ("patient_no");



CREATE INDEX "visits_status_idx" ON "public"."visits" USING "btree" ("status");



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("user_id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_patient_no_fkey" FOREIGN KEY ("patient_no") REFERENCES "public"."patients"("patient_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_revisions"
    ADD CONSTRAINT "case_revisions_case_sheet_id_fkey" FOREIGN KEY ("case_sheet_id") REFERENCES "public"."case_sheets"("case_sheet_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_sheets"
    ADD CONSTRAINT "case_sheets_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."case_sheets"
    ADD CONSTRAINT "case_sheets_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("user_id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."case_sheets"
    ADD CONSTRAINT "case_sheets_patient_no_fkey" FOREIGN KEY ("patient_no") REFERENCES "public"."patients"("patient_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_sheets"
    ADD CONSTRAINT "case_sheets_visit_no_fkey" FOREIGN KEY ("visit_no") REFERENCES "public"."visits"("visit_no") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."encounter_documents"
    ADD CONSTRAINT "encounter_documents_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "public"."visits"("encounter_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."encounter_documents"
    ADD CONSTRAINT "encounter_documents_patient_no_fkey" FOREIGN KEY ("patient_no") REFERENCES "public"."patients"("patient_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."hims_billing_items"
    ADD CONSTRAINT "hims_billing_items_case_sheet_id_fkey" FOREIGN KEY ("case_sheet_id") REFERENCES "public"."case_sheets"("case_sheet_id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."hims_billing_items"
    ADD CONSTRAINT "hims_billing_items_patient_no_fkey" FOREIGN KEY ("patient_no") REFERENCES "public"."patients"("patient_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."hims_billing_items"
    ADD CONSTRAINT "hims_billing_items_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "public"."users"("user_id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."hims_billing_items"
    ADD CONSTRAINT "hims_billing_items_visit_no_fkey" FOREIGN KEY ("visit_no") REFERENCES "public"."visits"("visit_no") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."hims_bills"
    ADD CONSTRAINT "hims_bills_patient_no_fkey" FOREIGN KEY ("patient_no") REFERENCES "public"."patients"("patient_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."patient_files"
    ADD CONSTRAINT "patient_files_patient_no_fkey" FOREIGN KEY ("patient_no") REFERENCES "public"."patients"("patient_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."patient_files"
    ADD CONSTRAINT "patient_files_visit_no_fkey" FOREIGN KEY ("visit_no") REFERENCES "public"."visits"("visit_no") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "public"."hims_bills"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_patient_no_fkey" FOREIGN KEY ("patient_no") REFERENCES "public"."patients"("patient_id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pharmacy_batches"
    ADD CONSTRAINT "pharmacy_batches_grn_id_fkey" FOREIGN KEY ("grn_id") REFERENCES "public"."pharmacy_grn"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pharmacy_batches"
    ADD CONSTRAINT "pharmacy_batches_medicine_id_fkey" FOREIGN KEY ("medicine_id") REFERENCES "public"."pharmacy_medicines"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."pharmacy_batches"
    ADD CONSTRAINT "pharmacy_batches_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."pharmacy_suppliers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pharmacy_dispensing_items"
    ADD CONSTRAINT "pharmacy_dispensing_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "public"."pharmacy_batches"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."pharmacy_dispensing_items"
    ADD CONSTRAINT "pharmacy_dispensing_items_dispensing_id_fkey" FOREIGN KEY ("dispensing_id") REFERENCES "public"."pharmacy_dispensings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pharmacy_dispensing_items"
    ADD CONSTRAINT "pharmacy_dispensing_items_medicine_id_fkey" FOREIGN KEY ("medicine_id") REFERENCES "public"."pharmacy_medicines"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."pharmacy_dispensing_items"
    ADD CONSTRAINT "pharmacy_dispensing_items_prescription_item_id_fkey" FOREIGN KEY ("prescription_item_id") REFERENCES "public"."pharmacy_prescription_items"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."pharmacy_dispensings"
    ADD CONSTRAINT "pharmacy_dispensings_patient_no_fkey" FOREIGN KEY ("patient_no") REFERENCES "public"."patients"("patient_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."pharmacy_dispensings"
    ADD CONSTRAINT "pharmacy_dispensings_pharmacy_prescription_id_fkey" FOREIGN KEY ("pharmacy_prescription_id") REFERENCES "public"."pharmacy_prescriptions"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."pharmacy_dispensings"
    ADD CONSTRAINT "pharmacy_dispensings_visit_no_fkey" FOREIGN KEY ("visit_no") REFERENCES "public"."visits"("visit_no") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."pharmacy_grn_items"
    ADD CONSTRAINT "pharmacy_grn_items_grn_id_fkey" FOREIGN KEY ("grn_id") REFERENCES "public"."pharmacy_grn"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pharmacy_grn_items"
    ADD CONSTRAINT "pharmacy_grn_items_medicine_id_fkey" FOREIGN KEY ("medicine_id") REFERENCES "public"."pharmacy_medicines"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."pharmacy_grn"
    ADD CONSTRAINT "pharmacy_grn_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."pharmacy_purchase_orders"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pharmacy_grn"
    ADD CONSTRAINT "pharmacy_grn_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."pharmacy_suppliers"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."pharmacy_invoice_items"
    ADD CONSTRAINT "pharmacy_invoice_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "public"."pharmacy_batches"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."pharmacy_invoice_items"
    ADD CONSTRAINT "pharmacy_invoice_items_dispensing_item_id_fkey" FOREIGN KEY ("dispensing_item_id") REFERENCES "public"."pharmacy_dispensing_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pharmacy_invoice_items"
    ADD CONSTRAINT "pharmacy_invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."pharmacy_invoices"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pharmacy_invoice_items"
    ADD CONSTRAINT "pharmacy_invoice_items_medicine_id_fkey" FOREIGN KEY ("medicine_id") REFERENCES "public"."pharmacy_medicines"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."pharmacy_invoices"
    ADD CONSTRAINT "pharmacy_invoices_patient_no_fkey" FOREIGN KEY ("patient_no") REFERENCES "public"."patients"("patient_id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pharmacy_invoices"
    ADD CONSTRAINT "pharmacy_invoices_pharmacy_prescription_id_fkey" FOREIGN KEY ("pharmacy_prescription_id") REFERENCES "public"."pharmacy_prescriptions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pharmacy_invoices"
    ADD CONSTRAINT "pharmacy_invoices_visit_no_fkey" FOREIGN KEY ("visit_no") REFERENCES "public"."visits"("visit_no") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pharmacy_medicines"
    ADD CONSTRAINT "pharmacy_medicines_manufacturer_id_fkey" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."pharmacy_manufacturers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pharmacy_payments"
    ADD CONSTRAINT "pharmacy_payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."pharmacy_invoices"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."pharmacy_prescription_items"
    ADD CONSTRAINT "pharmacy_prescription_items_medicine_id_fkey" FOREIGN KEY ("medicine_id") REFERENCES "public"."pharmacy_medicines"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pharmacy_prescription_items"
    ADD CONSTRAINT "pharmacy_prescription_items_pharmacy_prescription_id_fkey" FOREIGN KEY ("pharmacy_prescription_id") REFERENCES "public"."pharmacy_prescriptions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pharmacy_prescription_items"
    ADD CONSTRAINT "pharmacy_prescription_items_source_visit_prescription_id_fkey" FOREIGN KEY ("source_visit_prescription_id") REFERENCES "public"."visit_prescriptions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pharmacy_prescriptions"
    ADD CONSTRAINT "pharmacy_prescriptions_patient_no_fkey" FOREIGN KEY ("patient_no") REFERENCES "public"."patients"("patient_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."pharmacy_prescriptions"
    ADD CONSTRAINT "pharmacy_prescriptions_visit_no_fkey" FOREIGN KEY ("visit_no") REFERENCES "public"."visits"("visit_no") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."pharmacy_purchase_order_items"
    ADD CONSTRAINT "pharmacy_purchase_order_items_medicine_id_fkey" FOREIGN KEY ("medicine_id") REFERENCES "public"."pharmacy_medicines"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."pharmacy_purchase_order_items"
    ADD CONSTRAINT "pharmacy_purchase_order_items_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."pharmacy_purchase_orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pharmacy_purchase_orders"
    ADD CONSTRAINT "pharmacy_purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."pharmacy_suppliers"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."pharmacy_sales_return_items"
    ADD CONSTRAINT "pharmacy_sales_return_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "public"."pharmacy_batches"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."pharmacy_sales_return_items"
    ADD CONSTRAINT "pharmacy_sales_return_items_invoice_item_id_fkey" FOREIGN KEY ("invoice_item_id") REFERENCES "public"."pharmacy_invoice_items"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."pharmacy_sales_return_items"
    ADD CONSTRAINT "pharmacy_sales_return_items_medicine_id_fkey" FOREIGN KEY ("medicine_id") REFERENCES "public"."pharmacy_medicines"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."pharmacy_sales_return_items"
    ADD CONSTRAINT "pharmacy_sales_return_items_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "public"."pharmacy_sales_returns"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pharmacy_sales_returns"
    ADD CONSTRAINT "pharmacy_sales_returns_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."pharmacy_invoices"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."pharmacy_sales_returns"
    ADD CONSTRAINT "pharmacy_sales_returns_patient_no_fkey" FOREIGN KEY ("patient_no") REFERENCES "public"."patients"("patient_id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pharmacy_stock_adjustments"
    ADD CONSTRAINT "pharmacy_stock_adjustments_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "public"."pharmacy_batches"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."pharmacy_stock_adjustments"
    ADD CONSTRAINT "pharmacy_stock_adjustments_medicine_id_fkey" FOREIGN KEY ("medicine_id") REFERENCES "public"."pharmacy_medicines"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."pharmacy_stock_transactions"
    ADD CONSTRAINT "pharmacy_stock_transactions_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "public"."pharmacy_batches"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."pharmacy_stock_transactions"
    ADD CONSTRAINT "pharmacy_stock_transactions_medicine_id_fkey" FOREIGN KEY ("medicine_id") REFERENCES "public"."pharmacy_medicines"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."pharmacy_supplier_return_items"
    ADD CONSTRAINT "pharmacy_supplier_return_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "public"."pharmacy_batches"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."pharmacy_supplier_return_items"
    ADD CONSTRAINT "pharmacy_supplier_return_items_medicine_id_fkey" FOREIGN KEY ("medicine_id") REFERENCES "public"."pharmacy_medicines"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."pharmacy_supplier_return_items"
    ADD CONSTRAINT "pharmacy_supplier_return_items_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "public"."pharmacy_supplier_returns"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pharmacy_supplier_returns"
    ADD CONSTRAINT "pharmacy_supplier_returns_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."pharmacy_suppliers"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."visit_prescriptions"
    ADD CONSTRAINT "visit_prescriptions_patient_no_fkey" FOREIGN KEY ("patient_no") REFERENCES "public"."patients"("patient_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."visit_prescriptions"
    ADD CONSTRAINT "visit_prescriptions_pharmacy_medicine_id_fkey" FOREIGN KEY ("pharmacy_medicine_id") REFERENCES "public"."pharmacy_medicines"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."visit_prescriptions"
    ADD CONSTRAINT "visit_prescriptions_visit_no_fkey" FOREIGN KEY ("visit_no") REFERENCES "public"."visits"("visit_no") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."visit_screenings"
    ADD CONSTRAINT "visit_screenings_patient_no_fkey" FOREIGN KEY ("patient_no") REFERENCES "public"."patients"("patient_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."visit_screenings"
    ADD CONSTRAINT "visit_screenings_visit_no_fkey" FOREIGN KEY ("visit_no") REFERENCES "public"."visits"("visit_no") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."visits"
    ADD CONSTRAINT "visits_appointment_no_fkey" FOREIGN KEY ("appointment_no") REFERENCES "public"."appointments"("appointment_no") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."visits"
    ADD CONSTRAINT "visits_patient_no_fkey" FOREIGN KEY ("patient_no") REFERENCES "public"."patients"("patient_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."vitals"
    ADD CONSTRAINT "vitals_patient_no_fkey" FOREIGN KEY ("patient_no") REFERENCES "public"."patients"("patient_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."vitals"
    ADD CONSTRAINT "vitals_visit_no_fkey" FOREIGN KEY ("visit_no") REFERENCES "public"."visits"("visit_no") ON DELETE CASCADE;



ALTER TABLE "public"."appointments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."case_revisions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."case_sheet_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."case_sheets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."departments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."encounter_documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."hims_billing_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."hims_bills" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invoice_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invoices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."livya_opening_stock_staging" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."patient_files" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."patients" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pharmacy_audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pharmacy_batches" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pharmacy_dispensing_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pharmacy_dispensings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pharmacy_grn" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pharmacy_grn_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pharmacy_invoice_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pharmacy_invoices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pharmacy_manufacturers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pharmacy_medicines" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pharmacy_payments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pharmacy_prescription_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pharmacy_prescriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pharmacy_purchase_order_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pharmacy_purchase_orders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pharmacy_sales_return_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pharmacy_sales_returns" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pharmacy_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pharmacy_stock_adjustments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pharmacy_stock_transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pharmacy_supplier_return_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pharmacy_supplier_returns" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pharmacy_suppliers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."services" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."visit_prescriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."visit_screenings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."visits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vitals" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































GRANT ALL ON FUNCTION "public"."livya_next_bill_no"() TO "anon";
GRANT ALL ON FUNCTION "public"."livya_next_bill_no"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."livya_next_bill_no"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."pharmacy_approve_adjustment"("p_data" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."pharmacy_approve_adjustment"("p_data" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."pharmacy_create_sale"("p_data" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."pharmacy_create_sale"("p_data" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."pharmacy_next_number"("prefix" "text", "seq_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."pharmacy_next_number"("prefix" "text", "seq_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."pharmacy_post_grn"("p_data" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."pharmacy_post_grn"("p_data" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."pharmacy_post_sales_return"("p_data" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."pharmacy_post_sales_return"("p_data" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."pharmacy_post_supplier_return"("p_data" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."pharmacy_post_supplier_return"("p_data" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."pharmacy_record_payment"("p_data" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."pharmacy_record_payment"("p_data" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."pharmacy_request_adjustment"("p_data" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."pharmacy_request_adjustment"("p_data" "jsonb") TO "service_role";


















GRANT ALL ON SEQUENCE "public"."livya_appointment_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."livya_appointment_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."livya_appointment_seq" TO "service_role";



GRANT ALL ON TABLE "public"."appointments" TO "anon";
GRANT ALL ON TABLE "public"."appointments" TO "authenticated";
GRANT ALL ON TABLE "public"."appointments" TO "service_role";



GRANT ALL ON SEQUENCE "public"."appointments_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."appointments_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."appointments_seq" TO "service_role";



GRANT ALL ON TABLE "public"."audit_log" TO "anon";
GRANT ALL ON TABLE "public"."audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_log" TO "service_role";



GRANT ALL ON SEQUENCE "public"."auditlog_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."auditlog_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."auditlog_seq" TO "service_role";



GRANT ALL ON TABLE "public"."case_revisions" TO "anon";
GRANT ALL ON TABLE "public"."case_revisions" TO "authenticated";
GRANT ALL ON TABLE "public"."case_revisions" TO "service_role";



GRANT ALL ON TABLE "public"."case_sheet_templates" TO "anon";
GRANT ALL ON TABLE "public"."case_sheet_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."case_sheet_templates" TO "service_role";



GRANT ALL ON SEQUENCE "public"."livya_case_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."livya_case_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."livya_case_seq" TO "service_role";



GRANT ALL ON TABLE "public"."case_sheets" TO "anon";
GRANT ALL ON TABLE "public"."case_sheets" TO "authenticated";
GRANT ALL ON TABLE "public"."case_sheets" TO "service_role";



GRANT ALL ON SEQUENCE "public"."casesheets_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."casesheets_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."casesheets_seq" TO "service_role";



GRANT ALL ON TABLE "public"."departments" TO "anon";
GRANT ALL ON TABLE "public"."departments" TO "authenticated";
GRANT ALL ON TABLE "public"."departments" TO "service_role";



GRANT ALL ON TABLE "public"."encounter_documents" TO "anon";
GRANT ALL ON TABLE "public"."encounter_documents" TO "authenticated";
GRANT ALL ON TABLE "public"."encounter_documents" TO "service_role";



GRANT ALL ON TABLE "public"."hims_billing_items" TO "anon";
GRANT ALL ON TABLE "public"."hims_billing_items" TO "authenticated";
GRANT ALL ON TABLE "public"."hims_billing_items" TO "service_role";



GRANT ALL ON TABLE "public"."hims_bills" TO "anon";
GRANT ALL ON TABLE "public"."hims_bills" TO "authenticated";
GRANT ALL ON TABLE "public"."hims_bills" TO "service_role";



GRANT ALL ON SEQUENCE "public"."invoiceitems_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."invoiceitems_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."invoiceitems_seq" TO "service_role";



GRANT ALL ON TABLE "public"."invoice_items" TO "anon";
GRANT ALL ON TABLE "public"."invoice_items" TO "authenticated";
GRANT ALL ON TABLE "public"."invoice_items" TO "service_role";



GRANT ALL ON SEQUENCE "public"."invoices_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."invoices_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."invoices_seq" TO "service_role";



GRANT ALL ON TABLE "public"."invoices" TO "anon";
GRANT ALL ON TABLE "public"."invoices" TO "authenticated";
GRANT ALL ON TABLE "public"."invoices" TO "service_role";



GRANT ALL ON SEQUENCE "public"."livya_bill_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."livya_bill_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."livya_bill_seq" TO "service_role";



GRANT ALL ON TABLE "public"."livya_opening_stock_staging" TO "anon";
GRANT ALL ON TABLE "public"."livya_opening_stock_staging" TO "authenticated";
GRANT ALL ON TABLE "public"."livya_opening_stock_staging" TO "service_role";



GRANT ALL ON SEQUENCE "public"."livya_patient_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."livya_patient_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."livya_patient_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."livya_visit_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."livya_visit_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."livya_visit_seq" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."patient_files" TO "anon";
GRANT ALL ON TABLE "public"."patient_files" TO "authenticated";
GRANT ALL ON TABLE "public"."patient_files" TO "service_role";



GRANT ALL ON SEQUENCE "public"."patientfiles_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."patientfiles_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."patientfiles_seq" TO "service_role";



GRANT ALL ON TABLE "public"."patients" TO "anon";
GRANT ALL ON TABLE "public"."patients" TO "authenticated";
GRANT ALL ON TABLE "public"."patients" TO "service_role";



GRANT ALL ON SEQUENCE "public"."patients_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."patients_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."patients_seq" TO "service_role";



GRANT ALL ON TABLE "public"."payments" TO "anon";
GRANT ALL ON TABLE "public"."payments" TO "authenticated";
GRANT ALL ON TABLE "public"."payments" TO "service_role";



GRANT ALL ON SEQUENCE "public"."payments_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."payments_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."payments_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."pharmacy_adjustment_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."pharmacy_adjustment_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pharmacy_adjustment_seq" TO "service_role";



GRANT ALL ON TABLE "public"."pharmacy_audit_log" TO "anon";
GRANT ALL ON TABLE "public"."pharmacy_audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."pharmacy_audit_log" TO "service_role";



GRANT ALL ON TABLE "public"."pharmacy_batches" TO "anon";
GRANT ALL ON TABLE "public"."pharmacy_batches" TO "authenticated";
GRANT ALL ON TABLE "public"."pharmacy_batches" TO "service_role";



GRANT ALL ON TABLE "public"."pharmacy_dispensing_items" TO "anon";
GRANT ALL ON TABLE "public"."pharmacy_dispensing_items" TO "authenticated";
GRANT ALL ON TABLE "public"."pharmacy_dispensing_items" TO "service_role";



GRANT ALL ON SEQUENCE "public"."pharmacy_dispensing_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."pharmacy_dispensing_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pharmacy_dispensing_seq" TO "service_role";



GRANT ALL ON TABLE "public"."pharmacy_dispensings" TO "anon";
GRANT ALL ON TABLE "public"."pharmacy_dispensings" TO "authenticated";
GRANT ALL ON TABLE "public"."pharmacy_dispensings" TO "service_role";



GRANT ALL ON TABLE "public"."pharmacy_grn" TO "anon";
GRANT ALL ON TABLE "public"."pharmacy_grn" TO "authenticated";
GRANT ALL ON TABLE "public"."pharmacy_grn" TO "service_role";



GRANT ALL ON TABLE "public"."pharmacy_grn_items" TO "anon";
GRANT ALL ON TABLE "public"."pharmacy_grn_items" TO "authenticated";
GRANT ALL ON TABLE "public"."pharmacy_grn_items" TO "service_role";



GRANT ALL ON SEQUENCE "public"."pharmacy_grn_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."pharmacy_grn_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pharmacy_grn_seq" TO "service_role";



GRANT ALL ON TABLE "public"."pharmacy_invoice_items" TO "anon";
GRANT ALL ON TABLE "public"."pharmacy_invoice_items" TO "authenticated";
GRANT ALL ON TABLE "public"."pharmacy_invoice_items" TO "service_role";



GRANT ALL ON SEQUENCE "public"."pharmacy_invoice_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."pharmacy_invoice_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pharmacy_invoice_seq" TO "service_role";



GRANT ALL ON TABLE "public"."pharmacy_invoices" TO "anon";
GRANT ALL ON TABLE "public"."pharmacy_invoices" TO "authenticated";
GRANT ALL ON TABLE "public"."pharmacy_invoices" TO "service_role";



GRANT ALL ON TABLE "public"."pharmacy_manufacturers" TO "anon";
GRANT ALL ON TABLE "public"."pharmacy_manufacturers" TO "authenticated";
GRANT ALL ON TABLE "public"."pharmacy_manufacturers" TO "service_role";



GRANT ALL ON TABLE "public"."pharmacy_medicines" TO "anon";
GRANT ALL ON TABLE "public"."pharmacy_medicines" TO "authenticated";
GRANT ALL ON TABLE "public"."pharmacy_medicines" TO "service_role";



GRANT ALL ON SEQUENCE "public"."pharmacy_payment_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."pharmacy_payment_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pharmacy_payment_seq" TO "service_role";



GRANT ALL ON TABLE "public"."pharmacy_payments" TO "anon";
GRANT ALL ON TABLE "public"."pharmacy_payments" TO "authenticated";
GRANT ALL ON TABLE "public"."pharmacy_payments" TO "service_role";



GRANT ALL ON SEQUENCE "public"."pharmacy_po_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."pharmacy_po_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pharmacy_po_seq" TO "service_role";



GRANT ALL ON TABLE "public"."pharmacy_prescription_items" TO "anon";
GRANT ALL ON TABLE "public"."pharmacy_prescription_items" TO "authenticated";
GRANT ALL ON TABLE "public"."pharmacy_prescription_items" TO "service_role";



GRANT ALL ON TABLE "public"."pharmacy_prescriptions" TO "anon";
GRANT ALL ON TABLE "public"."pharmacy_prescriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."pharmacy_prescriptions" TO "service_role";



GRANT ALL ON TABLE "public"."pharmacy_purchase_order_items" TO "anon";
GRANT ALL ON TABLE "public"."pharmacy_purchase_order_items" TO "authenticated";
GRANT ALL ON TABLE "public"."pharmacy_purchase_order_items" TO "service_role";



GRANT ALL ON TABLE "public"."pharmacy_purchase_orders" TO "anon";
GRANT ALL ON TABLE "public"."pharmacy_purchase_orders" TO "authenticated";
GRANT ALL ON TABLE "public"."pharmacy_purchase_orders" TO "service_role";



GRANT ALL ON TABLE "public"."pharmacy_sales_return_items" TO "anon";
GRANT ALL ON TABLE "public"."pharmacy_sales_return_items" TO "authenticated";
GRANT ALL ON TABLE "public"."pharmacy_sales_return_items" TO "service_role";



GRANT ALL ON SEQUENCE "public"."pharmacy_sales_return_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."pharmacy_sales_return_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pharmacy_sales_return_seq" TO "service_role";



GRANT ALL ON TABLE "public"."pharmacy_sales_returns" TO "anon";
GRANT ALL ON TABLE "public"."pharmacy_sales_returns" TO "authenticated";
GRANT ALL ON TABLE "public"."pharmacy_sales_returns" TO "service_role";



GRANT ALL ON TABLE "public"."pharmacy_settings" TO "anon";
GRANT ALL ON TABLE "public"."pharmacy_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."pharmacy_settings" TO "service_role";



GRANT ALL ON TABLE "public"."pharmacy_stock_adjustments" TO "anon";
GRANT ALL ON TABLE "public"."pharmacy_stock_adjustments" TO "authenticated";
GRANT ALL ON TABLE "public"."pharmacy_stock_adjustments" TO "service_role";



GRANT ALL ON TABLE "public"."pharmacy_stock_transactions" TO "anon";
GRANT ALL ON TABLE "public"."pharmacy_stock_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."pharmacy_stock_transactions" TO "service_role";



GRANT ALL ON TABLE "public"."pharmacy_supplier_return_items" TO "anon";
GRANT ALL ON TABLE "public"."pharmacy_supplier_return_items" TO "authenticated";
GRANT ALL ON TABLE "public"."pharmacy_supplier_return_items" TO "service_role";



GRANT ALL ON SEQUENCE "public"."pharmacy_supplier_return_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."pharmacy_supplier_return_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pharmacy_supplier_return_seq" TO "service_role";



GRANT ALL ON TABLE "public"."pharmacy_supplier_returns" TO "anon";
GRANT ALL ON TABLE "public"."pharmacy_supplier_returns" TO "authenticated";
GRANT ALL ON TABLE "public"."pharmacy_supplier_returns" TO "service_role";



GRANT ALL ON TABLE "public"."pharmacy_suppliers" TO "anon";
GRANT ALL ON TABLE "public"."pharmacy_suppliers" TO "authenticated";
GRANT ALL ON TABLE "public"."pharmacy_suppliers" TO "service_role";



GRANT ALL ON SEQUENCE "public"."pharmacy_txn_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."pharmacy_txn_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pharmacy_txn_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."prescriptions_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."prescriptions_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."prescriptions_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."revisions_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."revisions_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."revisions_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."services_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."services_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."services_seq" TO "service_role";



GRANT ALL ON TABLE "public"."services" TO "anon";
GRANT ALL ON TABLE "public"."services" TO "authenticated";
GRANT ALL ON TABLE "public"."services" TO "service_role";



GRANT ALL ON TABLE "public"."settings" TO "anon";
GRANT ALL ON TABLE "public"."settings" TO "authenticated";
GRANT ALL ON TABLE "public"."settings" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



GRANT ALL ON SEQUENCE "public"."users_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."users_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."users_seq" TO "service_role";



GRANT ALL ON TABLE "public"."visit_prescriptions" TO "anon";
GRANT ALL ON TABLE "public"."visit_prescriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."visit_prescriptions" TO "service_role";



GRANT ALL ON TABLE "public"."visit_screenings" TO "anon";
GRANT ALL ON TABLE "public"."visit_screenings" TO "authenticated";
GRANT ALL ON TABLE "public"."visit_screenings" TO "service_role";



GRANT ALL ON TABLE "public"."visits" TO "anon";
GRANT ALL ON TABLE "public"."visits" TO "authenticated";
GRANT ALL ON TABLE "public"."visits" TO "service_role";



GRANT ALL ON SEQUENCE "public"."visits_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."visits_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."visits_seq" TO "service_role";



GRANT ALL ON TABLE "public"."vitals" TO "anon";
GRANT ALL ON TABLE "public"."vitals" TO "authenticated";
GRANT ALL ON TABLE "public"."vitals" TO "service_role";



GRANT ALL ON SEQUENCE "public"."vitals_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."vitals_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."vitals_seq" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































drop extension if exists "pg_net";


  create policy "HIMS admin can delete avatars"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
using (((bucket_id = 'avatars'::text) AND (lower((auth.jwt() ->> 'email'::text)) = 'gearsganesh@gmail.com'::text)));



  create policy "HIMS admin can read avatar metadata"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using (((bucket_id = 'avatars'::text) AND (lower((auth.jwt() ->> 'email'::text)) = 'gearsganesh@gmail.com'::text)));



  create policy "HIMS admin can update avatars"
  on "storage"."objects"
  as permissive
  for update
  to authenticated
using (((bucket_id = 'avatars'::text) AND (lower((auth.jwt() ->> 'email'::text)) = 'gearsganesh@gmail.com'::text)))
with check (((bucket_id = 'avatars'::text) AND (lower((auth.jwt() ->> 'email'::text)) = 'gearsganesh@gmail.com'::text)));



  create policy "HIMS admin can upload avatars"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'avatars'::text) AND (lower((auth.jwt() ->> 'email'::text)) = 'gearsganesh@gmail.com'::text)));



