-- HIMS is the master for common client/staff identity data.
-- Metabolic tables keep only metabolic-specific data plus stable HIMS linkage.

alter table public.metabolic_clients add column if not exists hims_patient_id text;
alter table public.metabolic_profiles add column if not exists hims_user_id uuid;

create unique index if not exists ux_metabolic_clients_hims_patient on public.metabolic_clients(hims_patient_id) where hims_patient_id is not null;
create unique index if not exists ux_metabolic_profiles_hims_user on public.metabolic_profiles(hims_user_id) where hims_user_id is not null;
create unique index if not exists ux_users_auth_user_id_not_null on public.users(auth_user_id) where auth_user_id is not null;

alter table public.metabolic_clients drop constraint if exists metabolic_clients_hims_patient_fk;
alter table public.metabolic_clients add constraint metabolic_clients_hims_patient_fk foreign key (hims_patient_id) references public.patients(patient_id) on update cascade on delete restrict;
alter table public.metabolic_profiles drop constraint if exists metabolic_profiles_hims_user_fk;
alter table public.metabolic_profiles add constraint metabolic_profiles_hims_user_fk foreign key (hims_user_id) references public.users(user_id) on update cascade on delete restrict;

insert into public.metabolic_clients (hims_patient_id,record_number,full_name,email,phone,sex,date_of_birth,status,notes)
select p.patient_id,p.patient_id,p.name,p.email,p.mobile,
  case upper(trim(coalesce(p.gender,''))) when 'MALE' then 'MALE' when 'FEMALE' then 'FEMALE' when 'OTHER' then 'OTHER' else '' end,
  p.dob,p.status,''
from public.patients p
where not exists (select 1 from public.metabolic_clients mc where mc.hims_patient_id=p.patient_id);

update public.metabolic_profiles mp
set hims_user_id=u.user_id,user_id=u.auth_user_id,full_name=u.name,job_title=u.job_title,status=u.status,
    role=case when u.role='ADMIN' then 'ADMIN' else 'SUB_ADMIN' end,updated_at=now()
from public.users u where u.auth_user_id=mp.user_id;

create or replace function public.sync_metabolic_client_from_hims() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if pg_trigger_depth()>1 then return new; end if;
  insert into public.metabolic_clients(hims_patient_id,record_number,full_name,email,phone,sex,date_of_birth,status,notes)
  values(new.patient_id,new.patient_id,new.name,new.email,new.mobile,
    case upper(trim(coalesce(new.gender,''))) when 'MALE' then 'MALE' when 'FEMALE' then 'FEMALE' when 'OTHER' then 'OTHER' else '' end,
    new.dob,new.status,'')
  on conflict(hims_patient_id) do update set record_number=excluded.record_number,full_name=excluded.full_name,email=excluded.email,phone=excluded.phone,sex=excluded.sex,date_of_birth=excluded.date_of_birth,status=excluded.status,updated_at=now();
  return new;
end; $$;

drop trigger if exists trg_sync_metabolic_client_from_hims on public.patients;
create trigger trg_sync_metabolic_client_from_hims after insert or update of name,gender,dob,mobile,email,status on public.patients for each row execute function public.sync_metabolic_client_from_hims();

create or replace function public.guard_metabolic_client_common_data() returns trigger language plpgsql security definer set search_path=public as $$
declare p public.patients%rowtype;
begin
  if new.hims_patient_id is not null then
    select * into p from public.patients where patient_id=new.hims_patient_id;
    if found then
      new.record_number:=p.patient_id; new.full_name:=p.name; new.email:=p.email; new.phone:=p.mobile;
      new.sex:=case upper(trim(coalesce(p.gender,''))) when 'MALE' then 'MALE' when 'FEMALE' then 'FEMALE' when 'OTHER' then 'OTHER' else '' end;
      new.date_of_birth:=p.dob; new.status:=p.status;
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists trg_guard_metabolic_client_common_data on public.metabolic_clients;
create trigger trg_guard_metabolic_client_common_data before insert or update on public.metabolic_clients for each row execute function public.guard_metabolic_client_common_data();

create or replace function public.sync_metabolic_profile_from_hims() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.auth_user_id is null or pg_trigger_depth()>1 then return new; end if;
  insert into public.metabolic_profiles(user_id,hims_user_id,full_name,role,phone,job_title,status)
  values(new.auth_user_id,new.user_id,new.name,case when new.role='ADMIN' then 'ADMIN' else 'SUB_ADMIN' end,'',new.job_title,new.status)
  on conflict(user_id) do update set hims_user_id=excluded.hims_user_id,full_name=excluded.full_name,role=excluded.role,job_title=excluded.job_title,status=excluded.status,updated_at=now();
  return new;
end; $$;

drop trigger if exists trg_sync_metabolic_profile_from_hims on public.users;
create trigger trg_sync_metabolic_profile_from_hims after insert or update of auth_user_id,name,role,job_title,status on public.users for each row execute function public.sync_metabolic_profile_from_hims();
