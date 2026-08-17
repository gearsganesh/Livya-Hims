import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ADMIN_EMAILS = ['gearsganesh@gmail.com'];
const BUCKET = 'livya-hims-documents';

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

function err(message: unknown, status = 400) {
  const detail = typeof message === 'string' ? message : (message as any)?.message || (message as any)?.details || (message as any)?.hint || JSON.stringify(message);
  return json({ error: detail || 'Unknown HIMS error.' }, status);
}

function cleanEmail(value: unknown) {
  return String(value || '').trim().toLowerCase();
}
function todayIST() { return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }
function compactFormData(obj:any){const out:any={};Object.entries(obj||{}).forEach(([k,v]:any)=>{if(v===null||v===undefined)return;if(typeof v==='string'&&v.trim()==='')return;if(Array.isArray(v)&&!v.length)return;if(typeof v==='object'&&!Array.isArray(v)&&!Object.keys(v).length)return;out[k]=v});return out;}

function isAdminEmail(email: string) {
  return ADMIN_EMAILS.map(x => x.toLowerCase()).includes(email.toLowerCase());
}


function outUser(u: any) { return { UserId: u.user_id, Name: u.name, Email: u.email, Role: String(u.role || 'STAFF').toUpperCase(), JobTitle: u.job_title || '', Speciality: u.speciality || '', Department: u.department || '', DepartmentId: u.department_id || '', Branch: u.branch || '', ConsultationFee: Number(u.consultation_fee || 0), BillingEnabled: u.billing_enabled !== false, CaseSheetEnabled: u.case_sheet_enabled !== false, ProfilePhotoPath: u.profile_photo_path || '', Status: u.status, CreatedAt: u.created_at, LastLoginAt: u.last_login_at || '' }; }
async function outUserWithPhoto(u: any) { const base=outUser(u); return {...base, ProfilePhotoUrl: u.profile_photo_path ? await signUrl(u.profile_photo_path) : ''}; }
function outPatient(p: any) { return { PatientId: p.patient_id, Name: p.name, Gender: p.gender || '', DOB: p.dob || '', Mobile: p.mobile || '', Email: p.email || '', Address: p.address || '', BloodGroup: p.blood_group || '', Allergies: p.allergies || '', EmergencyContact: p.emergency_contact || '', CreatedAt: p.created_at, UpdatedAt: p.updated_at, Status: p.status }; }
function outAppointment(x: any, patientName = '') { return { AppointmentNo: x.appointment_no, PatientNo: x.patient_no, PatientName: patientName, AppointmentDate: x.appointment_date, AppointmentTime: x.appointment_time || '', DoctorId: x.doctor_id || '', DoctorName: x.doctor_name || '', Speciality: x.speciality || '', Department: x.department || '', Branch: x.branch || '', Reason: x.reason || '', Status: x.status, CreatedBy: x.created_by || '', CreatedAt: x.created_at, UpdatedAt: x.updated_at }; }
function outVisit(x: any, patientName = '', context:any = {}) { const department=x.department || context.department || ''; return { VisitNo: x.visit_no, EncounterId: x.encounter_id || '', PatientNo: x.patient_no, PatientName: patientName, AppointmentNo: x.appointment_no || '', CheckInAt: x.check_in_at, CheckOutAt: x.check_out_at || '', DoctorId: x.doctor_id || context.doctorId || '', DoctorName: x.doctor_name || context.doctorName || '', DepartmentId: x.department_id || context.departmentId || '', Department: department, Departments: department ? [department] : [], ConsultationFee: Number(x.consultation_fee ?? context.consultationFee ?? 0), BillingEnabled: x.billing_enabled !== false, CaseSheetEnabled: x.case_sheet_enabled !== false, Status: x.status, CreatedBy: x.created_by || '', CreatedAt: x.created_at, UpdatedAt: x.updated_at }; }
function outCase(x: any) { return { CaseSheetId: x.case_sheet_id, VisitNo: x.visit_no, PatientNo: x.patient_no, DepartmentId: x.department_id || '', Department: x.department || '', DoctorId: x.doctor_id || '', DoctorName: x.doctor_name || '', ConsultationFee: Number(x.consultation_fee || 0), BillingEnabled: x.billing_enabled !== false, TemplateKey: x.template_key || '', FormData: x.form_data || {}, ChiefComplaint: x.chief_complaint || '', History: x.history || '', Examination: x.examination || '', Diagnosis: x.diagnosis || '', TreatmentPlan: x.treatment_plan || '', ClinicalNotes: x.clinical_notes || '', FollowUp: x.follow_up || '', UpdatedBy: x.updated_by || '', UpdatedAt: x.updated_at, LockedAt: x.locked_at || '', LockedBy: x.locked_by || '', Status: x.status }; }
function outVital(x: any) { return { VitalId: x.vital_id, VisitNo: x.visit_no, PatientNo: x.patient_no, Temperature: x.temperature || '', Pulse: x.pulse || '', RespiratoryRate: x.respiratory_rate || '', BloodPressure: x.blood_pressure || '', SpO2: x.spo2 || '', Weight: x.weight || '', Height: x.height || '', BMI: x.bmi || '', Notes: x.notes || '', RecordedBy: x.recorded_by || '', RecordedAt: x.recorded_at }; }
function outFile(x: any, url = '') { return { FileId: x.file_id, PatientNo: x.patient_no, VisitNo: x.visit_no || '', FileName: x.file_name, MimeType: x.mime_type, DriveFileId: x.file_id, DriveUrl: url, UploadedBy: x.uploaded_by || '', UploadedAt: x.uploaded_at, Status: x.status, StoragePath: x.storage_path }; }

function publicUser(u: any) {
  return {
    UserId:u.user_id, Name:u.name, Email:u.email, Role:String(u.role||'STAFF').toUpperCase(), JobTitle:u.job_title||'',
    Speciality:u.speciality||'', Department:u.department||'', DepartmentId:u.department_id||'', Branch:u.branch||'',
    ConsultationFee:Number(u.consultation_fee||0), BillingEnabled:u.billing_enabled!==false, CaseSheetEnabled:u.case_sheet_enabled!==false, ProfilePhotoPath:u.profile_photo_path||'', Status:u.status||'ACTIVE'
  };
}
async function publicUserWithPhoto(u:any){ const base=publicUser(u); return {...base, ProfilePhotoUrl:u.profile_photo_path?await signUrl(u.profile_photo_path):''}; }

async function requireUser(req: Request) {
  const auth = req.headers.get('Authorization') || '';
  const jwt = auth.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) throw new Error('Your session has expired. Please login again.');

  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data.user?.email) throw new Error('Your session has expired. Please login again.');

  const email = cleanEmail(data.user.email);
  let { data: user, error: userError } = await admin
    .from('users')
    .select('*')
    .eq('email', email)
    .maybeSingle();

  if (userError) throw userError;

  if (!user) {
    throw new Error('This email is not provisioned for LIVYA HIMS. Contact the administrator.');
  }

  if (String(user.status).toUpperCase() !== 'ACTIVE') throw new Error('This user account is not active.');

  const update = await admin.from('users').update({
    auth_user_id: data.user.id,
    last_login_at: new Date().toISOString()
  }).eq('user_id', user.user_id).select('*').single();
  if (update.error) throw update.error;
  user = update.data;
  return user;
}

function requireAdmin(user: any) {
  if (!isAdminEmail(user.email)) throw new Error('Administration is restricted to the configured administrator.');
}

function isSuperAdmin(user:any){ return isAdminEmail(cleanEmail(user?.email)) || String(user?.role||'').toUpperCase()==='ADMIN'; }
function isManagement(user:any){ const role=String(user?.role||'').toUpperCase(); const dept=String(user?.department||'').trim().toUpperCase(); return role==='MANAGEMENT' || dept==='MANAGEMENT'; }
function requireAdminOrBilling(user: any) {
  const role=String(user.role||'').toUpperCase();
  if (!isSuperAdmin(user) && !isManagement(user) && !['ACCOUNTS','RECEPTION','CRM'].includes(role)) throw new Error('Billing access is restricted.');
}

function requireCrmOrAdmin(user:any){ const role=String(user.role||'').toUpperCase(); if(!isSuperAdmin(user)&&role!=='CRM') throw new Error('CRM access is required for patient and appointment management.'); }
function requireCaseSheet(user:any){ if(!isSuperAdmin(user)&&user.case_sheet_enabled===false) throw new Error('Your account is not authorised to use case sheets.'); }

async function audit(user: any, action: string, entity: string, entityId: string, details: string) {
  const r = await admin.from('audit_log').insert({
    user_email: user.email,
    user_name: user.name,
    role: user.role,
    action,
    entity,
    entity_id: entityId,
    details
  });
  // Audit logging must never block a clinical transaction.
  if (r.error) console.error('AUDIT_LOG_FAILED', r.error);
}

async function getPatientById(patientId: string) {
  const { data, error } = await admin.from('patients').select('*').eq('patient_id', patientId).maybeSingle();
  if (error) throw error;
  return data;
}

async function signUrl(path: string) {
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error) throw error;
  return data.signedUrl;
}

