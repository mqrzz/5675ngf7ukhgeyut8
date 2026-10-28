create extension if not exists pgcrypto;
create table if not exists users(id uuid primary key default gen_random_uuid(),email text unique not null,name text,plan text not null default 'free',country text,created_at timestamptz not null default now());
create table if not exists oauth_accounts(provider text not null,provider_uid text not null,user_id uuid not null references users on delete cascade,primary key(provider,provider_uid));
create table if not exists login_codes(email text primary key,code_hash text not null,attempts int not null default 0,expires_at timestamptz not null);
create table if not exists sessions(token_hash text primary key,user_id uuid not null references users on delete cascade,ip text,expires_at timestamptz not null,created_at timestamptz not null default now());
create table if not exists api_keys(id uuid primary key default gen_random_uuid(),user_id uuid not null references users on delete cascade,name text not null,prefix text not null,key_hash text unique not null,created_at timestamptz not null default now(),last_used_at timestamptz,revoked_at timestamptz);
create table if not exists domains(id uuid primary key default gen_random_uuid(),user_id uuid not null references users on delete cascade,name text not null,status text not null default 'pending',sending_ok boolean not null default false,receiving_ok boolean not null default false,dkim_selector text not null,dkim_public text not null,dkim_private_enc text not null,created_at timestamptz not null default now(),verified_at timestamptz);
create unique index if not exists domains_verified_name on domains(name) where status='verified';
create index if not exists domains_user on domains(user_id);
create table if not exists emails(id uuid primary key default gen_random_uuid(),user_id uuid not null references users on delete cascade,domain_id uuid references domains on delete set null,api_key_id uuid references api_keys on delete set null,direction text not null check(direction in('out','in')),from_addr text not null,to_addrs jsonb not null,subject text,html text,text_body text,message_id text,in_reply_to text,status text not null default 'queued',error text,created_at timestamptz not null default now());
create index if not exists emails_user_time on emails(user_id,created_at desc);
create table if not exists events(id bigserial primary key,email_id uuid references emails on delete cascade,type text not null,data jsonb,created_at timestamptz not null default now());
create table if not exists suppressions(user_id uuid not null references users on delete cascade,address text not null,reason text not null,created_at timestamptz not null default now(),primary key(user_id,address));
create table if not exists webhooks(id uuid primary key default gen_random_uuid(),user_id uuid not null references users on delete cascade,url text not null,secret text not null,events text[] not null default '{}',active boolean not null default true,created_at timestamptz not null default now());
create table if not exists subdomains(slug text primary key,user_id uuid not null references users on delete cascade,created_at timestamptz not null default now());
create index if not exists subdomains_user on subdomains(user_id);
create index if not exists emails_user_dir_time on emails(user_id,direction,created_at desc);
create table if not exists contact_messages(id uuid primary key default gen_random_uuid(),name text,email text not null,topic text not null,message text not null,ip text,user_id uuid references users on delete set null,created_at timestamptz not null default now());
create table if not exists mail_queue(queue_id text primary key,email_id uuid not null references emails on delete cascade,created_at timestamptz not null default now());
create index if not exists mail_queue_time on mail_queue(created_at);
create table if not exists kv(key text primary key,value text not null);
create index if not exists events_email on events(email_id);
alter table emails add column if not exists attachments jsonb;
alter table emails add column if not exists headers jsonb;
create index if not exists emails_msgid on emails(message_id);
create table if not exists webhook_deliveries(id bigserial primary key,webhook_id uuid not null references webhooks on delete cascade,event text not null,payload jsonb not null,status text not null default 'pending',attempts int not null default 0,next_at timestamptz not null default now(),last_status int,last_error text,created_at timestamptz not null default now(),delivered_at timestamptz);
create index if not exists whd_due on webhook_deliveries(next_at) where status='pending';
create index if not exists whd_hook on webhook_deliveries(webhook_id,created_at desc);
alter table emails add column if not exists spam_score numeric(5,2);
alter table emails add column if not exists spam_rules jsonb;
alter table users add column if not exists lang text;
alter table users add column if not exists notify jsonb not null default '{"bounce":true,"complaint":true,"quota":true,"domain":true,"ticket":true}';
alter table users add column if not exists is_admin boolean not null default false;
alter table users add column if not exists staff_role text;
update users set staff_role='owner' where is_admin and staff_role is null;
alter table sessions add column if not exists ua text;
alter table sessions add column if not exists mfa_ok boolean not null default true;
create table if not exists user_totp(user_id uuid primary key references users on delete cascade,secret_enc text not null,enabled boolean not null default false,recovery text[] not null default '{}',last_step bigint,created_at timestamptz not null default now(),enabled_at timestamptz);
create table if not exists notifications(id bigserial primary key,user_id uuid not null references users on delete cascade,type text not null,title text not null,body text,link text,dedupe text,read_at timestamptz,created_at timestamptz not null default now());
create index if not exists notifications_user on notifications(user_id,created_at desc);
create unique index if not exists notifications_dedupe on notifications(user_id,dedupe) where dedupe is not null;
create table if not exists tickets(id uuid primary key default gen_random_uuid(),user_id uuid not null references users on delete cascade,subject text not null,topic text not null default 'other',status text not null default 'open',created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index if not exists tickets_user on tickets(user_id,updated_at desc);
create table if not exists ticket_messages(id bigserial primary key,ticket_id uuid not null references tickets on delete cascade,author text not null check(author in('user','staff')),body text not null,created_at timestamptz not null default now());
create index if not exists ticket_messages_ticket on ticket_messages(ticket_id,id);
create table if not exists incidents(id uuid primary key default gen_random_uuid(),title text not null,body text,component text,status text not null default 'investigating',impact text not null default 'minor',started_at timestamptz not null default now(),resolved_at timestamptz);
create table if not exists status_days(day date not null,component text not null,checks int not null default 0,fails int not null default 0,primary key(day,component));
create table if not exists templates(id uuid primary key default gen_random_uuid(),user_id uuid not null references users on delete cascade,name text not null,subject text not null default '',html text not null default '',text_body text not null default '',created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index if not exists templates_user on templates(user_id,updated_at desc);
alter table users add column if not exists send_settings jsonb not null default '{}';
alter table emails add column if not exists template_id uuid;
create table if not exists template_versions(id bigserial primary key,template_id uuid not null references templates on delete cascade,name text not null,subject text not null,html text not null,text_body text not null,created_at timestamptz not null default now());
create index if not exists template_versions_t on template_versions(template_id,id desc);
create table if not exists otp_codes(id uuid primary key default gen_random_uuid(),user_id uuid not null references users on delete cascade,address text not null,code_hash text not null,salt text not null,attempts int not null default 0,expires_at timestamptz not null,consumed_at timestamptz,created_at timestamptz not null default now());
create index if not exists otp_lookup on otp_codes(user_id,address,created_at desc);
alter table users add column if not exists region text;
alter table users add column if not exists account_country text;
alter table users add column if not exists data_region text not null default 'main';
alter table users add column if not exists currency text not null default 'RUB';
alter table users add column if not exists onboarded_at timestamptz;
create index if not exists users_region on users(region);
create sequence if not exists invoices_inv_seq start 1000 maxvalue 2147483647;
create table if not exists invoices(id integer primary key default nextval('invoices_inv_seq'),user_id uuid not null references users on delete cascade,plan text not null,kind text not null check(kind in('initial','renewal','change')),amount numeric(12,2) not null check(amount>0),currency text not null default 'RUB',status text not null default 'pending' check(status in('pending','paid','failed','canceled','refunded')),parent_id integer references invoices,provider text not null default 'robokassa',provider_data jsonb,period_start timestamptz,period_end timestamptz,created_at timestamptz not null default now(),paid_at timestamptz);
create index if not exists invoices_user on invoices(user_id,created_at desc);
create table if not exists subscriptions(user_id uuid primary key references users on delete cascade,plan text not null,status text not null default 'active' check(status in('active','past_due','canceled')),recurring boolean not null default false,parent_invoice_id integer references invoices,current_period_end timestamptz,cancel_at_period_end boolean not null default false,attempts int not null default 0,next_attempt_at timestamptz,updated_at timestamptz not null default now());
create index if not exists subscriptions_due on subscriptions(current_period_end) where status<>'canceled';
create table if not exists payment_events(id bigserial primary key,invoice_id integer references invoices on delete cascade,kind text not null,payload jsonb,created_at timestamptz not null default now());
create index if not exists payment_events_inv on payment_events(invoice_id,id);
create table if not exists audiences(id uuid primary key default gen_random_uuid(),user_id uuid not null references users on delete cascade,name text not null,created_at timestamptz not null default now());
create index if not exists audiences_user on audiences(user_id,created_at);
create table if not exists contacts(id uuid primary key default gen_random_uuid(),audience_id uuid not null references audiences on delete cascade,user_id uuid not null references users on delete cascade,email text not null,first_name text,last_name text,unsubscribed boolean not null default false,unsubscribed_at timestamptz,created_at timestamptz not null default now(),unique(audience_id,email));
create index if not exists contacts_user on contacts(user_id);
create index if not exists contacts_aud on contacts(audience_id,created_at desc);
create table if not exists broadcasts(id uuid primary key default gen_random_uuid(),user_id uuid not null references users on delete cascade,audience_id uuid references audiences on delete set null,audience_name text,name text not null,from_addr text,reply_to text,subject text,template_id uuid references templates on delete set null,html text,text_body text,status text not null default 'draft' check(status in('draft','scheduled','sending','paused','sent','failed','canceled')),error text,total int not null default 0,sent int not null default 0,failed int not null default 0,skipped int not null default 0,scheduled_at timestamptz,resume_at timestamptz,started_at timestamptz,finished_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index if not exists broadcasts_user on broadcasts(user_id,created_at desc);
create index if not exists broadcasts_active on broadcasts(status) where status in('scheduled','sending','paused');
create table if not exists broadcast_recipients(broadcast_id uuid not null references broadcasts on delete cascade,contact_id uuid references contacts on delete set null,email text not null,first_name text,last_name text,status text not null default 'pending' check(status in('pending','sent','failed','skipped')),email_id uuid,error text,primary key(broadcast_id,email));
create index if not exists broadcast_rcpt_pending on broadcast_recipients(broadcast_id) where status='pending';
alter table events add column if not exists user_id uuid;
update events e set user_id=m.user_id from emails m where e.email_id=m.id and e.user_id is null;
create index if not exists events_user on events(user_id,id desc);
create table if not exists metric_hours(user_id uuid not null references users on delete cascade,hr timestamptz not null,domain text not null,sent int not null default 0,delivered int not null default 0,bounced int not null default 0,complained int not null default 0,delayed int not null default 0,failed int not null default 0,suppressed int not null default 0,received int not null default 0,primary key(user_id,hr,domain));
create table if not exists metric_rcpt(user_id uuid not null references users on delete cascade,day date not null,domain text not null,rdomain text not null,delivered int not null default 0,bounced int not null default 0,complained int not null default 0,primary key(user_id,day,domain,rdomain));
create table if not exists metric_bounce(user_id uuid not null references users on delete cascade,day date not null,domain text not null,dsn text not null,n int not null default 0,primary key(user_id,day,domain,dsn));
create table if not exists api_logs(id bigserial primary key,user_id uuid not null references users on delete cascade,key_id uuid references api_keys on delete set null,method text not null,path text not null,status int not null,ms int not null default 0,via text not null default 'key',ip text,ua text,req jsonb,res jsonb,created_at timestamptz not null default now());
create index if not exists api_logs_user on api_logs(user_id,id desc);
create index if not exists api_logs_time on api_logs(created_at);
alter table broadcasts add column if not exists stats jsonb;
do $$ begin
if not exists(select 1 from kv where key='metrics_backfill_1') then
 insert into metric_hours(user_id,hr,domain,sent,delivered,bounced,complained,delayed,failed,suppressed,received)
 select m.user_id,date_trunc('hour',e.created_at at time zone 'UTC') at time zone 'UTC',
  case when m.direction='in' then lower(split_part(coalesce(m.to_addrs->>0,''),'@',2)) else lower(split_part(m.from_addr,'@',2)) end,
  coalesce(sum(case when e.type='sent' then greatest(coalesce(jsonb_array_length(e.data->'accepted'),1),1) end),0),
  count(*) filter(where e.type='delivered'),count(*) filter(where e.type='bounced'),count(*) filter(where e.type='complained'),count(*) filter(where e.type='delayed'),
  coalesce(sum(case when e.type='failed' then greatest(jsonb_array_length(m.to_addrs),1) end),0),
  coalesce(sum(case when e.type='sent' then coalesce(jsonb_array_length(e.data->'suppressed'),0) end),0),
  count(*) filter(where e.type='received')
 from events e join emails m on m.id=e.email_id group by 1,2,3
 on conflict do nothing;
 insert into metric_rcpt(user_id,day,domain,rdomain,delivered,bounced,complained)
 select m.user_id,(e.created_at at time zone 'UTC')::date,lower(split_part(m.from_addr,'@',2)),lower(split_part(e.data->>'recipient','@',2)),
  count(*) filter(where e.type='delivered'),count(*) filter(where e.type='bounced'),count(*) filter(where e.type='complained')
 from events e join emails m on m.id=e.email_id
 where m.direction='out' and e.type in('delivered','bounced','complained') and coalesce(e.data->>'recipient','')<>'' group by 1,2,3,4
 on conflict do nothing;
 insert into metric_bounce(user_id,day,domain,dsn,n)
 select m.user_id,(e.created_at at time zone 'UTC')::date,lower(split_part(m.from_addr,'@',2)),coalesce(nullif(left(e.data->>'dsn',10),''),'unknown'),count(*)
 from events e join emails m on m.id=e.email_id where m.direction='out' and e.type='bounced' group by 1,2,3,4
 on conflict do nothing;
 insert into kv(key,value) values('metrics_backfill_1','1');
end if;
end $$;
alter table users add column if not exists rating_adjust int not null default 0;
alter table users add column if not exists tariff text not null default 'standard';
create or replace function eff_plan(p text,t text) returns text as $$ select case when t='siberia' and p='free' then 'free_sib' else p end $$ language sql immutable;
create table if not exists siberia_applications(id uuid primary key default gen_random_uuid(),user_id uuid not null references users on delete cascade,status text not null default 'pending',kind text not null,org_name text not null,inn text not null,region text not null,site text,phone text,purpose text not null,note text,reviewer uuid,created_at timestamptz not null default now(),reviewed_at timestamptz);
create index if not exists siberia_user on siberia_applications(user_id,created_at desc);
create index if not exists siberia_status on siberia_applications(status,created_at);
create unique index if not exists siberia_one_pending on siberia_applications(user_id) where status='pending';
alter table siberia_applications alter column user_id drop not null;
alter table siberia_applications add column if not exists email text;
alter table siberia_applications add column if not exists lang text not null default 'en';
drop index if exists siberia_one_pending;
create unique index if not exists siberia_one_pending_email on siberia_applications(lower(email)) where status='pending';
create index if not exists siberia_email on siberia_applications(lower(email));
alter table users add column if not exists status text not null default 'active';
alter table users add column if not exists status_reason text;
alter table users add column if not exists status_at timestamptz;
alter table users add column if not exists email_norm text generated always as (case when split_part(lower(email),'@',2) in ('gmail.com','googlemail.com') then replace(split_part(split_part(lower(email),'@',1),'+',1),'.','')||'@gmail.com' else split_part(split_part(lower(email),'@',1),'+',1)||'@'||split_part(lower(email),'@',2) end) stored;
create index if not exists users_email_norm on users(email_norm);
create index if not exists users_status on users(status) where status<>'active';
create table if not exists admin_actions(id bigserial primary key,admin_id uuid references users on delete set null,user_id uuid references users on delete cascade,action text not null,details jsonb not null default '{}',created_at timestamptz not null default now());
create index if not exists admin_actions_user on admin_actions(user_id,id desc);
create table if not exists risk_flags(id bigserial primary key,user_id uuid not null references users on delete cascade,related_id uuid references users on delete cascade,kind text not null,score int not null,details jsonb not null default '{}',status text not null default 'open',auto_action text,decision text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),reviewed_by uuid references users on delete set null,reviewed_at timestamptz);
create unique index if not exists risk_open_pair on risk_flags(user_id,coalesce(related_id,'00000000-0000-0000-0000-000000000000'::uuid),kind) where status='open';
create index if not exists risk_status on risk_flags(status,score desc);
create index if not exists sessions_ip on sessions(ip,created_at);
create table if not exists maintenance(id int primary key default 1 check(id=1),active boolean not null default false,scope text not null default 'all',title text not null default '',message text not null default '',eta timestamptz,updated_at timestamptz not null default now(),updated_by uuid);
insert into maintenance(id) values(1) on conflict do nothing;
create table if not exists maintenance_notice(id int primary key default 1 check(id=1),active boolean not null default false,texts jsonb not null default '{}',starts_at timestamptz,ends_at timestamptz,emailed_at timestamptz,emailed_count int not null default 0,updated_at timestamptz not null default now(),updated_by uuid);
insert into maintenance_notice(id) values(1) on conflict do nothing;
create table if not exists sso_connections(domain text primary key,issuer text not null,client_id text not null,client_secret_enc text not null,enabled boolean not null default true,created_at timestamptz not null default now());

create table if not exists page_events(id bigserial primary key,ts timestamptz not null default now(),sid text not null,kind text not null,path text not null,label text not null default '',ref text not null default '',lang text not null default '',country text not null default '',device text not null default '');
create index if not exists page_events_ts on page_events(ts);create index if not exists page_events_path on page_events(path);

create table if not exists org_mailboxes(id uuid primary key default gen_random_uuid(),address text unique not null,title text not null,kind text not null default 'general',staff_ids uuid[] not null default '{}',show_public boolean not null default false,created_at timestamptz not null default now());
create table if not exists org_messages(id uuid primary key default gen_random_uuid(),mailbox_id uuid not null references org_mailboxes(id) on delete cascade,direction text not null,from_addr text not null,to_addrs text not null,subject text not null default '',text_body text,html text,message_id text,in_reply_to text,read_at timestamptz,sent_by uuid,created_at timestamptz not null default now());
create index if not exists org_messages_box on org_messages(mailbox_id,direction,created_at desc);
create table if not exists org_attachments(id uuid primary key default gen_random_uuid(),message_id uuid not null references org_messages(id) on delete cascade,filename text,content_type text,size int not null,data bytea not null);
create index if not exists org_attachments_msg on org_attachments(message_id);
create table if not exists org_meta(key text primary key,created_at timestamptz not null default now());
create table if not exists team_members(owner_id uuid not null references users(id) on delete cascade,user_id uuid not null references users(id) on delete cascade,role text not null default 'member',created_at timestamptz not null default now(),primary key(owner_id,user_id));
create table if not exists team_invites(id uuid primary key default gen_random_uuid(),owner_id uuid not null references users(id) on delete cascade,email text not null,role text not null default 'member',token_hash text not null unique,created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '7 days',accepted_at timestamptz,revoked_at timestamptz);
create index if not exists team_invites_owner on team_invites(owner_id) where accepted_at is null and revoked_at is null;
create table if not exists automations(id uuid primary key default gen_random_uuid(),user_id uuid not null references users(id) on delete cascade,name text not null default 'Untitled automation',enabled boolean not null default false,trigger_event text not null default '',steps jsonb not null default '[]',created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index if not exists automations_user on automations(user_id);
create table if not exists automation_runs(id uuid primary key default gen_random_uuid(),automation_id uuid not null references automations(id) on delete cascade,email text not null,payload jsonb not null default '{}',step_idx int not null default 0,run_at timestamptz not null default now(),status text not null default 'pending',error text,created_at timestamptz not null default now(),finished_at timestamptz);
create index if not exists automation_runs_due on automation_runs(run_at) where status='pending';
create table if not exists unsub_style(user_id uuid primary key references users(id) on delete cascade,bg text not null default '#050508',tx text not null default '#edeef0',accent text not null default '#363a3f',hide_branding boolean not null default false,updated_at timestamptz not null default now());
alter table api_keys add column if not exists permission text not null default 'full';
alter table api_keys add column if not exists domain_id uuid references domains on delete set null;
create table if not exists segments(id uuid primary key default gen_random_uuid(),audience_id uuid not null references audiences on delete cascade,user_id uuid not null references users on delete cascade,name text not null,created_at timestamptz not null default now());
create index if not exists segments_aud on segments(audience_id);
create table if not exists segment_contacts(segment_id uuid not null references segments on delete cascade,contact_id uuid not null references contacts on delete cascade,primary key(segment_id,contact_id));
create index if not exists segment_contacts_c on segment_contacts(contact_id);
create table if not exists contact_props(id uuid primary key default gen_random_uuid(),audience_id uuid not null references audiences on delete cascade,user_id uuid not null references users on delete cascade,key text not null,type text not null default 'string',created_at timestamptz not null default now(),unique(audience_id,key));
alter table contacts add column if not exists props jsonb not null default '{}';
create table if not exists topics(id uuid primary key default gen_random_uuid(),audience_id uuid not null references audiences on delete cascade,user_id uuid not null references users on delete cascade,name text not null,description text,default_on boolean not null default true,created_at timestamptz not null default now());
create index if not exists topics_aud on topics(audience_id);
create table if not exists contact_topics(topic_id uuid not null references topics on delete cascade,contact_id uuid not null references contacts on delete cascade,subscribed boolean not null,primary key(topic_id,contact_id));
alter table broadcasts add column if not exists segment_id uuid references segments on delete set null;
alter table broadcasts add column if not exists topic_id uuid references topics on delete set null;
alter table broadcast_recipients add column if not exists props jsonb;