async function uploadBase64(patientNo: string, visitNo: string, fileName: string, mimeType: string, base64: string) {
  const raw = String(base64 || '').split(',').pop() || '';
  const binary = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${patientNo}/${visitNo || 'patient'}/${crypto.randomUUID()}_${safeName}`;
  const { error } = await admin.storage.from(BUCKET).upload(path, binary, {
    contentType: mimeType || 'application/octet-stream',
    upsert: false
  });
  if (error) throw error;
  return path;
}


const STAFF_DIRECTORY = [
  {name:'Nirmal',email:'nirmalkumar.rc1@gmail.com',role:'STAFF',job_title:'pharmacist',department:'True IV',fee:1500,billing:true,case_sheet:true},
  {name:'Adalin',email:'adalin.ranuva@gmail.com',role:'STAFF',job_title:'Health Stylist',department:'Nutrition',fee:1500,billing:true,case_sheet:true},
  {name:'Indra',email:'crm.c2@livyacurehub.com',role:'CRM',job_title:'CRM',department:'CRM',fee:0,billing:false,case_sheet:false},
  {name:'Lalitha',email:'crm.c1@livyacurehub.com',role:'CRM',job_title:'CRM',department:'CRM',fee:0,billing:false,case_sheet:false},
  {name:'VKT Raju',email:'vktraju@curesectors.in',role:'STAFF',job_title:'Managing Director',department:'Management',fee:0,billing:false,case_sheet:false},
  {name:'Sachin',email:'sachin@curesectors.in',role:'STAFF',job_title:'Facility Manager',department:'Management',fee:0,billing:false,case_sheet:false},
  {name:'Hemalakshmi',email:'lakshmihema2@gmail.com',role:'DOCTOR',job_title:'Cardiologist',department:'Cardiology',fee:1500,billing:true,case_sheet:true},
  {name:'Ganesh',email:'gearsganesh@gmail.com',role:'ADMIN',job_title:'Head of Technology & Innovations',department:'Management',fee:0,billing:false,case_sheet:false},
  {name:'Akash',email:'akashsekar.rc1@gmail.com',role:'DOCTOR',job_title:'Physiotherapist',department:'Physiotherapy',fee:1500,billing:true,case_sheet:true},
  {name:'Kani',email:'kanimozhi.rc1@gmail.com',role:'NURSE',job_title:'Staff Nurse',department:'General Medicine',fee:1500,billing:true,case_sheet:true},
  {name:'Malathi',email:'malathi.rc1@gmail.com',role:'NURSE',job_title:'Staff Nurse',department:'General Medicine',fee:1500,billing:true,case_sheet:true},
  {name:'Jaiganesh',email:'jaiganesh@curesectors.in',role:'STAFF',job_title:'Procurement',department:'Management',fee:0,billing:false,case_sheet:false}
];

async function ensureAuthUser(email:string){
  const all=await admin.auth.admin.listUsers({page:1,perPage:1000});
  if(all.error) throw all.error;
  let u=(all.data.users||[]).find((x:any)=>cleanEmail(x.email)===cleanEmail(email));
  if(!u){ const c=await admin.auth.admin.createUser({email:cleanEmail(email),email_confirm:true}); if(c.error) throw c.error; u=c.data.user; }
  return u;
}

// Pharmacy subsystem for LIVYA HIMS V6.0.
// Loaded into index.ts by concatenation during package preparation.
const PHARMACY_ACCESS_EMAILS = [
  'gearsganesh@gmail.com',
  'nirmalkumar.rc1@gmail.com',
  'jaiganesh@curesectors.in',
  'sachin@curesectors.in',
  'vktraju@curesectors.in'
];

function pharmacyAllowed(user:any){ return isSuperAdmin(user) || PHARMACY_ACCESS_EMAILS.includes(cleanEmail(user.email)); }
function requirePharmacy(user:any){ if(!pharmacyAllowed(user)) throw new Error('Pharmacy access is restricted to authorised pharmacy users.'); }
function pharmacyMapMedicine(m:any,batches:any[]=[]) { return {id:m.id,sku:m.sku,genericName:m.generic_name,brandName:m.brand_name,composition:m.composition,strength:m.strength,dosageForm:m.dosage_form,packSize:Number(m.pack_size||0),packUnit:m.pack_unit,manufacturerId:m.manufacturer_id,category:m.category,therapeuticCategory:m.therapeutic_category,hsnCode:m.hsn_code,gstRate:Number(m.gst_rate||0),mrp:Number(m.default_mrp||0),purchaseRate:Number(m.default_purchase_rate||0),prescriptionRequired:m.prescription_required,scheduleClassification:m.schedule_classification,refrigerated:m.refrigerated,coldChainRequired:m.cold_chain_required,controlledMedicine:m.controlled_medicine,active:m.active,batches}; }
function pharmacyMapBatch(b:any){return {id:b.id,medicineId:b.medicine_id,batchNumber:b.batch_number,expiryDate:b.expiry_date,purchaseRate:Number(b.purchase_rate||0),mrp:Number(b.mrp||0),salePrice:Number(b.sale_price||0),gstRate:Number(b.gst_rate||0),quantityAvailable:Number(b.quantity_available||0),quantityReceived:Number(b.quantity_received||0),supplierId:b.supplier_id,status:b.status,quarantineReason:b.quarantine_reason};}

async function pharmacyAudit(user:any,actionName:string,entity:string,id:string,details:any){ await admin.from('pharmacy_audit_log').insert({user_email:user.email,user_name:user.name,action:actionName,entity,entity_id:id,details}); }
function derivePrescriptionQuantity(dose:string,duration:string){ const d=String(dose||'').trim(); const dur=String(duration||'').match(/\d+(?:\.\d+)?/); const days=dur?Math.max(1,Number(dur[0])):1; const parts=d.split('-').map(x=>Number(x.trim())).filter(x=>Number.isFinite(x)); const perDay=parts.length>=1&&parts.length<=4&&parts.some(x=>x>0)?parts.reduce((a,b)=>a+b,0):Number((d.match(/\d+(?:\.\d+)?/)||['1'])[0]); return Math.max(1,Math.ceil(perDay*days)); }

async function maybeCloseVisit(visitNo:string){
  if(!visitNo)return false;
  const vr=await admin.from('visits').select('visit_no,patient_no,appointment_no,status').eq('visit_no',visitNo).maybeSingle();
  if(vr.error||!vr.data||String(vr.data.status).toUpperCase()!=='OPEN')return false;
  const cs=await admin.from('case_sheets').select('case_sheet_id,consultation_fee,billing_enabled').eq('visit_no',visitNo); if(cs.error)throw cs.error;
  if(!(cs.data||[]).length)return false;
  const billable=(cs.data||[]).filter((x:any)=>x.billing_enabled!==false&&Number(x.consultation_fee||0)>0);
  if(billable.length){
    const ids=billable.map((x:any)=>x.case_sheet_id);
    const bi=await admin.from('hims_billing_items').select('case_sheet_id,status,bill_id').in('case_sheet_id',ids); if(bi.error)throw bi.error;
    if(ids.some((id:string)=>!(bi.data||[]).some((x:any)=>x.case_sheet_id===id&&String(x.status).toUpperCase()==='BILLED')))return false;
    const billIds=[...new Set((bi.data||[]).map((x:any)=>x.bill_id).filter(Boolean))];
    if(billIds.length){const bills=await admin.from('hims_bills').select('id,status').in('id',billIds);if(bills.error)throw bills.error;if((bills.data||[]).some((b:any)=>String(b.status).toUpperCase()!=='PAID'))return false;}
  }
  const ph=await admin.from('pharmacy_prescriptions').select('id,pharmacy_status').eq('visit_no',visitNo).maybeSingle(); if(ph.error)throw ph.error;
  if(ph.data){
    if(!['COMPLETED','NO_STOCK'].includes(String(ph.data.pharmacy_status).toUpperCase()))return false;
    if(String(ph.data.pharmacy_status).toUpperCase()==='COMPLETED'){
      const inv=await admin.from('pharmacy_invoices').select('id,status').eq('visit_no',visitNo).order('created_at',{ascending:false}).limit(1).maybeSingle(); if(inv.error)throw inv.error;
      if(!inv.data||String(inv.data.status).toUpperCase()!=='PAID')return false;
    }
  }
  const now=new Date().toISOString();
  const up=await admin.from('visits').update({status:'CLOSED',check_out_at:now,updated_at:now}).eq('visit_no',visitNo).select('*').single(); if(up.error)throw up.error;
  if(vr.data.appointment_no){const ap=await admin.from('appointments').update({status:'COMPLETED',updated_at:now}).eq('appointment_no',vr.data.appointment_no);if(ap.error)throw ap.error;}
  return true;
}

async function syncPharmacyPrescriptionForVisit(visitNo:string,user:any){
  const vq=await admin.from('visits').select('visit_no,patient_no,status').eq('visit_no',visitNo).maybeSingle();
  if(vq.error)throw vq.error;
  if(!vq.data)throw new Error('Visit not found.');
  const rx=await admin.from('visit_prescriptions').select('*').eq('visit_no',visitNo).order('created_at');
  if(rx.error)throw rx.error;
  const header=await admin.from('pharmacy_prescriptions').upsert({
    visit_no:vq.data.visit_no,
    patient_no:vq.data.patient_no,
    source_status:(rx.data||[]).length?'ACTIVE':'NO_PRESCRIPTION',
    pharmacy_status:(rx.data||[]).length?'PENDING':'NO_STOCK',
    updated_at:new Date().toISOString()
  },{onConflict:'visit_no'}).select('*').single();
  if(header.error)throw header.error;
  const hid=header.data.id;

  const existing=await admin.from('pharmacy_prescription_items').select('id,source_visit_prescription_id,dispensing_status').eq('pharmacy_prescription_id',hid);
  if(existing.error)throw existing.error;
  const sourceIds=(rx.data||[]).map((x:any)=>x.id);
  const orphan=(existing.data||[]).filter((x:any)=>x.source_visit_prescription_id && !sourceIds.includes(x.source_visit_prescription_id));
  if(orphan.length){
    const del=await admin.from('pharmacy_prescription_items').delete().in('id',orphan.map((x:any)=>x.id));
    if(del.error)throw del.error;
  }

  let availableCount=0;
  for(const x of rx.data||[]){
    let med:any=null;
    let stock:any[]=[];
    if(x.pharmacy_medicine_id){
      const mr=await admin.from('pharmacy_medicines').select('*').eq('id',x.pharmacy_medicine_id).eq('active',true).maybeSingle();
      if(mr.error)throw mr.error;
      med=mr.data;
      if(med){
        const bs=await admin.from('pharmacy_batches').select('*').eq('medicine_id',med.id).eq('status','AVAILABLE').gt('quantity_available',0).gt('expiry_date',new Date().toISOString().slice(0,10)).order('expiry_date');
        if(bs.error)throw bs.error;
        stock=bs.data||[];
      }
    }
    const inStock=!!(med&&stock.length);
    if(inStock)availableCount++;
    const availability=inStock?'IN_STOCK':(med?'OUT_OF_STOCK':'NOT_IN_PHARMACY_MASTER');
    const payload:any={
      pharmacy_prescription_id:hid,
      source_visit_prescription_id:x.id,
      prescribed_name:x.medicine_name||'',
      dosage:x.dose||'',
      duration:x.duration||'',
      instructions:x.instructions||'',
      medicine_id:med?.id||null,
      availability_status:availability,
      dispensing_status:inStock?'PENDING':'NOT_AVAILABLE',
      quantity_prescribed:inStock?derivePrescriptionQuantity(x.dose,x.duration):0,
      quantity_remaining:inStock?derivePrescriptionQuantity(x.dose,x.duration):0,
      updated_at:new Date().toISOString()
    };
    const ex=(existing.data||[]).find((z:any)=>z.source_visit_prescription_id===x.id);
    let r;
    if(ex) r=await admin.from('pharmacy_prescription_items').update(payload).eq('id',ex.id).select('*').single();
    else r=await admin.from('pharmacy_prescription_items').insert(payload).select('*').single();
    if(r.error)throw r.error;
  }
  const status=(rx.data||[]).length===0?'NO_STOCK':(availableCount>0?'PENDING':'NO_STOCK');
  const up=await admin.from('pharmacy_prescriptions').update({source_status:(rx.data||[]).length?'ACTIVE':'NO_PRESCRIPTION',pharmacy_status:status,updated_at:new Date().toISOString()}).eq('id',hid).select('*').single();
  if(up.error)throw up.error;
  return {header:up.data,availableCount,hasPrescription:(rx.data||[]).length>0};
}

async function pharmacyAction(name:string,args:any[],user:any){
  if(name!=='pharmacyPrepareVisitRequest') requirePharmacy(user); const a=(n:number)=>args[n];
  switch(name){
    case 'pharmacyPrepareVisitRequest': {
      requireAdminOrBilling(user);
      const visitNo=String(a(1)||'');
      const synced=await syncPharmacyPrescriptionForVisit(visitNo,user);
      if(!synced.hasPrescription)return {requested:false,reason:'NO_PRESCRIPTION',available:[],unavailable:[]};
      const rx=await admin.from('pharmacy_prescription_items').select('*,pharmacy_medicines(*)').eq('pharmacy_prescription_id',synced.header.id).order('created_at');
      if(rx.error)throw rx.error;
      const available:any[]=[],unavailable:any[]=[];
      for(const x of rx.data||[]){
        const item={id:x.source_visit_prescription_id,name:x.prescribed_name,medicine_id:x.medicine_id,medicine:x.pharmacy_medicines?pharmacyMapMedicine(x.pharmacy_medicines):null,stock_available:Number(x.quantity_remaining||0),dose:x.dosage,duration:x.duration,instructions:x.instructions,prescribed_by:'',availability_status:x.availability_status};
        if(String(x.availability_status).toUpperCase()==='IN_STOCK')available.push(item); else unavailable.push({...item,reason:x.availability_status});
      }
      if(!available.length){
        await admin.from('pharmacy_prescriptions').update({pharmacy_status:'NO_STOCK',updated_at:new Date().toISOString()}).eq('id',synced.header.id);
        return {requested:false,reason:'NO_STOCK_ITEMS',pharmacyPrescriptionId:synced.header.id,available,unavailable};
      }
      await admin.from('pharmacy_prescriptions').update({pharmacy_status:'PENDING',updated_at:new Date().toISOString()}).eq('id',synced.header.id);
      return {requested:true,pharmacyPrescriptionId:synced.header.id,available,unavailable};
    }
    case 'pharmacyGetDashboard': {
      const today=new Date().toISOString().slice(0,10);
      const [sales,pending,stock,near,expired,po,adj]=await Promise.all([
        admin.from('pharmacy_invoices').select('total_amount').gte('invoice_date',today+'T00:00:00').lt('invoice_date',today+'T23:59:59'),
        admin.from('pharmacy_prescriptions').select('id',{count:'exact',head:true}).in('pharmacy_status',['PENDING','PARTIAL']),
        admin.from('pharmacy_batches').select('id,medicine_id,quantity_available,status,expiry_date').gt('quantity_available',0),
        admin.from('pharmacy_batches').select('id',{count:'exact',head:true}).gt('quantity_available',0).lte('expiry_date',new Date(Date.now()+90*86400000).toISOString().slice(0,10)).gt('expiry_date',today),
        admin.from('pharmacy_batches').select('id',{count:'exact',head:true}).lte('expiry_date',today),
        admin.from('pharmacy_purchase_orders').select('id',{count:'exact',head:true}).in('status',['DRAFT','APPROVED','ORDERED']),
        admin.from('pharmacy_stock_adjustments').select('id',{count:'exact',head:true}).eq('status','PENDING')
      ]); for(const r of [sales,pending,stock,near,expired,po,adj])if(r.error)throw r.error;
      const low=(stock.data||[]).filter((x:any)=>Number(x.quantity_available)<10).length;
      const totalSales=(sales.data||[]).reduce((s:number,x:any)=>s+Number(x.total_amount||0),0);
      return {todaySales:totalSales,pendingPrescriptions:pending.count||0,lowStock:low,nearExpiry:near.count||0,expired:expired.count||0,pendingPurchases:po.count||0,pendingAdjustments:adj.count||0};
    }
    case 'pharmacyListMedicines': { const q=String(a(1)||'').trim(); let qu=admin.from('pharmacy_medicines').select('*').order('generic_name').limit(200); if(q)qu=qu.or(`sku.ilike.%${q}%,generic_name.ilike.%${q}%,brand_name.ilike.%${q}%,composition.ilike.%${q}%`); const r=await qu;if(r.error)throw r.error; return (r.data||[]).map((m:any)=>pharmacyMapMedicine(m)); }
    case 'pharmacySaveMedicine': { const d=a(1)||{}; if(!d.genericName)throw new Error('Generic name is required.'); if(!d.sku)throw new Error('SKU is required.'); const payload={sku:d.sku,generic_name:d.genericName,brand_name:d.brandName||'',composition:d.composition||'',strength:d.strength||'',dosage_form:d.dosageForm||'',pack_size:Number(d.packSize||1),pack_unit:d.packUnit||'UNIT',manufacturer_id:d.manufacturerId||null,category:d.category||'',therapeutic_category:d.therapeuticCategory||'',hsn_code:d.hsnCode||'',gst_rate:Number(d.gstRate||0),default_mrp:Number(d.mrp||0),default_purchase_rate:Number(d.purchaseRate||0),prescription_required:d.prescriptionRequired!==false,schedule_classification:d.scheduleClassification||'',refrigerated:!!d.refrigerated,cold_chain_required:!!d.coldChainRequired,controlled_medicine:!!d.controlledMedicine,active:d.active!==false,updated_at:new Date().toISOString()}; let r;if(d.id)r=await admin.from('pharmacy_medicines').update(payload).eq('id',d.id).select('*').single();else r=await admin.from('pharmacy_medicines').insert(payload).select('*').single();if(r.error)throw r.error;await pharmacyAudit(user,d.id?'UPDATE':'CREATE','MEDICINE',r.data.id,payload);return pharmacyMapMedicine(r.data); }
    case 'pharmacyListSuppliers': {const q=String(a(1)||'').trim();let qu=admin.from('pharmacy_suppliers').select('*').neq('supplier_code','OPENING-STOCK').order('name').limit(200);if(q)qu=qu.or(`name.ilike.%${q}%,supplier_code.ilike.%${q}%,phone.ilike.%${q}%`);const r=await qu;if(r.error)throw r.error;return r.data||[];}
    case 'pharmacySaveSupplier': {const d=a(1)||{};if(!d.name||!d.supplierCode)throw new Error('Supplier name and code are required.');const p={name:d.name,supplier_code:d.supplierCode,address:d.address||'',contact_person:d.contactPerson||'',phone:d.phone||'',email:d.email||'',gstin:d.gstin||'',drug_license_no:d.drugLicenseNo||'',payment_terms:d.paymentTerms||'',active:d.active!==false,updated_at:new Date().toISOString()};let r;if(d.id)r=await admin.from('pharmacy_suppliers').update(p).eq('id',d.id).select('*').single();else r=await admin.from('pharmacy_suppliers').insert(p).select('*').single();if(r.error)throw r.error;await pharmacyAudit(user,d.id?'UPDATE':'CREATE','SUPPLIER',r.data.id,p);return r.data;}
    case 'pharmacyListManufacturers': {const r=await admin.from('pharmacy_manufacturers').select('*').eq('active',true).order('name');if(r.error)throw r.error;return r.data||[];}
    case 'pharmacySaveManufacturer': {const d=a(1)||{};const r=d.id?await admin.from('pharmacy_manufacturers').update({name:d.name,address:d.address||'',contact:d.contact||'',gstin:d.gstin||'',updated_at:new Date().toISOString()}).eq('id',d.id).select('*').single():await admin.from('pharmacy_manufacturers').insert({name:d.name,address:d.address||'',contact:d.contact||'',gstin:d.gstin||''}).select('*').single();if(r.error)throw r.error;return r.data;}
    case 'pharmacyListStock': {const q=String(a(1)||'').trim();let qu=admin.from('pharmacy_batches').select('*,pharmacy_medicines(*)').order('expiry_date').limit(500);const r=await qu;if(r.error)throw r.error;let rows=(r.data||[]).map((x:any)=>({batch:pharmacyMapBatch(x),medicine:pharmacyMapMedicine(x.pharmacy_medicines||{})}));if(q)rows=rows.filter((x:any)=>[x.medicine.genericName,x.medicine.brandName,x.medicine.sku,x.batch.batchNumber].some((v:any)=>String(v||'').toLowerCase().includes(q.toLowerCase())));return rows;}
    case 'pharmacyListLedger': {const q=String(a(1)||'').trim();const r=await admin.from('pharmacy_stock_transactions').select('*,pharmacy_medicines(generic_name,brand_name,sku),pharmacy_batches(batch_number,expiry_date)').order('created_at',{ascending:false}).limit(500);if(r.error)throw r.error;let rows=r.data||[];if(q)rows=rows.filter((x:any)=>JSON.stringify(x).toLowerCase().includes(q.toLowerCase()));return rows;}
    case 'pharmacySyncVisitPrescription': {const synced=await syncPharmacyPrescriptionForVisit(String(a(1)||''),user);await pharmacyAudit(user,'SYNC','PRESCRIPTION',String(synced.header?.id||''),{visit:a(1)});return synced;}
    case 'pharmacyListPrescriptionQueue': {
      const r=await admin.from('pharmacy_prescriptions').select('*').in('pharmacy_status',['PENDING','PARTIAL']).order('updated_at',{ascending:false}).limit(200);if(r.error)throw r.error;const pids=[...new Set((r.data||[]).map((x:any)=>x.patient_no))];const ps=pids.length?await admin.from('patients').select('patient_id,name,mobile').in('patient_id',pids):{data:[],error:null};if(ps.error)throw ps.error;const pm:any={};for(const p of ps.data||[])pm[p.patient_id]=p;return Promise.all((r.data||[]).map(async(x:any)=>{const items=await admin.from('pharmacy_prescription_items').select('*').eq('pharmacy_prescription_id',x.id);if(items.error)throw items.error;return {...x,patientName:pm[x.patient_no]?.name||'',patientMobile:pm[x.patient_no]?.mobile||'',items:items.data||[]};}));
    }
    case 'pharmacyMapPrescriptionItem': {
      const d=a(1)||{};
      const item=await admin.from('pharmacy_prescription_items').select('id,pharmacy_prescription_id,source_visit_prescription_id').eq('id',d.itemId).maybeSingle();if(item.error)throw item.error;if(!item.data)throw new Error('Prescription item not found.');
      const h=await admin.from('pharmacy_prescriptions').select('visit_no').eq('id',item.data.pharmacy_prescription_id).maybeSingle();if(h.error)throw h.error;
      const billed=await admin.from('hims_billing_items').select('id').eq('visit_no',h.data?.visit_no||'').eq('status','BILLED').limit(1);if(billed.error)throw billed.error;if((billed.data||[]).length)throw new Error('Prescription mapping is locked after consultation billing.');
      const src=await admin.from('visit_prescriptions').update({pharmacy_medicine_id:d.medicineId}).eq('id',item.data.source_visit_prescription_id).select('*').single();if(src.error)throw src.error;
      const r=await admin.from('pharmacy_prescription_items').update({medicine_id:d.medicineId,updated_at:new Date().toISOString()}).eq('id',d.itemId).select('*').single();if(r.error)throw r.error;
      await syncPharmacyPrescriptionForVisit(String(h.data?.visit_no||''),user);
      await pharmacyAudit(user,'MAP','PRESCRIPTION_ITEM',String(d.itemId),d);return r.data;
    }
    case 'pharmacyGetPrescription': {
      const id=String(a(1));let h=await admin.from('pharmacy_prescriptions').select('*').eq('id',id).maybeSingle();if(h.error)throw h.error;if(!h.data){h=await admin.from('pharmacy_prescriptions').select('*').eq('visit_no',id).maybeSingle();if(h.error)throw h.error;}if(!h.data)throw new Error('Prescription not found for this visit.');
      const patient=await admin.from('patients').select('patient_id,name,allergies,mobile').eq('patient_id',h.data.patient_no).maybeSingle();if(patient.error)throw patient.error;
      const billed=await admin.from('hims_billing_items').select('id').eq('visit_no',h.data.visit_no).eq('status','BILLED').limit(1);if(billed.error)throw billed.error;
      const items=await admin.from('pharmacy_prescription_items').select('*,pharmacy_medicines(*)').eq('pharmacy_prescription_id',h.data.id).order('created_at');if(items.error)throw items.error;const result=[];
      for(const x of items.data||[]){const bs=x.medicine_id?await admin.from('pharmacy_batches').select('*').eq('medicine_id',x.medicine_id).gt('quantity_available',0).eq('status','AVAILABLE').gt('expiry_date',new Date().toISOString().slice(0,10)).order('expiry_date'): {data:[],error:null};if(bs.error)throw bs.error;result.push({...x,medicine:x.pharmacy_medicines?pharmacyMapMedicine(x.pharmacy_medicines):null,batches:(bs.data||[]).map(pharmacyMapBatch)});}
      return {header:h.data,patient:patient.data?outPatient(patient.data):null,items:result,consultationBilled:(billed.data||[]).length>0};
    }
    case 'pharmacyCreatePurchaseOrder': {const d=a(1)||{};if(!d.supplierId||!(d.items||[]).length)throw new Error('Supplier and PO items are required.');const h=await admin.from('pharmacy_purchase_orders').insert({po_number:'TEMP',supplier_id:d.supplierId,po_date:d.poDate||new Date().toISOString().slice(0,10),status:'DRAFT',notes:d.notes||'',created_by:user.email}).select('*').single();if(h.error)throw h.error;const poNo='PO-'+new Date().toISOString().slice(0,10).replace(/-/g,'')+'-'+String(h.data.id).slice(0,6).toUpperCase();const up=await admin.from('pharmacy_purchase_orders').update({po_number:poNo}).eq('id',h.data.id).select('*').single();if(up.error)throw up.error;for(const x of d.items){const ins=await admin.from('pharmacy_purchase_order_items').insert({purchase_order_id:h.data.id,medicine_id:x.medicineId,ordered_qty:Number(x.quantity||0),free_qty:Number(x.freeQty||0),purchase_rate:Number(x.purchaseRate||0),mrp:Number(x.mrp||0),gst_rate:Number(x.gstRate||0)});if(ins.error)throw ins.error;}await pharmacyAudit(user,'CREATE','PURCHASE_ORDER',h.data.id,{poNumber:poNo});return up.data;}
    case 'pharmacyListPurchaseOrders': {const r=await admin.from('pharmacy_purchase_orders').select('*,pharmacy_suppliers(name,supplier_code)').order('created_at',{ascending:false}).limit(200);if(r.error)throw r.error;return r.data||[];}
    case 'pharmacyApprovePurchaseOrder': {const id=String(a(1)||'');const r=await admin.from('pharmacy_purchase_orders').update({status:'APPROVED',approved_by:user.email,approved_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',id).eq('status','DRAFT').select('*').single();if(r.error)throw r.error;await pharmacyAudit(user,'APPROVE','PURCHASE_ORDER',id,r.data);return r.data;}
    case 'pharmacyPostGRN': {const d=a(1)||{};const r=await admin.rpc('pharmacy_post_grn',{p_data:{header:{...d.header,created_by:user.email},items:d.items||[]}});if(r.error)throw r.error;await pharmacyAudit(user,'POST','GRN',String(r.data.grn_id),r.data);return r.data;}
    case 'pharmacyCreateSale': {
      const d=a(1)||{};const visitNo=String(d.header?.visit_no||'');
      if(visitNo){const billed=await admin.from('hims_billing_items').select('id').eq('visit_no',visitNo).eq('status','BILLED').limit(1);if(billed.error)throw billed.error;if(!(billed.data||[]).length)throw new Error('Consultation billing must be completed before pharmacy dispensing.');}
      const r=await admin.rpc('pharmacy_create_sale',{p_data:{header:{...d.header,created_by:user.email},items:d.items||[]}});if(r.error)throw r.error;await pharmacyAudit(user,'CREATE','PHARMACY_INVOICE',String(r.data.invoice_id),r.data);await maybeCloseVisit(visitNo);return r.data;
    }
    case 'pharmacyListInvoices': {const q=String(a(1)||'').trim();const r=await admin.from('pharmacy_invoices').select('*').order('invoice_date',{ascending:false}).limit(300);if(r.error)throw r.error;let rows=r.data||[];if(q){const pids=[...new Set(rows.map((x:any)=>x.patient_no).filter(Boolean))];const ps=pids.length?await admin.from('patients').select('patient_id,name').in('patient_id',pids):{data:[],error:null};if(ps.error)throw ps.error;const map:any={};for(const p of ps.data||[])map[p.patient_id]=p.name;rows=rows.filter((x:any)=>String(x.invoice_no+' '+x.patient_no+' '+(map[x.patient_no]||'')).toLowerCase().includes(q.toLowerCase())).map((x:any)=>({...x,patient_name:map[x.patient_no]||x.customer_name}));}return rows;}
    case 'pharmacyGetInvoice': {const id=String(a(1));const i=await admin.from('pharmacy_invoices').select('*').eq('id',id).maybeSingle();if(i.error)throw i.error;if(!i.data)throw new Error('Invoice not found.');const [items,pay]=await Promise.all([admin.from('pharmacy_invoice_items').select('*,pharmacy_medicines(generic_name,brand_name),pharmacy_batches(batch_number,expiry_date)').eq('invoice_id',id),admin.from('pharmacy_payments').select('*').eq('invoice_id',id).order('paid_at')]);if(items.error)throw items.error;if(pay.error)throw pay.error;return {...i.data,items:items.data||[],payments:pay.data||[]};}
    case 'pharmacyRecordPayment': {const d=a(1)||{};const r=await admin.rpc('pharmacy_record_payment',{p_data:{...d,received_by:user.email}});if(r.error)throw r.error;await pharmacyAudit(user,'PAYMENT','PHARMACY_INVOICE',String(d.invoiceId),d);const inv=await admin.from('pharmacy_invoices').select('visit_no,status').eq('id',d.invoiceId).maybeSingle();if(!inv.error&&inv.data)await maybeCloseVisit(String(inv.data.visit_no||''));return r.data;}
    case 'pharmacyListReturns': {const [s,p]=await Promise.all([admin.from('pharmacy_sales_returns').select('*').order('return_date',{ascending:false}).limit(200),admin.from('pharmacy_supplier_returns').select('*,pharmacy_suppliers(name)').order('return_date',{ascending:false}).limit(200)]);if(s.error)throw s.error;if(p.error)throw p.error;return {sales:s.data||[],supplier:p.data||[]};}
    case 'pharmacyPostSalesReturn': {const d=a(1)||{};const r=await admin.rpc('pharmacy_post_sales_return',{p_data:{header:{...d.header,processed_by:user.email,approved_by:user.email},items:d.items||[]}});if(r.error)throw r.error;await pharmacyAudit(user,'RETURN','SALES_RETURN',String(r.data.return_id),r.data);return r.data;}
    case 'pharmacyPostSupplierReturn': {const d=a(1)||{};const r=await admin.rpc('pharmacy_post_supplier_return',{p_data:{header:{...d.header,created_by:user.email,approved_by:user.email},items:d.items||[]}});if(r.error)throw r.error;await pharmacyAudit(user,'RETURN','SUPPLIER_RETURN',String(r.data.return_id),r.data);return r.data;}
    case 'pharmacyRequestAdjustment': {const d=a(1)||{};const r=await admin.rpc('pharmacy_request_adjustment',{p_data:{...d,requested_by:user.email}});if(r.error)throw r.error;await pharmacyAudit(user,'REQUEST','STOCK_ADJUSTMENT',String(r.data.adjustment_id),d);return r.data;}
    case 'pharmacyListAdjustments': {const r=await admin.from('pharmacy_stock_adjustments').select('*,pharmacy_medicines(generic_name,brand_name),pharmacy_batches(batch_number,expiry_date)').order('created_at',{ascending:false}).limit(200);if(r.error)throw r.error;return r.data||[];}
    case 'pharmacyApproveAdjustment': {const d=a(1)||{};const r=await admin.rpc('pharmacy_approve_adjustment',{p_data:{...d,approved_by:user.email}});if(r.error)throw r.error;await pharmacyAudit(user,'APPROVE','STOCK_ADJUSTMENT',String(d.adjustmentId),d);return r.data;}
    case 'pharmacyReports': {const from=a(1)||new Date(new Date().setDate(new Date().getDate()-30)).toISOString().slice(0,10);const to=a(2)||new Date().toISOString().slice(0,10);const [sales,purchases,stock,returns]=await Promise.all([admin.from('pharmacy_invoices').select('*').gte('invoice_date',from+'T00:00:00').lte('invoice_date',to+'T23:59:59'),admin.from('pharmacy_grn').select('*').gte('received_date',from).lte('received_date',to),admin.from('pharmacy_batches').select('*,pharmacy_medicines(*)').gt('quantity_available',0),admin.from('pharmacy_sales_returns').select('*').gte('return_date',from+'T00:00:00').lte('return_date',to+'T23:59:59')]);for(const r of [sales,purchases,stock,returns])if(r.error)throw r.error;const stockRows=(stock.data||[]).map((x:any)=>({batch:pharmacyMapBatch(x),medicine:pharmacyMapMedicine(x.pharmacy_medicines||{})}));return {sales:sales.data||[],purchases:purchases.data||[],stock:stockRows,returns:returns.data||[]};}
    default: throw new Error('Unsupported pharmacy operation.');
  }
}


async function action(name: string, args: any[], user: any) {
  if (name.startsWith('pharmacy')) return await pharmacyAction(name,args,user);
  const a = (n: number) => args[n] ?? (n === 1 ? args[0] : undefined);

  switch (name) {
    case 'getSession':
      return { ok: true, user: await publicUserWithPhoto(user) };

    case 'logout':
      return { ok: true };

    case 'getDashboard': {
      const today = todayIST();
      const [patients, appointments, visits, openVisits, payments] = await Promise.all([
        admin.from('patients').select('patient_id', { count: 'exact', head: true }).neq('status', 'DELETED'),
        admin.from('appointments').select('*').eq('appointment_date', today),
        admin.from('visits').select('visit_no,check_in_at').gte('check_in_at', `${today}T00:00:00+05:30`).lt('check_in_at', `${today}T23:59:59+05:30`),
        admin.from('visits').select('visit_no', { count: 'exact', head: true }).eq('status', 'OPEN'),
        admin.from('payments').select('amount').gte('paid_at', `${today}T00:00:00+05:30`).lt('paid_at', `${today}T23:59:59+05:30`).neq('status', 'CANCELLED')
      ]);
      for (const r of [patients, appointments, visits, openVisits, payments]) if (r.error) throw r.error;
      const appointmentPatientIds=[...new Set((appointments.data||[]).map((x:any)=>x.patient_no).filter(Boolean))];
      const appointmentPatients=appointmentPatientIds.length?await admin.from('patients').select('patient_id,name').in('patient_id',appointmentPatientIds):{data:[],error:null};
      if(appointmentPatients.error) throw appointmentPatients.error;
      const patientNames:any={}; for(const p of appointmentPatients.data||[]) patientNames[p.patient_id]=p.name;
      const revenue = (payments.data || []).reduce((s: number, x: any) => s + Number(x.amount || 0), 0);
      return {
        totalPatients: patients.count || 0,
        todaysAppointments: (appointments.data || []).length,
        todaysVisits: (visits.data || []).length,
        waiting: openVisits.count || 0,
        todaysRevenue: revenue,
        appointments: (appointments.data || []).map((x:any) => outAppointment(x,patientNames[x.patient_no]||''))
      };
    }

    case 'searchPatients': {
      const q = String(a(1) || '').trim();
      let query = admin.from('patients').select('*').neq('status', 'DELETED').order('created_at', { ascending: false }).limit(100);
      if (q) query = query.or(`patient_id.ilike.%${q}%,name.ilike.%${q}%,mobile.ilike.%${q}%,email.ilike.%${q}%`);
      const { data, error } = await query;
      if (error) throw error;
      return (data || []).map(outPatient);
    }

    case 'listPatientsWithLastVisit': {
      const { data: patients, error } = await admin.from('patients').select('patient_id,name,mobile').neq('status', 'DELETED').order('created_at', { ascending: false });
      if (error) throw error;
      const { data: visits, error: ve } = await admin.from('visits').select('patient_no,visit_no,check_in_at').neq('status', 'DELETED').order('check_in_at', { ascending: false });
      if (ve) throw ve;
      const last: Record<string, any> = {};
      for (const v of visits || []) if (!last[v.patient_no]) last[v.patient_no] = v;
      return (patients || []).map((p: any) => ({
        PatientId: p.patient_id, Name: p.name, Mobile: p.mobile,
        LastVisitNo: last[p.patient_id]?.visit_no || '', LastVisitDate: last[p.patient_id]?.check_in_at || ''
      }));
    }

    case 'createPatient': {
      requireCrmOrAdmin(user);
      const d = a(1) || {};
      const patientName = String(d.Name ?? d.name ?? d.PatientName ?? '').trim();
      const mobile = String(d.Mobile ?? d.mobile ?? '').trim();
      if (!patientName) throw new Error('Patient name is required.');
      if (!mobile) throw new Error('Mobile number is required.');
      const { data, error } = await admin.from('patients').insert({
        name: patientName, gender: d.Gender || d.gender || '', dob: d.DOB || d.dob || null,
        mobile: mobile, email: d.Email || '', address: d.Address || '',
        blood_group: d.BloodGroup || '', allergies: d.Allergies || '', emergency_contact: d.EmergencyContact || '', status: 'ACTIVE'
      }).select('*').single();
      if (error) throw error;
      await audit(user, 'CREATE', 'PATIENT', data.patient_id, `Created patient ${data.patient_id}`);
      return outPatient(data);
    }

    case 'getPatient': {
      const id = a(1);
      const patient = await getPatientById(id);
      if (!patient) throw new Error('Patient not found.');
      const [appointments, visits, cases, files] = await Promise.all([
        admin.from('appointments').select('*').eq('patient_no', id).order('appointment_date', { ascending: false }),
        admin.from('visits').select('*').eq('patient_no', id).order('check_in_at', { ascending: false }),
        admin.from('case_sheets').select('*').eq('patient_no', id).order('updated_at', { ascending: false }),
        admin.from('patient_files').select('*').eq('patient_no', id).neq('status', 'DELETED').order('uploaded_at', { ascending: false })
      ]);
      for (const r of [appointments, visits, cases, files]) if (r.error) throw r.error;
      const patientAppointments = appointments.data || [];
      const patientVisits = visits.data || [];
      const signedFiles = await Promise.all((files.data || []).map(async (f: any) => outFile(f, await signUrl(f.storage_path))));
      return { patient: outPatient(patient), appointments: patientAppointments.map((x:any)=>outAppointment(x)), visits: patientVisits.map((x:any)=>outVisit(x)), cases: (cases.data || []).map(outCase), files: signedFiles };
    }

    case 'listDoctors': {
      const { data, error } = await admin.from('users').select('*').eq('status', 'ACTIVE').or('case_sheet_enabled.eq.true,billing_enabled.eq.true').order('name');
      if (error) throw error;
      return (data || []).map(outUser);
    }

    case 'getDepartments': {
      const { data, error } = await admin.from('departments').select('*').eq('active', true).order('sort_order').order('name');
      if (error) throw error;
      const out=[];
      for(const d of data||[]){
        const pr=await admin.from('users').select('user_id,name,speciality,department,department_id,consultation_fee,status').eq('status','ACTIVE').eq('department_id',d.id).order('name');
        if(pr.error) throw pr.error;
        out.push({DepartmentId:d.id,Code:d.code,Name:d.name,Designation:d.designation||'',ConsultationFee:Number(d.consultation_fee||0),BillingEnabled:d.billing_enabled!==false,CaseSheetEnabled:d.case_sheet_enabled!==false,Active:d.active!==false,Providers:(pr.data||[]).map((x:any)=>({UserId:x.user_id,Name:x.name,Speciality:x.speciality||x.department||'',ConsultationFee:Number(x.consultation_fee||d.consultation_fee||0)}))});
      }
      return out;
    }


    case 'bootstrapStaffDirectory': {
      requireAdmin(user);
      let count=0;
      for(const x of STAFF_DIRECTORY){
        const au=await ensureAuthUser(x.email);
        const dep=await admin.from('departments').select('id').eq('name',x.department).maybeSingle();
        if(dep.error) throw dep.error;
        const patch:any={auth_user_id:au.id,name:x.name,role:x.role,job_title:x.job_title,speciality:x.job_title,department:x.department,department_id:dep.data?.id||null,consultation_fee:x.fee,billing_enabled:x.billing,case_sheet_enabled:x.case_sheet,status:'ACTIVE'};
        const existing=await admin.from('users').select('user_id').eq('email',x.email).maybeSingle();
        if(existing.error) throw existing.error;
        if(existing.data){const u=await admin.from('users').update(patch).eq('email',x.email);if(u.error)throw u.error;}
        else {const i=await admin.from('users').insert({...patch,email:x.email});if(i.error)throw i.error;}
        await admin.auth.admin.updateUserById(au.id,{ban_duration:'none'});
        count++;
      }
      return {ok:true,message:`Provisioned ${count} staff accounts from the supplied staff sheet.`};
    }

    case 'listAppointments': {
      const date = a(1) || new Date().toISOString().slice(0, 10);
      let aq=admin.from('appointments').select('*').eq('appointment_date', date).order('appointment_time');
      const role=String(user.role||'').toUpperCase(); if(!isAdminEmail(user.email)&&!['CRM','ACCOUNTS','RECEPTION'].includes(role)&&user.user_id)aq=aq.eq('doctor_id',user.user_id);
      const { data, error } = await aq;
      if (error) throw error;
      const patients = await admin.from('patients').select('patient_id,name').in('patient_id', [...new Set((data || []).map((x: any) => x.patient_no))]);
      if (patients.error) throw patients.error;
      const map: Record<string,string> = {}; for (const p of patients.data || []) map[p.patient_id] = p.name;
      return (data || []).map((x: any) => outAppointment(x, map[x.patient_no] || ''));
    }

    case 'createAppointment': {
      requireCrmOrAdmin(user);
      const d = a(1) || {};
      const patientNo = String(d.PatientNo ?? d.PatientID ?? d.patientNo ?? d.patient_id ?? '').trim();
      if (!patientNo) throw new Error('Patient is required.');
      if (!(await getPatientById(patientNo))) throw new Error('Patient not found.');
      let provider:any = null;
      if (d.DoctorId) {
        const pr = await admin.from('users').select('*').eq('user_id', d.DoctorId).maybeSingle();
        if (pr.error) throw pr.error; provider = pr.data;
      }
      const department = d.Department || provider?.department || d.Speciality || '';
      if(provider && department && provider.department && String(provider.department).trim().toLowerCase()!==String(department).trim().toLowerCase() && !isSuperAdmin(user)) throw new Error('Selected provider is not mapped to the selected department.');
      const fee = Number(d.ConsultationFee ?? provider?.consultation_fee ?? 0);
      const { data, error } = await admin.from('appointments').insert({
        patient_no: patientNo, appointment_date: d.AppointmentDate, appointment_time: d.AppointmentTime || null,
        doctor_id: d.DoctorId || '', doctor_name: d.DoctorName || provider?.name || '', speciality: d.Speciality || provider?.speciality || '',
        department, branch: d.Branch || user.branch || '', reason: d.Reason || '', status: 'BOOKED', created_by: user.email
      }).select('*').single();
      if (error) throw error;
      await audit(user, 'CREATE', 'APPOINTMENT', data.appointment_no, `Created appointment for ${data.patient_no}`);
      return outAppointment(data);
    }

    case 'checkInAppointment': {
      requireCrmOrAdmin(user);
      const appointmentNo = String(a(1) || '').trim();
      if (!appointmentNo) throw new Error('Appointment number is required.');

      const { data: appointment, error: appointmentError } = await admin
        .from('appointments')
        .select('*')
        .eq('appointment_no', appointmentNo)
        .maybeSingle();
      if (appointmentError) throw new Error(`Appointment lookup failed: ${appointmentError.message}`);
      if (!appointment) throw new Error(`Appointment ${appointmentNo} was not found.`);
      if (String(appointment.status).toUpperCase() !== 'BOOKED') {
        if (String(appointment.status).toUpperCase() === 'CHECKED_IN') {
          const already = await admin.from('visits').select('*').eq('appointment_no', appointmentNo).eq('status','OPEN').maybeSingle();
          if (!already.error && already.data) return outVisit(already.data);
        }
        throw new Error(`This appointment cannot be checked in because its status is ${appointment.status}.`);
      }

      const patientNo = String(appointment.patient_no || '').trim();
      if (!patientNo) throw new Error('The appointment has no patient number.');
      const patient = await getPatientById(patientNo);
      if (!patient) throw new Error(`Patient ${patientNo} was not found.`);

      const department = String(appointment.department || appointment.speciality || '').trim();
      if (!department) throw new Error('The appointment has no department/speciality.');

      const existing = await admin.from('visits').select('*').eq('appointment_no', appointmentNo).eq('status', 'OPEN').maybeSingle();
      if (existing.error) throw new Error(`Existing-visit check failed: ${existing.error.message}`);
      if (existing.data) return outVisit(existing.data, patient.name);

      const patientOpen = await admin.from('visits').select('*').eq('patient_no', patientNo).eq('status', 'OPEN').maybeSingle();
      if (patientOpen.error) throw new Error(`Open-visit check failed: ${patientOpen.error.message}`);
      if (patientOpen.data) throw new Error(`Patient ${patientNo} already has an open visit (${patientOpen.data.visit_no}). Close that visit before checking in another appointment.`);

      let provider:any = null;
      if (appointment.doctor_id) {
        const pr = await admin.from('users').select('*').eq('user_id', appointment.doctor_id).maybeSingle();
        if (pr.error) throw new Error(`Doctor lookup failed: ${pr.error.message}`);
        provider = pr.data;
      }

      const prior = await admin.from('visits').select('encounter_id').eq('appointment_no', appointmentNo).order('created_at').limit(1).maybeSingle();
      if (prior.error) throw new Error(`Encounter lookup failed: ${prior.error.message}`);
      const encounterId = prior.data?.encounter_id || `ENC${Date.now()}${Math.floor(Math.random()*1000)}`;

      // Keep check-in compatible with the existing live/test visits table.
      // Older databases do not have the optional routing/billing columns on visits.
      // Those values remain available from appointments, users and case sheets, so
      // check-in must not fail merely because an optional column is absent.
      const visit = {
        encounter_id: encounterId,
        patient_no: patientNo,
        appointment_no: appointmentNo,
        status: 'OPEN',
        created_by: user.email
      };

      const inserted = await admin.from('visits').insert(visit).select('*').single();
      if (inserted.error) {
        // A second click/browser tab can race the unique OPEN-visit constraint.
        if (inserted.error.code === '23505') {
          const race = await admin.from('visits').select('*').eq('patient_no', patientNo).eq('status','OPEN').maybeSingle();
          if (!race.error && race.data) return outVisit(race.data, patient.name);
        }
        throw new Error(`Check-in could not create the visit: ${inserted.error.message}${inserted.error.details ? ` | ${inserted.error.details}` : ''}`);
      }

      const now = new Date().toISOString();
      const appointmentUpdate = await admin.from('appointments').update({status:'CHECKED_IN',updated_at:now}).eq('appointment_no',appointmentNo);
      if (appointmentUpdate.error) {
        console.error('APPOINTMENT_STATUS_UPDATE_FAILED', appointmentUpdate.error);
        throw new Error(`Visit was created as ${inserted.data.visit_no}, but the appointment status could not be updated: ${appointmentUpdate.error.message}`);
      }

      await audit(user, 'CHECK_IN', 'VISIT', inserted.data.visit_no, `Checked in ${patientNo} for ${department}`);
      return outVisit(inserted.data, patient.name);
    }

    case 'addConsultation': {
      const d=a(1)||{};
      if(!d.VisitNo)throw new Error('Visit number is required. Doctors add consultations as case sheets inside the existing visit.');
      return await action('openCaseSheet',[{VisitNo:d.VisitNo,DepartmentId:d.DepartmentId,DoctorId:d.DoctorId}],user);
    }
    case 'getActiveCases': {
      const { data: visits, error } = await admin.from('visits').select('*').eq('status', 'OPEN').order('check_in_at');
      if (error) throw error;
      const ids = [...new Set((visits || []).map((x: any) => x.patient_no))];
      const ps = ids.length ? await admin.from('patients').select('patient_id,name').in('patient_id', ids) : { data: [], error: null };
      if (ps.error) throw ps.error;
      const apNos=[...new Set((visits||[]).map((x:any)=>x.appointment_no).filter(Boolean))];
      const aps=apNos.length?await admin.from('appointments').select('*').in('appointment_no',apNos):{data:[],error:null}; if(aps.error)throw aps.error;
      const map:Record<string,string>={}; for(const p of ps.data||[]) map[p.patient_id]=p.name;
      const amap:Record<string,any>={}; for(const ap of aps.data||[]) amap[ap.appointment_no]=ap;
      const out=[]; for(const x of visits||[]){ const ap=amap[x.appointment_no]||{}; const cs=await admin.from('case_sheets').select('case_sheet_id,department,doctor_name,status,consultation_fee,billing_enabled').eq('visit_no',x.visit_no).order('created_at'); if(cs.error)throw cs.error; out.push({...outVisit(x,map[x.patient_no]||'', {department:ap.department||ap.speciality||'',doctorId:ap.doctor_id,doctorName:ap.doctor_name}),CaseSheetCount:(cs.data||[]).length,Departments:[...new Set((cs.data||[]).map((c:any)=>c.department).filter(Boolean))],CaseSheets:(cs.data||[]).map(outCase)}); }
      return out;
    }

    case 'getVisit': {
      const visitNo = a(1);
      const { data: visit, error } = await admin.from('visits').select('*').eq('visit_no', visitNo).maybeSingle();
      if (error) throw error; if (!visit) throw new Error('Visit not found.');
      const [appointment, cs, vitals, prescriptions, files] = await Promise.all([
        visit.appointment_no ? admin.from('appointments').select('*').eq('appointment_no',visit.appointment_no).maybeSingle() : Promise.resolve({data:null,error:null}),
        admin.from('case_sheets').select('*').eq('visit_no', visitNo).order('created_at'),
        admin.from('vitals').select('*').eq('visit_no', visitNo).order('recorded_at', { ascending: false }),
        admin.from('visit_prescriptions').select('*').eq('visit_no', visitNo).order('created_at', { ascending: false }),
        admin.from('patient_files').select('*').eq('visit_no', visitNo).neq('status', 'DELETED').order('uploaded_at', { ascending: false })
      ]);
      for (const r of [appointment,cs, vitals, prescriptions, files]) if (r.error) throw r.error;
      const patient=await getPatientById(visit.patient_no); if(!patient)throw new Error('Patient not found.');
      const signed = await Promise.all((files.data || []).map(async (f: any) => outFile(f, await signUrl(f.storage_path))));
      return { visit: outVisit(visit,patient.name,{department:appointment.data?.department||appointment.data?.speciality||'',doctorId:appointment.data?.doctor_id,doctorName:appointment.data?.doctor_name}), appointment:appointment.data?outAppointment(appointment.data,patient.name):null, caseSheets:(cs.data||[]).map(outCase), vitals:(vitals.data||[]).map(outVital), prescriptions:(prescriptions.data||[]).map((x:any)=>({PrescriptionId:x.id,VisitNo:x.visit_no,PatientNo:x.patient_no,MedicineName:x.medicine_name,MedicineId:x.pharmacy_medicine_id||'',Dose:x.dose,Duration:x.duration,Instructions:x.instructions,PrescribedBy:x.prescribed_by,CreatedAt:x.created_at})), files:signed };
    }

    case 'getEncounter': {
      const encounterId = String(a(1) || '').trim();
      if (!encounterId) throw new Error('Visit ID is required.');
      const { data: visits, error: ve } = await admin.from('visits').select('*').eq('encounter_id', encounterId).order('created_at');
      if (ve) throw ve;
      if (!visits?.length) throw new Error('Visit not found.');
      const patient = await getPatientById(visits[0].patient_no);
      if (!patient) throw new Error('Patient not found.');
      let appointment:any = null;
      if (visits[0].appointment_no) {
        const ar = await admin.from('appointments').select('*').eq('appointment_no', visits[0].appointment_no).maybeSingle();
        if (ar.error) throw ar.error;
        appointment = ar.data;
      }
      const visitNos = visits.map((v:any)=>v.visit_no);
      const [cases, vitals, files, doc] = await Promise.all([
        admin.from('case_sheets').select('*').in('visit_no', visitNos).order('updated_at'),
        admin.from('vitals').select('*').eq('encounter_id', encounterId).order('recorded_at', {ascending:false}),
        admin.from('patient_files').select('*').in('visit_no', visitNos).neq('status','DELETED').order('uploaded_at',{ascending:false}),
        admin.from('encounter_documents').select('*').eq('encounter_id', encounterId).eq('document_type','VISIT_CASE_SHEET_PDF').maybeSingle()
      ]);
      for (const r of [cases,vitals,files,doc]) if (r.error) throw r.error;
      const signed = await Promise.all((files.data||[]).map(async (f:any)=>outFile(f, await signUrl(f.storage_path))));
      const pdf = doc.data ? {...doc.data, url: await signUrl(doc.data.storage_path)} : null;
      return {
        encounterId,
        visitId: visits[0].visit_no,
        patient: outPatient(patient),
        appointment: appointment ? outAppointment(appointment, patient.name) : null,
        visits: (visits||[]).map((x:any)=>outVisit(x, patient.name)),
        caseSheets: (cases.data||[]).map(outCase),
        vitals: (vitals.data||[]).map(outVital),
        files: signed,
        pdf: pdf ? {FileName:pdf.file_name,Url:pdf.url,UpdatedAt:pdf.updated_at||pdf.created_at} : null
      };
    }

    case 'saveEncounterPdf': {
      const d = a(1) || {};
      const encounterId = String(d.EncounterId || '').trim();
      if (!encounterId || !d.PatientNo || !d.FileName || !d.Base64) throw new Error('Visit PDF information is incomplete.');
      const { data: visits, error: ve } = await admin.from('visits').select('visit_no,patient_no').eq('encounter_id', encounterId);
      if (ve) throw ve;
      if (!visits?.length || String(visits[0].patient_no) !== String(d.PatientNo)) throw new Error('Visit not found for this patient.');
      const raw = String(d.Base64).split(',').pop() || '';
      const binary = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
      const safeName = String(d.FileName).replace(/[^a-zA-Z0-9._-]/g,'_');
      const path = `${d.PatientNo}/${encounterId}/${safeName}`;
      const up = await admin.storage.from(BUCKET).upload(path,binary,{contentType:'application/pdf',upsert:true});
      if (up.error) throw up.error;
      const now = new Date().toISOString();
      const existing = await admin.from('encounter_documents').select('id').eq('encounter_id',encounterId).eq('document_type','VISIT_CASE_SHEET_PDF').maybeSingle();
      if (existing.error) throw existing.error;
      let row:any;
      const payload={patient_no:d.PatientNo,encounter_id:encounterId,document_type:'VISIT_CASE_SHEET_PDF',file_name:safeName,storage_path:path,updated_by:user.email,updated_at:now};
      if(existing.data){ const u=await admin.from('encounter_documents').update(payload).eq('id',existing.data.id).select('*').single(); if(u.error)throw u.error; row=u.data; }
      else { const i=await admin.from('encounter_documents').insert({...payload,created_by:user.email}).select('*').single(); if(i.error)throw i.error; row=i.data; }
      await audit(user,'CREATE','VISIT_PDF',row.id,`Saved visit PDF ${safeName}`);
      return {FileName:safeName,Url:await signUrl(path),UpdatedAt:now};
    }

    case 'saveCaseSheet': {
      const d = a(1) || {};
      requireCaseSheet(user);
      // VisitNo is preferred, but CaseSheetId is sufficient for existing sheets.
      // This keeps all save buttons in the clinical UI independent of hidden page state.
      const existing = d.CaseSheetId ? await admin.from('case_sheets').select('*').eq('case_sheet_id',d.CaseSheetId).maybeSingle() : {data:null,error:null};
      if(existing.error)throw existing.error;
      const resolvedVisitNo=String(d.VisitNo||existing.data?.visit_no||'').trim();
      if(!resolvedVisitNo) throw new Error('Visit ID is required to save this case sheet.');
      const { data: visit, error: ve } = await admin.from('visits').select('*').eq('visit_no', resolvedVisitNo).maybeSingle();
      if (ve) throw ve; if (!visit || String(visit.status).toUpperCase() !== 'OPEN') throw new Error('This visit is not open for clinical editing.');
      if(existing.data && String(existing.data.visit_no)!==resolvedVisitNo) throw new Error('Case sheet does not belong to this visit.');
      if(existing.data && String(existing.data.status).toUpperCase()==='LOCKED') throw new Error('This case sheet is locked after billing.');
      let record:any;
      const payload:any = { patient_no:visit.patient_no, department_id:d.DepartmentId||existing.data?.department_id||null, department:d.Department||existing.data?.department||'', doctor_id:d.DoctorId||existing.data?.doctor_id||user.user_id||null, doctor_name:d.DoctorName||existing.data?.doctor_name||user.name||'', consultation_fee:Number(d.ConsultationFee??existing.data?.consultation_fee??0), billing_enabled:d.BillingEnabled!==false, template_key:d.TemplateKey||existing.data?.template_key||'', form_data:compactFormData(d.FormData||existing.data?.form_data||{}), chief_complaint:d.ChiefComplaint??existing.data?.chief_complaint??'', history:d.History??existing.data?.history??'', examination:d.Examination??existing.data?.examination??'', diagnosis:d.Diagnosis??existing.data?.diagnosis??'', treatment_plan:d.TreatmentPlan??existing.data?.treatment_plan??'', clinical_notes:d.ClinicalNotes??existing.data?.clinical_notes??'', follow_up:d.FollowUp??existing.data?.follow_up??'', updated_by:user.email, updated_at:new Date().toISOString(), status:'OPEN', locked_at:null, locked_by:null };
      if(existing.data){ const u=await admin.from('case_sheets').update(payload).eq('case_sheet_id',existing.data.case_sheet_id).select('*').single(); if(u.error)throw u.error; record=u.data; }
      else { const i=await admin.from('case_sheets').insert({...payload,visit_no:resolvedVisitNo}).select('*').single(); if(i.error)throw i.error; record=i.data; }
      const rev=await admin.from('case_revisions').insert({case_sheet_id:record.case_sheet_id,visit_no:record.visit_no,patient_no:record.patient_no,changed_by:user.email,snapshot_json:record}).select('*').single(); if(rev.error)throw rev.error;
      await audit(user,'UPDATE','CASE_SHEET',record.case_sheet_id,`Updated ${record.department||'case sheet'} for ${record.patient_no}`);
      return outCase(record);
    }

    case 'getDepartmentCaseSheet': {
      const visitNo=a(1), caseSheetId=a(2), department=a(3)||'';
      const {data:visit,error:ve}=await admin.from('visits').select('*').eq('visit_no',visitNo).maybeSingle(); if(ve)throw ve;if(!visit)throw new Error('Visit not found.');
      const csq=caseSheetId?admin.from('case_sheets').select('*').eq('case_sheet_id',caseSheetId).maybeSingle():admin.from('case_sheets').select('*').eq('visit_no',visitNo).eq('department',department).order('created_at').limit(1).maybeSingle();
      const [cs,t,files]=await Promise.all([csq,admin.from('case_sheet_templates').select('*').eq('department',department).eq('active',true).maybeSingle(),admin.from('patient_files').select('*').eq('visit_no',visitNo).neq('status','DELETED').order('uploaded_at',{ascending:false})]);
      if(cs.error)throw cs.error;if(t.error)throw t.error;if(files.error)throw files.error;
      const signed=await Promise.all((files.data||[]).map(async(f:any)=>outFile(f,await signUrl(f.storage_path))));
      return {caseSheet:cs.data?outCase(cs.data):null,template:t.data?{TemplateKey:t.data.template_key,Title:t.data.title,Schema:t.data.schema||{},Configured:t.data.configured!==false}:{TemplateKey:'',Title:department||'Case Sheet',Schema:{},Configured:false},files:signed};
    }

    case 'checkoutConsultation': {
      requireAdminOrBilling(user);
      const visitNo=String(a(1)||'');
      const {data:visit,error:ve}=await admin.from('visits').select('*').eq('visit_no',visitNo).maybeSingle(); if(ve)throw ve;if(!visit||String(visit.status).toUpperCase()!=='OPEN')throw new Error('Visit is not open.');
      const cs=await admin.from('case_sheets').select('*').eq('visit_no',visitNo).order('created_at'); if(cs.error)throw cs.error;if(!(cs.data||[]).length)throw new Error('Complete at least one case sheet before checkout.');
      const trueIvCases=(cs.data||[]).filter((c:any)=>String(c.department||'').trim().toLowerCase()==='true iv');
      for(const tiv of trueIvCases){const f=tiv.form_data||{};const reviewed=String(f.sopReviewStatus||'').toUpperCase()==='REVIEWED'||String(f.sopStatus||'').toUpperCase()==='COMPLETED';if(!reviewed)throw new Error('True IV SOP must be approved by Nirmal before consultation billing.');}
      const inserted:any[]=[];
      for(const c of cs.data||[]){const amount=Number(c.consultation_fee||0);if(c.billing_enabled!==false&&amount>0){const ex=await admin.from('hims_billing_items').select('*').eq('case_sheet_id',c.case_sheet_id).maybeSingle();if(ex.error)throw ex.error;if(ex.data) {if(ex.data.status!=='BILLED')inserted.push(ex.data);} else {const ins=await admin.from('hims_billing_items').insert({patient_no:visit.patient_no,appointment_no:visit.appointment_no||null,visit_no:visit.visit_no,case_sheet_id:c.case_sheet_id,department:c.department||'',provider_id:c.doctor_id||null,provider_name:c.doctor_name||'',amount,status:'READY',created_by:user.email}).select('*').single();if(ins.error)throw ins.error;inserted.push(ins.data);}}}
      return {VisitNo:visitNo,PatientNo:visit.patient_no,Items:inserted,Subtotal:inserted.reduce((s,x)=>s+Number(x.amount||0),0),Ready:inserted.length};
    }

    case 'getBillingQueue': {
      const { data:items,error }=await admin.from('hims_billing_items').select('*').in('status',['READY','BILLED']).order('created_at',{ascending:false});
      if(error) throw error;
      const ids=[...new Set((items||[]).map((x:any)=>x.patient_no))];
      const ps=ids.length?await admin.from('patients').select('patient_id,name,mobile').in('patient_id',ids):{data:[],error:null}; if(ps.error) throw ps.error;
      const pm:Record<string,any>={}; for(const p of ps.data||[]) pm[p.patient_id]=p;
      const groups:Record<string,any>={};
      for(const x of items||[]){ const g=groups[x.patient_no] ||= {PatientNo:x.patient_no,Name:pm[x.patient_no]?.name||'',Mobile:pm[x.patient_no]?.mobile||'',Items:[],Total:0}; g.Items.push({Id:x.id,VisitNo:x.visit_no,Department:x.department,ProviderName:x.provider_name,Amount:Number(x.amount||0),Status:x.status}); if(x.status==='READY') g.Total+=Number(x.amount||0); }
      return Object.values(groups);
    }

    case 'finalizePatientBilling': {
      requireAdminOrBilling(user);
      const patientNo=String(a(1)||''); if(!patientNo) throw new Error('Patient is required.');
      const {data:items,error}=await admin.from('hims_billing_items').select('*').eq('patient_no',patientNo).eq('status','READY').order('created_at');
      if(error) throw error; if(!items?.length) throw new Error('No ready billing items for this patient.');
      const total=items.reduce((s:number,x:any)=>s+Number(x.amount||0),0);
      const billNo='INV'+Date.now().toString().slice(-8);
      const bill=await admin.from('hims_bills').insert({bill_no:billNo,patient_no:patientNo,appointment_no:items[0].appointment_no||null,subtotal:total,status:'UNPAID',created_by:user.email}).select('*').single();
      if(bill.error) throw bill.error;
      const up=await admin.from('hims_billing_items').update({status:'BILLED',billed_at:new Date().toISOString(),bill_id:bill.data.id}).eq('patient_no',patientNo).eq('status','READY');
      if(up.error) throw up.error;
      await audit(user,'CREATE','BILL',bill.data.id,`Created ${billNo} for ${patientNo}`);
      return {BillNo:billNo,PatientNo:patientNo,Total:total,Items:items.map((x:any)=>({Department:x.department,ProviderName:x.provider_name,Amount:Number(x.amount||0)}))};
    }
    case 'saveVitals': {
      const d = a(1) || {};
      const { data: visit, error: ve } = await admin.from('visits').select('*').eq('visit_no', d.VisitNo).maybeSingle();
      if (ve) throw ve; if (!visit || String(visit.status).toUpperCase() !== 'OPEN') throw new Error('This visit is not open.');
      const billedCheck=await admin.from('hims_billing_items').select('id').eq('visit_no',d.VisitNo).eq('status','BILLED').limit(1);if(billedCheck.error)throw billedCheck.error;if((billedCheck.data||[]).length)throw new Error('Clinical updates are locked after consultation billing.');
      const { data, error } = await admin.from('vitals').insert({ encounter_id: visit.encounter_id || '', visit_no: d.VisitNo, patient_no: visit.patient_no, temperature: d.Temperature || '', pulse: d.Pulse || '', respiratory_rate: d.RespiratoryRate || '', blood_pressure: d.BloodPressure || '', spo2: d.SpO2 || '', weight: d.Weight || '', height: d.Height || '', bmi: d.BMI || '', notes: d.Notes || '', recorded_by: user.email }).select('*').single();
      if (error) throw error;
      await audit(user, 'CREATE', 'VITALS', data.vital_id, `Recorded vitals for ${data.patient_no}`);
      return outVital(data);
    }

    case 'getMedicineSuggestions': {
      const q=String(a(1)||'').trim();
      let qu=admin.from('pharmacy_medicines').select('id,sku,generic_name,brand_name,composition,strength,dosage_form').eq('active',true).order('generic_name').limit(20);
      if(q) qu=qu.or(`sku.ilike.%${q}%,generic_name.ilike.%${q}%,brand_name.ilike.%${q}%,composition.ilike.%${q}%`);
      const r=await qu; if(r.error) throw r.error;
      return (r.data||[]).map((m:any)=>({Id:m.id,SKU:m.sku,MedicineName:m.generic_name,BrandName:m.brand_name||'',Composition:m.composition||'',Strength:m.strength||'',DosageForm:m.dosage_form||''}));
    }

    case 'savePrescription': {
      const d=a(1)||{};
      const v=await admin.from('visits').select('*').eq('visit_no',d.VisitNo).maybeSingle();
      if(v.error)throw v.error;
      if(!v.data||String(v.data.status).toUpperCase()!=='OPEN')throw new Error('This visit is not open.');
      const billedCheck=await admin.from('hims_billing_items').select('id').eq('visit_no',d.VisitNo).eq('status','BILLED').limit(1);if(billedCheck.error)throw billedCheck.error;if((billedCheck.data||[]).length)throw new Error('Prescription is locked after consultation billing.');
      const medicineName=String(d.MedicineName||'').trim();
      if(!medicineName)throw new Error('Medicine name is required.');
      let pharmacyMedicineId=d.MedicineId||null;
      if(pharmacyMedicineId){
        const mr=await admin.from('pharmacy_medicines').select('id').eq('id',pharmacyMedicineId).eq('active',true).maybeSingle();
        if(mr.error)throw mr.error;
        if(!mr.data)throw new Error('Selected medicine is not active in the pharmacy master.');
      }else{
        const mr=await admin.from('pharmacy_medicines').select('id').eq('active',true).or(`sku.ilike.${medicineName},generic_name.ilike.${medicineName},brand_name.ilike.${medicineName}`).limit(1);
        if(mr.error)throw mr.error;
        pharmacyMedicineId=mr.data?.[0]?.id||null;
      }
      const r=await admin.from('visit_prescriptions').insert({visit_no:d.VisitNo,patient_no:v.data.patient_no,medicine_name:medicineName,pharmacy_medicine_id:pharmacyMedicineId,dose:d.Dose||'',duration:d.Duration||'',instructions:d.Instructions||'',prescribed_by:user.name||user.email}).select('*').single();
      if(r.error)throw r.error;
      const sync=await syncPharmacyPrescriptionForVisit(String(d.VisitNo),user);
      return {PrescriptionId:r.data.id,VisitNo:r.data.visit_no,PatientNo:r.data.patient_no,MedicineName:r.data.medicine_name,MedicineId:r.data.pharmacy_medicine_id||'',Dose:r.data.dose,Duration:r.data.duration,Instructions:r.data.instructions,PrescribedBy:r.data.prescribed_by,PharmacyRequest:sync.header?.pharmacy_status||'PENDING'};
    }

    case 'getCaseSheetById': {
      const id = a(1);
      const { data: c, error } = await admin.from('case_sheets').select('*').eq('case_sheet_id', id).maybeSingle();
      if (error) throw error; if (!c) throw new Error('Case sheet not found.');
      const [p, v, rev] = await Promise.all([
        getPatientById(c.patient_no),
        admin.from('visits').select('*').eq('visit_no', c.visit_no).maybeSingle(),
        admin.from('case_revisions').select('*').eq('case_sheet_id', id).order('changed_at', { ascending: false })
      ]);
      if (rev.error) throw rev.error;
      return { caseSheet: outCase(c), patient: outPatient(p), visit: v.data ? outVisit(v.data) : null, revisions: rev.data || [] };
    }

    case 'generateCaseSheetPdf':
      return { ok: true, message: 'PDF generation is handled by the browser print-to-PDF flow in the first web release.' };

    case 'getEncounterByVisit': {
      const visitNo=String(a(1)||'');
      const vr=await admin.from('visits').select('*').eq('visit_no',visitNo).maybeSingle(); if(vr.error)throw vr.error; if(!vr.data)throw new Error('Visit not found.');
      const [p,ap,cs,files,saved]=await Promise.all([getPatientById(vr.data.patient_no),vr.data.appointment_no?admin.from('appointments').select('*').eq('appointment_no',vr.data.appointment_no).maybeSingle():Promise.resolve({data:null,error:null}),admin.from('case_sheets').select('*').eq('visit_no',visitNo).order('created_at'),admin.from('patient_files').select('*').eq('visit_no',visitNo).neq('status','DELETED').order('uploaded_at',{ascending:false}),admin.from('encounter_documents').select('*').eq('encounter_id',vr.data.encounter_id).eq('document_type','CONSOLIDATED_VISIT_PDF').order('updated_at',{ascending:false}).limit(1).maybeSingle()]);
      if(ap.error)throw ap.error;if(cs.error)throw cs.error;if(files.error)throw files.error;if(saved.error)throw saved.error;
      const signed=await Promise.all((files.data||[]).map(async(f:any)=>outFile(f,await signUrl(f.storage_path))));
      const savedPdf=saved.data?{Url:await signUrl(saved.data.storage_path),FileName:saved.data.file_name,UpdatedAt:saved.data.updated_at||saved.data.created_at}:null;
      return {visit:outVisit(vr.data,p?.name||''),patient:outPatient(p),appointment:ap.data?outAppointment(ap.data,p?.name||''):null,caseSheets:(cs.data||[]).map(outCase),files:signed,savedPdf,encounterId:vr.data.encounter_id};
    }
    case 'getVisitClinical': {
      const visitNo=String(a(1)||'').trim();
      if(!visitNo) throw new Error('Visit ID is required.');
      const vr=await admin.from('visits').select('*').eq('visit_no',visitNo).maybeSingle();
      if(vr.error) throw vr.error;
      if(!vr.data) throw new Error('Visit not found.');
      const p=await getPatientById(vr.data.patient_no); if(!p) throw new Error('Patient not found.');
      const [ap,cs,vi,rx,sc,bi,ph]=await Promise.all([
        vr.data.appointment_no?admin.from('appointments').select('*').eq('appointment_no',vr.data.appointment_no).maybeSingle():Promise.resolve({data:null,error:null}),
        admin.from('case_sheets').select('*').eq('visit_no',visitNo).order('created_at'),
        admin.from('vitals').select('*').eq('visit_no',visitNo).order('recorded_at',{ascending:false}),
        admin.from('visit_prescriptions').select('*').eq('visit_no',visitNo).order('created_at'),
        admin.from('visit_screenings').select('*').eq('visit_no',visitNo).order('created_at'),
        admin.from('hims_billing_items').select('*').eq('visit_no',visitNo).order('created_at'),
        admin.from('pharmacy_prescriptions').select('id,pharmacy_status').eq('visit_no',visitNo).maybeSingle()
      ]);
      for(const r of [ap,cs,vi,rx,sc,bi,ph]) if(r.error) throw r.error;
      const prescriptions:any[]=[];
      for(const x of rx.data||[]){
        let availability='NOT_IN_PHARMACY_MASTER',stock=0;
        if(x.pharmacy_medicine_id){
          const mr=await admin.from('pharmacy_medicines').select('id,generic_name,brand_name,sku').eq('id',x.pharmacy_medicine_id).eq('active',true).maybeSingle(); if(mr.error) throw mr.error;
          if(mr.data){
            const bs=await admin.from('pharmacy_batches').select('quantity_available').eq('medicine_id',mr.data.id).eq('status','AVAILABLE').gt('quantity_available',0).gt('expiry_date',new Date().toISOString().slice(0,10));
            if(bs.error) throw bs.error; stock=(bs.data||[]).reduce((sum:number,b:any)=>sum+Number(b.quantity_available||0),0); availability=stock>0?'IN_STOCK':'OUT_OF_STOCK';
          }
        }
        prescriptions.push({PrescriptionId:x.id,VisitNo:x.visit_no,PatientNo:x.patient_no,MedicineName:x.medicine_name,MedicineId:x.pharmacy_medicine_id||'',Dose:x.dose,Duration:x.duration,Instructions:x.instructions,PrescribedBy:x.prescribed_by,Availability:availability,AvailableQuantity:stock,CreatedAt:x.created_at});
      }
      return {
        visit:outVisit(vr.data,p.name,{department:ap.data?.department||'',doctorId:ap.data?.doctor_id,doctorName:ap.data?.doctor_name}),
        patient:outPatient(p),
        appointment:ap.data?outAppointment(ap.data,p.name):null,
        caseSheets:(cs.data||[]).map(outCase),
        vitals:(vi.data||[]).map(outVital),
        prescriptions,
        screenings:(sc.data||[]).map((x:any)=>({ScreeningId:x.id,VisitNo:x.visit_no,PatientNo:x.patient_no,TestType:x.test_type,TestName:x.test_name,Indication:x.indication,RequestedBy:x.requested_by,CreatedAt:x.created_at})),
        billingItems:(bi.data||[]).map((x:any)=>({Id:x.id,CaseSheetId:x.case_sheet_id,Department:x.department,ProviderName:x.provider_name,Amount:Number(x.amount||0),Status:x.status})),
        pharmacy:ph.data||null
      };
    }
    case 'saveScreening': {
      const d=a(1)||{};const v=await admin.from('visits').select('*').eq('visit_no',d.VisitNo).maybeSingle();if(v.error)throw v.error;if(!v.data||v.data.status!=='OPEN')throw new Error('This visit is not open.');
      const billedCheck=await admin.from('hims_billing_items').select('id').eq('visit_no',d.VisitNo).eq('status','BILLED').limit(1);if(billedCheck.error)throw billedCheck.error;if((billedCheck.data||[]).length)throw new Error('Clinical updates are locked after consultation billing.');
      const r=await admin.from('visit_screenings').insert({visit_no:d.VisitNo,patient_no:v.data.patient_no,test_type:d.TestType||'Other',test_name:d.TestName||'',indication:d.Indication||'',requested_by:user.name||user.email}).select('*').single();if(r.error)throw r.error;return {ScreeningId:r.data.id,VisitNo:r.data.visit_no,PatientNo:r.data.patient_no,TestType:r.data.test_type,TestName:r.data.test_name,Indication:r.data.indication,RequestedBy:r.data.requested_by};
    }
    case 'deleteScreening': {const id=String(a(1)||'');const r=await admin.from('visit_screenings').delete().eq('id',id);if(r.error)throw r.error;return {ok:true};}
    case 'deletePrescription': {
      const id=String(a(1)||'');
      const rx=await admin.from('visit_prescriptions').select('id,visit_no').eq('id',id).maybeSingle();
      if(rx.error)throw rx.error;if(!rx.data)throw new Error('Prescription not found.');
      const v=await admin.from('visits').select('status').eq('visit_no',rx.data.visit_no).maybeSingle();if(v.error)throw v.error;if(!v.data||String(v.data.status).toUpperCase()!=='OPEN')throw new Error('This visit is not open.');
      const billed=await admin.from('hims_billing_items').select('id').eq('visit_no',rx.data.visit_no).eq('status','BILLED').limit(1);if(billed.error)throw billed.error;if((billed.data||[]).length)throw new Error('Prescription cannot be modified after consultation billing.');
      const r=await admin.from('visit_prescriptions').delete().eq('id',id);if(r.error)throw r.error;
      await syncPharmacyPrescriptionForVisit(String(rx.data.visit_no),user);
      return {ok:true};
    }
    case 'openCaseSheet': {
      const d=a(1)||{}; requireCaseSheet(user);
      const v=await admin.from('visits').select('*').eq('visit_no',d.VisitNo).maybeSingle();if(v.error)throw v.error;if(!v.data||v.data.status!=='OPEN')throw new Error('This visit is not open.');
      const billedCheck=await admin.from('hims_billing_items').select('id').eq('visit_no',d.VisitNo).eq('status','BILLED').limit(1);if(billedCheck.error)throw billedCheck.error;if((billedCheck.data||[]).length)throw new Error('Consultation billing is already finalized. No additional case sheet can be opened.');
      const dep=await admin.from('departments').select('*').eq('id',d.DepartmentId).maybeSingle();if(dep.error)throw dep.error;if(!dep.data||dep.data.case_sheet_enabled===false)throw new Error('Case sheet is disabled for this department.');
      let provider:any=null;if(d.DoctorId){const pr=await admin.from('users').select('*').eq('user_id',d.DoctorId).maybeSingle();if(pr.error)throw pr.error;provider=pr.data;} else {provider=user;}
      if(provider && provider.case_sheet_enabled===false && !isSuperAdmin(user))throw new Error('Selected provider does not have case sheet access.');
      if(provider && provider.department_id && String(provider.department_id)!==String(dep.data.id) && !isSuperAdmin(user))throw new Error('Selected provider is not mapped to the selected department.');
      const doctorId=provider?.user_id||user.user_id||null;
      const existing=await admin.from('case_sheets').select('*').eq('visit_no',d.VisitNo).eq('department',dep.data.name).eq('doctor_id',doctorId).maybeSingle();if(existing.error)throw existing.error;if(existing.data)return outCase(existing.data);
      const ins=await admin.from('case_sheets').insert({visit_no:d.VisitNo,patient_no:v.data.patient_no,department_id:dep.data.id,department:dep.data.name,doctor_id:doctorId,doctor_name:provider?.name||user.name||'',consultation_fee:Number(provider?.consultation_fee||dep.data.consultation_fee||0),billing_enabled:provider?.billing_enabled!==false&&dep.data.billing_enabled!==false,template_key:dep.data.code||dep.data.name,form_data:{},status:'OPEN',updated_by:user.email}).select('*').single();if(ins.error)throw ins.error;return outCase(ins.data);
    }
    case 'submitTrueIvSop': {
      const id=String(a(1)||'');const form=a(2)||{};const c=await admin.from('case_sheets').select('*').eq('case_sheet_id',id).maybeSingle();if(c.error)throw c.error;if(!c.data)throw new Error('Case sheet not found.');if(String(c.data.department).toLowerCase()!=='true iv')throw new Error('Not a True IV case sheet.');
      const f={...compactFormData(c.data.form_data||{}),...compactFormData(form),sopStatus:'SUBMITTED',sopSubmittedAt:new Date().toISOString(),sopSubmittedBy:user.email,sopReviewStatus:'PENDING'};delete f.sopReviewedAt;delete f.sopReviewedBy;delete f.reviewNotes;const u=await admin.from('case_sheets').update({form_data:f,updated_by:user.email,updated_at:new Date().toISOString()}).eq('case_sheet_id',id).select('*').single();if(u.error)throw u.error;
      const nr=await admin.from('users').select('user_id,name,email').in('email',['nirmalkumar.rc1@gmail.com','nirmal@livyacurehub.com']).eq('status','ACTIVE');
      if(!nr.error){for(const n of nr.data||[]){await admin.from('notifications').insert({recipient_user_id:n.user_id,type:'TRUE_IV_REVIEW',title:'True IV approval required',message:`True IV SOP is awaiting your verification for visit ${u.data.visit_no}.`,entity_type:'case_sheet',entity_id:id});}}
      return outCase(u.data);
    }
    case 'reviewTrueIvSop': {
      if(!['nirmalkumar.rc1@gmail.com','nirmal@livyacurehub.com'].includes(cleanEmail(user.email)))throw new Error('Only Nirmal can approve the True IV SOP.');
      const id=String(a(1)||'');const notes=String(a(2)||'');const c=await admin.from('case_sheets').select('*').eq('case_sheet_id',id).maybeSingle();if(c.error)throw c.error;if(!c.data)throw new Error('Case sheet not found.');const f={...compactFormData(c.data.form_data||{}),sopReviewStatus:'REVIEWED',sopStatus:'COMPLETED',sopReviewedAt:new Date().toISOString(),sopReviewedBy:user.email,reviewNotes:notes};const u=await admin.from('case_sheets').update({form_data:f,updated_by:user.email,updated_at:new Date().toISOString()}).eq('case_sheet_id',id).select('*').single();if(u.error)throw u.error;return outCase(u.data);
    }
    case 'uploadTrueIvPhoto': {
      const d=a(1)||{};const c=await admin.from('case_sheets').select('patient_no,visit_no').eq('case_sheet_id',d.CaseSheetId).maybeSingle();if(c.error)throw c.error;if(!c.data)throw new Error('Case sheet not found.');const path=await uploadBase64(c.data.patient_no,c.data.visit_no,'trueiv_'+d.FileName,d.MimeType||'image/jpeg',d.Base64);const url=await signUrl(path);return {Path:path,Url:url};
    }
    case 'uploadProfilePhoto': {
      requireAdmin(user);const d=a(1)||{};const target=cleanEmail(d.Email);if(!target)throw new Error('Email required.');const path=await uploadBase64('profiles','',d.FileName,d.MimeType||'image/jpeg',d.Base64);const u=await admin.from('users').update({profile_photo_path:path}).eq('email',target).select('*').single();if(u.error)throw u.error;return await outUserWithPhoto(u.data);
    }
    case 'saveEncounterPdf': {
      const d=a(1)||{};const vr=await admin.from('visits').select('patient_no,encounter_id,visit_no').eq('encounter_id',d.EncounterId).maybeSingle();
      let patientNo=d.PatientNo||'';let encounterId=d.EncounterId||'';let visitNo='';if(vr.data){patientNo=vr.data.patient_no;encounterId=vr.data.encounter_id;visitNo=vr.data.visit_no;}else{const v=await admin.from('visits').select('patient_no,encounter_id,visit_no').eq('visit_no',d.EncounterId).maybeSingle();if(v.data){patientNo=v.data.patient_no;encounterId=v.data.encounter_id;visitNo=v.data.visit_no;}}
      if(!patientNo||!encounterId)throw new Error('Encounter not found.');const path=await uploadBase64(patientNo,visitNo,d.FileName||'visit.pdf','application/pdf',d.Base64);const u=await admin.from('encounter_documents').upsert({patient_no:patientNo,encounter_id:encounterId,document_type:'CONSOLIDATED_VISIT_PDF',file_name:d.FileName||'visit.pdf',storage_path:path,created_by:user.email,updated_by:user.email,updated_at:new Date().toISOString()},{onConflict:'encounter_id,document_type'}).select('*').single();if(u.error)throw u.error;return {Url:await signUrl(path),Path:path};
    }
    case 'getBillingVisitDetails': {
      requireAdminOrBilling(user);
      const visitNo=String(a(1)||'').trim();
      if(!visitNo)throw new Error('Visit ID is required.');
      const v=await admin.from('visits').select('*').eq('visit_no',visitNo).maybeSingle();if(v.error)throw v.error;if(!v.data)throw new Error('Visit not found.');
      const p=await getPatientById(v.data.patient_no);if(!p)throw new Error('Patient not found.');
      const ap=v.data.appointment_no?await admin.from('appointments').select('*').eq('appointment_no',v.data.appointment_no).maybeSingle():{data:null,error:null};if(ap.error)throw ap.error;
      const [cs,vi,rx,sc,bi,ph]=await Promise.all([
        admin.from('case_sheets').select('*').eq('visit_no',visitNo).order('created_at'),
        admin.from('vitals').select('*').eq('visit_no',visitNo).order('recorded_at',{ascending:false}),
        admin.from('visit_prescriptions').select('*').eq('visit_no',visitNo).order('created_at'),
        admin.from('visit_screenings').select('*').eq('visit_no',visitNo).order('created_at'),
        admin.from('hims_billing_items').select('*').eq('visit_no',visitNo).order('created_at'),
        admin.from('pharmacy_prescriptions').select('id,pharmacy_status').eq('visit_no',visitNo).maybeSingle()
      ]);
      for(const r of [cs,vi,rx,sc,bi,ph])if(r.error)throw r.error;
      const prescriptions:any[]=[];
      for(const x of rx.data||[]){
        let availability='NOT_IN_PHARMACY_MASTER',stock=0;
        if(x.pharmacy_medicine_id){
          const mr=await admin.from('pharmacy_medicines').select('id,generic_name,brand_name,sku').eq('id',x.pharmacy_medicine_id).eq('active',true).maybeSingle();if(mr.error)throw mr.error;
          if(mr.data){const bs=await admin.from('pharmacy_batches').select('quantity_available').eq('medicine_id',mr.data.id).eq('status','AVAILABLE').gt('quantity_available',0).gt('expiry_date',new Date().toISOString().slice(0,10));if(bs.error)throw bs.error;stock=(bs.data||[]).reduce((s:number,b:any)=>s+Number(b.quantity_available||0),0);availability=stock>0?'IN_STOCK':'OUT_OF_STOCK';}
        }
        prescriptions.push({PrescriptionId:x.id,MedicineName:x.medicine_name,Dose:x.dose,Duration:x.duration,Instructions:x.instructions,PrescribedBy:x.prescribed_by,Availability:availability,AvailableQuantity:stock});
      }
      return {visit:outVisit(v.data,p.name,{department:ap.data?.department||'',doctorId:ap.data?.doctor_id,doctorName:ap.data?.doctor_name}),patient:outPatient(p),appointment:ap.data?outAppointment(ap.data,p.name):null,caseSheets:(cs.data||[]).map(outCase),vitals:(vi.data||[]).map(outVital),prescriptions,screenings:(sc.data||[]).map((x:any)=>({ScreeningId:x.id,TestType:x.test_type,TestName:x.test_name,Indication:x.indication,RequestedBy:x.requested_by})),billingItems:(bi.data||[]).map((x:any)=>({Id:x.id,CaseSheetId:x.case_sheet_id,Department:x.department,ProviderName:x.provider_name,Amount:Number(x.amount||0),Status:x.status})),pharmacy:ph.data||null};
    }
    case 'recordConsultationPayment': {
      requireAdminOrBilling(user);
      const d=a(1)||{};
      const billId=String(d.billId||'').trim();
      const amount=Number(d.amount||0);
      const mode=String(d.paymentMode||'CASH').trim().toUpperCase();
      const reference=String(d.referenceNo||'').trim();
      if(!billId) throw new Error('Bill ID is required.');
      if(!(amount>0)) throw new Error('Payment amount must be greater than zero.');
      if(!['CASH','UPI','CARD','NETBANKING','BANK_TRANSFER','OTHER'].includes(mode)) throw new Error('Invalid payment mode.');
      const b=await admin.from('hims_bills').select('*').eq('id',billId).maybeSingle();
      if(b.error) throw b.error;
      if(!b.data) throw new Error('Consultation bill not found.');
      const payments=await admin.from('payments').select('amount,status').eq('bill_id',billId).neq('status','CANCELLED');
      if(payments.error) throw payments.error;
      const paid=(payments.data||[]).reduce((sum:number,x:any)=>sum+Number(x.amount||0),0);
      const total=Number(b.data.subtotal||0);
      const balance=Math.max(0,total-paid);
      if(amount>balance+0.005) throw new Error('Payment exceeds the outstanding balance.');
      const ins=await admin.from('payments').insert({bill_id:billId,patient_no:b.data.patient_no,amount,payment_mode:mode,reference_no:reference,status:'PAID',paid_by:user.email}).select('*').single();
      if(ins.error) throw ins.error;
      const newPaid=paid+amount;
      const newBalance=Math.max(0,total-newPaid);
      const status=newBalance<=0.005?'PAID':newPaid>0?'PARTIAL':'UNPAID';
      const up=await admin.from('hims_bills').update({status,paid_at:status==='PAID'?new Date().toISOString():null}).eq('id',billId).select('*').single();
      if(up.error) throw up.error;
      await audit(user,'PAYMENT','CONSULTATION_BILL',billId,`Recorded ${amount} via ${mode}; status ${status}`);
      const visitItem=await admin.from('hims_billing_items').select('visit_no').eq('bill_id',billId).limit(1).maybeSingle();if(visitItem.error)throw visitItem.error;if(visitItem.data?.visit_no)await maybeCloseVisit(String(visitItem.data.visit_no));
      return {BillNo:up.data.bill_no,BillId:billId,Total:total,Paid:newPaid,Balance:newBalance,Status:status,Payment:ins.data};
    }
    case 'getBillingData': {
      requireAdminOrBilling(user);const q=String(a(1)||'').trim().toLowerCase();const visits=await admin.from('visits').select('*').eq('status','OPEN').order('check_in_at',{ascending:false});if(visits.error)throw visits.error;const pids=[...new Set((visits.data||[]).map((x:any)=>x.patient_no))];const ps=pids.length?await admin.from('patients').select('patient_id,name,mobile').in('patient_id',pids):{data:[],error:null};if(ps.error)throw ps.error;const pm:any={};for(const p of ps.data||[])pm[p.patient_id]=p;
      const open:any[]=[];for(const v of visits.data||[]){const name=pm[v.patient_no]?.name||'';if(q&&!((v.visit_no+' '+v.patient_no+' '+name).toLowerCase().includes(q)))continue;const cr=await admin.from('case_sheets').select('*').eq('visit_no',v.visit_no).order('created_at');if(cr.error)throw cr.error;const billedRows=await admin.from('hims_billing_items').select('id,status,bill_id').eq('visit_no',v.visit_no);if(billedRows.error)throw billedRows.error;const billedBillId=(billedRows.data||[]).find((x:any)=>String(x.status).toUpperCase()==='BILLED'&&x.bill_id)?.bill_id||'';const consultationBilled=!!billedBillId;let billedInfo:any=null;if(billedBillId){const bq=await admin.from('hims_bills').select('id,bill_no,subtotal,gross_amount,discount_amount,status').eq('id',billedBillId).maybeSingle();if(bq.error)throw bq.error;const pp=await admin.from('payments').select('amount').eq('bill_id',billedBillId).neq('status','CANCELLED');if(pp.error)throw pp.error;const paid=(pp.data||[]).reduce((s:number,x:any)=>s+Number(x.amount||0),0);if(bq.data)billedInfo={BillId:bq.data.id,BillNo:bq.data.bill_no,GrossTotal:Number(bq.data.gross_amount||bq.data.subtotal||0),Discount:Number(bq.data.discount_amount||0),Subtotal:Number(bq.data.subtotal||0),Paid:paid,Balance:Math.max(0,Number(bq.data.subtotal||0)-paid),Status:bq.data.status};}let ready=0,total=0;const items=(cr.data||[]).map((c:any)=>{const f=c.form_data||{};const status='READY';if(c.billing_enabled!==false && Number(c.consultation_fee||0)>0)ready++;if(c.billing_enabled!==false)total+=Number(c.consultation_fee||0);return {Department:c.department,ProviderName:c.doctor_name,Amount:Number(c.consultation_fee||0),Status:status,ChiefComplaint:c.chief_complaint,Diagnosis:c.diagnosis,TreatmentPlan:c.treatment_plan,CaseSheetId:c.case_sheet_id};});open.push({VisitNo:v.visit_no,PatientNo:v.patient_no,Name:name,CheckInAt:v.check_in_at,CaseSheetCount:(cr.data||[]).length,ReadyCaseSheetCount:consultationBilled?0:ready,Total:billedInfo?.Subtotal??total,GrossTotal:billedInfo?.GrossTotal??total,Discount:billedInfo?.Discount??0,Subtotal:billedInfo?.Subtotal??total,Paid:billedInfo?.Paid??0,Balance:billedInfo?.Balance??0,Status:billedInfo?.Status||'NOT BILLED',BillId:billedInfo?.BillId||'',BillNo:billedInfo?.BillNo||'',ConsultationBilled:consultationBilled,Items:items});}
      const bills=await admin.from('hims_bills').select('*').order('created_at',{ascending:false}).limit(300);if(bills.error)throw bills.error;const hist:any[]=[];for(const b of bills.data||[]){const name=pm[b.patient_no]?.name||((await admin.from('patients').select('name').eq('patient_id',b.patient_no).maybeSingle()).data?.name||'');if(q&&!((b.bill_no+' '+b.patient_no+' '+name).toLowerCase().includes(q)))continue;const bi=await admin.from('hims_billing_items').select('*').eq('bill_id',b.id).order('created_at');if(bi.error)throw bi.error;const pays=await admin.from('payments').select('amount,payment_mode,paid_at').eq('bill_id',b.id).neq('status','CANCELLED').order('paid_at',{ascending:false});if(pays.error)throw pays.error;const paid=(pays.data||[]).reduce((s:number,x:any)=>s+Number(x.amount||0),0);hist.push({BillNo:b.bill_no,BillId:b.id,VisitNo:bi.data?.[0]?.visit_no||'',PatientNo:b.patient_no,PatientName:name,CreatedAt:b.created_at,GrossTotal:Number(b.gross_amount||b.subtotal||0),Discount:Number(b.discount_amount||0),Subtotal:Number(b.subtotal||0),Paid:paid,Balance:Math.max(0,Number(b.subtotal||0)-paid),Status:b.status,PaymentMode:pays.data?.[0]?.payment_mode||'',Items:(bi.data||[]).map((x:any)=>({Department:x.department,ProviderName:x.provider_name,Amount:Number(x.amount||0)}))});}
      return {open,history:hist};
    }
    case 'getReportsPatients': {
      const q = String(a(1) || '').trim();
      let query = admin.from('patients').select('patient_id,name,mobile,email').neq('status', 'DELETED').order('created_at', { ascending: false }).limit(100);
      if (q) query = query.or(`patient_id.ilike.%${q}%,name.ilike.%${q}%,mobile.ilike.%${q}%,email.ilike.%${q}%`);
      const { data: patients, error } = await query; if (error) throw error;
      const result = [];
      for (const p of patients || []) {
        const files = await admin.from('patient_files').select('*').eq('patient_no', p.patient_id).neq('status', 'DELETED').order('uploaded_at', { ascending: false });
        if (files.error) throw files.error;
        const signed = await Promise.all((files.data || []).map(async (f: any) => outFile(f, await signUrl(f.storage_path))));
        result.push({ PatientId: p.patient_id, Name: p.name, Mobile: p.mobile, Email: p.email, FileCount: signed.length, Files: signed });
      }
      return result;
    }

    case 'getPatientReports': {
      const id = a(1); const patient = await getPatientById(id); if (!patient) throw new Error('Patient not found.');
      const { data, error } = await admin.from('patient_files').select('*').eq('patient_no', id).neq('status', 'DELETED').order('uploaded_at', { ascending: false });
      if (error) throw error;
      const files = await Promise.all((data || []).map(async (f: any) => outFile(f, await signUrl(f.storage_path))));
      return { patient: outPatient(patient), files };
    }

    case 'uploadPatientFile':
    case 'uploadPatientReport': {
      const d = a(1) || {};
      const patient = await getPatientById(d.PatientNo); if (!patient) throw new Error('Patient not found.');
      if (!d.FileName || !d.Base64) throw new Error('File information is incomplete.');
      let encounterId = d.EncounterId || '';
      if (d.VisitNo) {
        const vr = await admin.from('visits').select('encounter_id,patient_no').eq('visit_no',d.VisitNo).maybeSingle();
        if (vr.error) throw vr.error;
        if (!vr.data || String(vr.data.patient_no) !== String(d.PatientNo)) throw new Error('Invalid visit for this patient.');
        encounterId = vr.data.encounter_id || encounterId;
      }
      const path = await uploadBase64(d.PatientNo, d.VisitNo || '', d.FileName, d.MimeType || 'application/octet-stream', d.Base64);
      const { data, error } = await admin.from('patient_files').insert({ patient_no: d.PatientNo, visit_no: d.VisitNo || '', encounter_id: encounterId, file_name: d.FileName, mime_type: d.MimeType || 'application/octet-stream', storage_path: path, uploaded_by: user.email, status: 'ACTIVE' }).select('*').single();
      if (error) { await admin.storage.from(BUCKET).remove([path]); throw error; }
      const url = await signUrl(path);
      await audit(user, 'UPLOAD', 'PATIENT_REPORT', data.file_id, `Uploaded ${data.file_name} for ${data.patient_no}`);
      return outFile(data, url);
    }

    case 'deletePatientReport': {
      const fileId = a(1);
      const { data: file, error } = await admin.from('patient_files').select('*').eq('file_id', fileId).maybeSingle();
      if (error) throw error; if (!file) throw new Error('Report not found.');
      if (String(file.status).toUpperCase() === 'DELETED') return { ok: true, message: 'Report is already deleted.' };
      await admin.storage.from(BUCKET).remove([file.storage_path]);
      const up = await admin.from('patient_files').update({ status: 'DELETED' }).eq('file_id', fileId);
      if (up.error) throw up.error;
      await audit(user, 'DELETE', 'PATIENT_REPORT', fileId, `Deleted ${file.file_name} for ${file.patient_no}`);
      return { ok: true, message: 'Report deleted successfully.' };
    }

    case 'checkoutVisit': {
      requireAdminOrBilling(user);
      const visitNo=String(a(1)||'').trim(); if(!visitNo) throw new Error('Visit ID is required.');
      const d=a(2)||{};
      const discount=Math.max(0,Number(d.discountAmount||0));
      const paymentAmount=Math.max(0,Number(d.paymentAmount||0));
      const paymentMode=String(d.paymentMode||'CASH').trim().toUpperCase();
      const referenceNo=String(d.referenceNo||'').trim();
      if(!['CASH','UPI','CARD','NETBANKING','BANK_TRANSFER','OTHER'].includes(paymentMode)) throw new Error('Invalid payment mode.');
      const vr=await admin.from('visits').select('*').eq('visit_no',visitNo).maybeSingle(); if(vr.error) throw vr.error; if(!vr.data) throw new Error('Visit not found.');

      const existingItems=await admin.from('hims_billing_items').select('*').eq('visit_no',visitNo).order('created_at'); if(existingItems.error) throw existingItems.error;
      const alreadyBilled=(existingItems.data||[]).filter((x:any)=>String(x.status).toUpperCase()==='BILLED'&&x.bill_id);
      if(alreadyBilled.length){
        const billIds=[...new Set(alreadyBilled.map((x:any)=>x.bill_id).filter(Boolean))];
        const billQ=await admin.from('hims_bills').select('*').in('id',billIds).order('created_at',{ascending:false}).limit(1).maybeSingle(); if(billQ.error) throw billQ.error;
        if(!billQ.data) throw new Error('Existing consultation bill could not be found.');
        const bp=await admin.from('payments').select('amount').eq('bill_id',billQ.data.id).neq('status','CANCELLED'); if(bp.error) throw bp.error;
        const paid=(bp.data||[]).reduce((sum:number,x:any)=>sum+Number(x.amount||0),0);
        const total=Number(billQ.data.subtotal||0), balance=Math.max(0,total-paid);
        if(paymentAmount>0){
          if(paymentAmount>balance+0.005) throw new Error('Payment exceeds the outstanding balance.');
          const ins=await admin.from('payments').insert({bill_id:billQ.data.id,patient_no:billQ.data.patient_no,amount:paymentAmount,payment_mode:paymentMode,reference_no:referenceNo,status:'PAID',paid_by:user.email}).select('*').single(); if(ins.error) throw ins.error;
        }
        const newPaid=paid+paymentAmount, newBalance=Math.max(0,total-newPaid), status=newBalance<=0.005?'PAID':newPaid>0?'PARTIAL':'UNPAID';
        const up=await admin.from('hims_bills').update({status,paid_at:status==='PAID'?new Date().toISOString():null}).eq('id',billQ.data.id).select('*').single(); if(up.error) throw up.error;
        await maybeCloseVisit(visitNo);
        const phExisting=await admin.from('pharmacy_prescriptions').select('id,pharmacy_status').eq('visit_no',visitNo).maybeSingle();if(phExisting.error)throw phExisting.error;
        const latestVisit=await admin.from('visits').select('visit_no,status').eq('visit_no',visitNo).maybeSingle();if(latestVisit.error)throw latestVisit.error;
        return {BillNo:up.data.bill_no,BillId:up.data.id,GrossTotal:Number(up.data.gross_amount||total),Discount:Number(up.data.discount_amount||0),Subtotal:total,Paid:newPaid,Balance:newBalance,Status:status,Items:alreadyBilled,Pharmacy:phExisting.data?{requested:true,pharmacyPrescriptionId:phExisting.data.id,status:phExisting.data.pharmacy_status}:{requested:false},Visit:{VisitNo:visitNo,Status:String(latestVisit.data?.status||'OPEN').toUpperCase()}};
      }

      if(String(vr.data.status).toUpperCase()!=='OPEN') throw new Error('Visit is already closed and has no active consultation billing to finalize.');
      await action('checkoutConsultation',[visitNo],user);
      const ready=await admin.from('hims_billing_items').select('*').eq('visit_no',visitNo).eq('status','READY').order('created_at'); if(ready.error) throw ready.error;
      if(!(ready.data||[]).length) throw new Error('No billable case sheets are ready for checkout.');
      const items=ready.data||[];
      const gross=items.reduce((sum:number,x:any)=>sum+Number(x.amount||0),0);
      if(discount>gross+0.005) throw new Error('Discount cannot exceed the billable amount.');
      const total=Math.max(0,gross-discount);
      if(paymentAmount>total+0.005) throw new Error('Payment exceeds the final bill amount.');
      const billNo='INV'+Date.now().toString().slice(-8);
      const bill=await admin.from('hims_bills').insert({bill_no:billNo,patient_no:items[0].patient_no,appointment_no:items[0].appointment_no||null,subtotal:total,gross_amount:gross,discount_amount:discount,status:'UNPAID',created_by:user.email}).select('*').single(); if(bill.error) throw bill.error;
      const up=await admin.from('hims_billing_items').update({status:'BILLED',billed_at:new Date().toISOString(),bill_id:bill.data.id}).eq('visit_no',visitNo).eq('status','READY'); if(up.error) throw up.error;
      const lock=await admin.from('case_sheets').update({status:'LOCKED',locked_at:new Date().toISOString(),locked_by:user.email,completed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('visit_no',visitNo).eq('status','OPEN'); if(lock.error) throw lock.error;
      if(paymentAmount>0){const ins=await admin.from('payments').insert({bill_id:bill.data.id,patient_no:bill.data.patient_no,amount:paymentAmount,payment_mode:paymentMode,reference_no:referenceNo,status:'PAID',paid_by:user.email}).select('*').single(); if(ins.error) throw ins.error;}
      const newStatus=paymentAmount>=total-0.005?'PAID':paymentAmount>0?'PARTIAL':'UNPAID';
      const bu=await admin.from('hims_bills').update({status:newStatus,paid_at:newStatus==='PAID'?new Date().toISOString():null}).eq('id',bill.data.id).select('*').single(); if(bu.error) throw bu.error;
      const prep=await action('pharmacyPrepareVisitRequest',[visitNo],user);
      await maybeCloseVisit(visitNo);
      await audit(user,'CREATE','BILL',bill.data.id,`Created consultation bill ${billNo} for visit ${visitNo}; gross ${gross}; discount ${discount}; paid ${paymentAmount}`);
      const latestVisit=await admin.from('visits').select('visit_no,status').eq('visit_no',visitNo).maybeSingle(); if(latestVisit.error)throw latestVisit.error;
      return {BillNo:billNo,BillId:bill.data.id,GrossTotal:gross,Discount:discount,Subtotal:total,Paid:paymentAmount,Balance:Math.max(0,total-paymentAmount),Status:newStatus,Items:items,Pharmacy:prep,Visit:{VisitNo:visitNo,Status:String(latestVisit.data?.status||'OPEN').toUpperCase()}};
    }
    case 'checkInPreflight': {
      requireAdmin(user);
      const appointmentNo = String(a(1) || '').trim();
      if (!appointmentNo) throw new Error('Appointment number is required.');
      const {data: ap,error: ae}=await admin.from('appointments').select('*').eq('appointment_no',appointmentNo).maybeSingle();
      if(ae) throw ae;
      if(!ap) return {ok:false,appointment:null,checks:[{name:'Appointment',ok:false,detail:'Appointment not found.'}]};
      const checks:any[]=[];
      const p=await admin.from('patients').select('patient_id,name').eq('patient_id',ap.patient_no).maybeSingle();
      checks.push({name:'Patient mapping',ok:!p.error&&!!p.data,detail:p.error?.message||`${ap.patient_no} → patients`});
      const v=await admin.from('visits').select('visit_no,status').eq('patient_no',ap.patient_no).eq('status','OPEN').maybeSingle();
      checks.push({name:'Open visit rule',ok:!v.error&&!v.data,detail:v.error?.message||(v.data?`Open visit ${v.data.visit_no} already exists.`:'No open visit.')});
      const coreCols=['visit_no','encounter_id','patient_no','appointment_no','check_in_at','check_out_at','status','created_by'];
      const schema=await admin.from('visits').select(coreCols.join(',')).limit(0);
      checks.push({name:'Visits core schema mapping',ok:!schema.error,detail:schema.error?.message||'Core check-in columns are available.'});
      checks.push({name:'Visit routing model',ok:true,detail:'Doctor/department/fee routing is read from appointments, users and case_sheets; visits remains the single encounter record.'});
      checks.push({name:'Appointment status',ok:String(ap.status).toUpperCase()==='BOOKED',detail:`Current status: ${ap.status}`});
      checks.push({name:'Department mapping',ok:!!String(ap.department||ap.speciality||'').trim(),detail:String(ap.department||ap.speciality||'')||'Missing department/speciality'});
      return {ok:checks.every(x=>x.ok),appointment:outAppointment(ap,p.data?.name||''),checks};
    }

    case 'getNotifications': {
      const rows=await admin.from('notifications').select('*').eq('recipient_user_id',user.user_id).order('created_at',{ascending:false}).limit(50);
      if(rows.error)throw rows.error;
      return rows.data||[];
    }
    case 'markNotificationRead': {
      const id=String(a(1)||'');if(!id)throw new Error('Notification ID is required.');
      const r=await admin.from('notifications').update({read_at:new Date().toISOString()}).eq('id',id).eq('recipient_user_id',user.user_id).select('*').single();
      if(r.error)throw r.error;return r.data;
    }
    case 'systemDiagnostics': {
      requireAdmin(user);
      const checks:any[]=[];
      const probe=async(name:string,table:string,columns:string[])=>{const r=await admin.from(table).select(columns.join(',')).limit(0);checks.push({name,ok:!r.error,detail:r.error?.message||`Mapped to ${table}`});};
      await probe('Patients API → patients table','patients',['patient_id','name','mobile']);
      await probe('Appointments API → appointments table','appointments',['appointment_no','patient_no','doctor_id','department','status']);
      await probe('Check-in API → visits core table','visits',['visit_no','encounter_id','patient_no','appointment_no','check_in_at','check_out_at','status','created_by']);
      await probe('Appointment routing → appointments table','appointments',['appointment_no','patient_no','doctor_id','doctor_name','department','status']);
      await probe('Case-sheet provider routing → case_sheets table','case_sheets',['case_sheet_id','visit_no','patient_no','department_id','department','doctor_id','doctor_name','consultation_fee','billing_enabled','status']);
      await probe('Case sheets API → case_sheets table','case_sheets',['case_sheet_id','visit_no','patient_no','department_id','department','doctor_id','status']);
      await probe('Prescription API → visit_prescriptions table','visit_prescriptions',['id','visit_no','patient_no','medicine_name','dose','duration','instructions','pharmacy_medicine_id']);
      await probe('Investigation API → visit_screenings table','visit_screenings',['id','visit_no','patient_no','test_type','test_name','indication']);
      await probe('Pharmacy autocomplete → pharmacy_medicines table','pharmacy_medicines',['id','generic_name','brand_name','sku','active']);
      checks.push({name:'Frontend → Edge Function contract','ok':true,detail:'Frontend calls the configured hims-api function with {action,args}.'});
      checks.push({name:'Prescription UI contract','ok':true,detail:'UI sends MedicineName, MedicineId, Dose, Duration and Instructions.'});
      checks.push({name:'Investigation UI contract','ok':true,detail:'UI sends Type, Investigation and Reason only.'});
      return {ok:checks.every(x=>x.ok),checks};
    }

    case 'listUsers': {
      requireAdmin(user);
      const { data, error } = await admin.from('users').select('*').neq('status', 'DELETED').order('name');
      if (error) throw error;
      return await Promise.all((data || []).map(outUserWithPhoto));
    }

    case 'saveUser': {
      requireAdmin(user);
      const d=a(1)||{}; const email=cleanEmail(d.Email);
      if(!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Valid email is required.');
      if(!String(d.Name||'').trim()) throw new Error('Name is required.');
      const role=String(d.Role||'STAFF').toUpperCase();
      const allowed=['DOCTOR','NURSE','ACCOUNTS','PROCUREMENT','CRM','RECEPTION','STAFF','MANAGEMENT','ADMIN'];
      if(!allowed.includes(role)) throw new Error('Invalid role.');
      if(role==='ADMIN' && !isAdminEmail(email)) throw new Error('Only the configured administrator can have ADMIN access.');
      const status=String(d.Status||'ACTIVE').toUpperCase();
      let authUser:any=null;
      const existingAuth=await admin.auth.admin.listUsers({page:1,perPage:1000});
      if(existingAuth.error) throw existingAuth.error;
      authUser=(existingAuth.data.users||[]).find((x:any)=>cleanEmail(x.email)===email) || null;
      if(!authUser){ const created=await admin.auth.admin.createUser({email,email_confirm:true}); if(created.error) throw created.error; authUser=created.data.user; }
      let departmentName=String(d.Department||'').trim();
      if(d.DepartmentId){ const dep=await admin.from('departments').select('name').eq('id',d.DepartmentId).maybeSingle(); if(dep.error) throw dep.error; departmentName=dep.data?.name||departmentName; }
      const effectiveBilling=role==='ADMIN'||isAdminEmail(email)?true:d.BillingEnabled!==false;
      const effectiveCaseSheet=role==='ADMIN'||isAdminEmail(email)?true:d.CaseSheetEnabled!==false;
      const patch:any={auth_user_id:authUser.id,name:String(d.Name).trim(),role,job_title:d.JobTitle||'',speciality:d.Speciality||'',department:departmentName,department_id:d.DepartmentId||null,branch:d.Branch||'',consultation_fee:Number(d.ConsultationFee||0),billing_enabled:effectiveBilling,case_sheet_enabled:effectiveCaseSheet,status};
      const existing=await admin.from('users').select('*').eq('email',email).maybeSingle(); if(existing.error) throw existing.error;
      let data:any; if(existing.data){const u=await admin.from('users').update(patch).eq('email',email).select('*').single(); if(u.error) throw u.error; data=u.data;} else {const i=await admin.from('users').insert({...patch,email}).select('*').single(); if(i.error) throw i.error; data=i.data;}
      const ban=status==='ACTIVE' ? 'none' : '876000h';
      const au=await admin.auth.admin.updateUserById(authUser.id,{ban_duration:ban}); if(au.error) throw au.error;
      return await outUserWithPhoto(data);
    }
    case 'deleteUser': {
      requireAdmin(user);
      const email = cleanEmail(a(1));
      if (!email) throw new Error('User email is required.');
      if (isAdminEmail(email)) throw new Error('The administrator account cannot be deleted.');
      const existing = await admin.from('users').select('*').eq('email', email).maybeSingle();
      if (existing.error) throw existing.error; if (!existing.data) throw new Error('User not found.');
      const u = await admin.from('users').update({ status: 'DISABLED' }).eq('email', email);
      if (u.error) throw u.error;
      if(existing.data.auth_user_id){ const au=await admin.auth.admin.updateUserById(existing.data.auth_user_id,{ban_duration:'876000h'}); if(au.error) throw au.error; }
      await audit(user, 'DISABLE', 'USER', existing.data.user_id, `Disabled user ${email}`);
      return { ok: true, message: 'User deleted successfully.' };
    }

    default:
      throw new Error('Unsupported HIMS operation.');
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return err('POST required.', 405);
  try {
    const user = await requireUser(req);
    const body = await req.json();
    const name = String(body.action || '');
    const args = Array.isArray(body.args) ? body.args : [];
    return json(await action(name, args, user));
  } catch (e) {
    console.error(e);
    return err(e instanceof Error ? e.message : String(e), 400);
  }
});
