/** Shared CRM row types + constants. Safe to import from client and server code. */

export const STAGES = ['new', 'qualified', 'contacted', 'meeting', 'proposal', 'installation', 'client', 'lost'] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  new: 'New lead',
  qualified: 'Qualified',
  contacted: 'Contacted',
  meeting: 'Meeting',
  proposal: 'Proposal',
  installation: 'Installation',
  client: 'Client',
  lost: 'Lost',
};

export const COMPANY_TYPES = [
  'owner_operator', 'property_manager', 'developer', 'reit', 'nonprofit', 'public_housing', 'investor', 'other', 'unknown',
] as const;
export type CompanyType = (typeof COMPANY_TYPES)[number];

export const COMPANY_TYPE_LABELS: Record<CompanyType, string> = {
  owner_operator: 'Owner / operator',
  property_manager: 'Property manager',
  developer: 'Developer',
  reit: 'REIT',
  nonprofit: 'Nonprofit',
  public_housing: 'Public housing',
  investor: 'Investor',
  other: 'Other',
  unknown: 'Unknown',
};

export const ROLE_CATEGORIES = ['owner', 'executive', 'property_manager', 'operations', 'maintenance', 'finance', 'leasing', 'other'] as const;
export type RoleCategory = (typeof ROLE_CATEGORIES)[number];
export const ROLE_LABELS: Record<RoleCategory, string> = {
  owner: 'Owner', executive: 'Executive', property_manager: 'Property manager', operations: 'Operations',
  maintenance: 'Maintenance', finance: 'Finance', leasing: 'Leasing', other: 'Other',
};

export const EMAIL_STATUSES = ['verified', 'published', 'inferred', 'unknown', 'bounced'] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

export const ACTIVITY_TYPES = ['note', 'voice_note', 'call', 'meeting', 'email_out', 'email_in', 'stage_change', 'task_done', 'research', 'campaign', 'system'] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
export const MANUAL_ACTIVITY_TYPES = ['note', 'voice_note', 'call', 'meeting'] as const;

export const TASK_TYPES = ['todo', 'call', 'email', 'follow_up', 'meeting', 'site_visit'] as const;
export type TaskType = (typeof TASK_TYPES)[number];
export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  todo: 'To-do', call: 'Call', email: 'Email', follow_up: 'Follow-up', meeting: 'Meeting', site_visit: 'Site visit',
};
export const TASK_PRIORITIES = ['low', 'normal', 'high'] as const;

export const PAYABLE_STATUSES = ['draft', 'due', 'paid', 'overdue', 'void'] as const;
export type PayableStatus = (typeof PAYABLE_STATUSES)[number];

export const METER_STATUSES = ['unknown', 'smart', 'ami_available', 'manual', 'puma_installed'] as const;

export type CompanyRow = {
  id: string;
  workspace_id: string;
  name: string;
  name_key: string;
  legal_name: string | null;
  domain: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  company_type: CompanyType;
  stage: Stage;
  owner_user_id: string | null;
  score: number | null;
  score_breakdown: Array<{ label?: string; key?: string; points?: number; max?: number; note?: string; detail?: string }>;
  score_confidence: 'high' | 'medium' | 'low' | null;
  portfolio_buildings: number | null;
  portfolio_units: number | null;
  portfolio_basis: string | null;
  est_annual_water_spend: number | null;
  tags: string[];
  description: string | null;
  linkedin_url: string | null;
  source: 'manual' | 'engine' | 'import';
  source_ref: Record<string, unknown>;
  research: Record<string, unknown>;
  research_status: 'none' | 'queued' | 'running' | 'done' | 'failed';
  researched_at: string | null;
  next_follow_up_at: string | null;
  last_activity_at: string | null;
  last_contacted_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/** Company row as returned by list endpoints (with light aggregates). */
export type CompanyListRow = CompanyRow & {
  contact_count: number;
  property_count: number;
  has_email: boolean;
  top_contact_name: string | null;
};

export type ContactRow = {
  id: string;
  workspace_id: string;
  company_id: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string;
  title: string | null;
  role_category: RoleCategory;
  is_decision_maker: boolean;
  email: string | null;
  email_status: EmailStatus;
  phone: string | null;
  mobile: string | null;
  linkedin_url: string | null;
  address: string | null;
  source: string;
  source_ref: Record<string, unknown>;
  confidence: number | null;
  tags: string[];
  notes: string | null;
  unsubscribed_at: string | null;
  bounced_at: string | null;
  last_contacted_at: string | null;
  last_replied_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};
export type ContactListRow = ContactRow & { company_name: string | null; company_stage: Stage | null };

export type PropertyRow = {
  id: string;
  workspace_id: string;
  company_id: string | null;
  source_key: string | null;
  name: string | null;
  address: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  county: string | null;
  lat: number | null;
  lon: number | null;
  units: number | null;
  buildings: number | null;
  year_built: number | null;
  stories: number | null;
  building_class: string | null;
  gross_sqft: number | null;
  assessed_value: number | null;
  parcel_id: string | null;
  bbl: string | null;
  owner_name_on_record: string | null;
  owner_mailing_address: string | null;
  manager_name: string | null;
  utility_name: string | null;
  utility_pwsid: string | null;
  meter_status: 'unknown' | 'smart' | 'ami_available' | 'manual' | 'puma_installed';
  est_annual_water_gallons: number | null;
  est_annual_water_cost: number | null;
  reported_water_kgal: number | null;
  reported_water_year: number | null;
  energy_star_score: number | null;
  source: string;
  source_ref: Record<string, unknown>;
  notes: string | null;
  created_at: string;
  updated_at: string;
};
export type PropertyListRow = PropertyRow & { company_name: string | null; company_stage: Stage | null };

export type ActivityRow = {
  id: string;
  workspace_id: string;
  company_id: string | null;
  contact_id: string | null;
  property_id: string | null;
  type: ActivityType;
  subject: string | null;
  body: string | null;
  meta: Record<string, unknown>;
  occurred_at: string;
  created_by: string | null;
  created_at: string;
};
export type ActivityListRow = ActivityRow & {
  company_name?: string | null;
  contact_name?: string | null;
  author_name?: string | null;
};

export type TaskRow = {
  id: string;
  workspace_id: string;
  company_id: string | null;
  contact_id: string | null;
  property_id: string | null;
  title: string;
  notes: string | null;
  type: TaskType;
  priority: 'low' | 'normal' | 'high';
  status: 'open' | 'done';
  due_at: string | null;
  assignee_id: string | null;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};
export type TaskListRow = TaskRow & { company_name: string | null; contact_name: string | null };

export type EvidenceRow = {
  id: string;
  entity_type: 'company' | 'contact' | 'property';
  entity_id: string;
  field: string;
  value: string | null;
  source_id: string;
  source_name: string;
  source_url: string | null;
  method: string;
  confidence: number;
  retrieved_at: string;
  meta: Record<string, unknown>;
};

export type PayableRow = {
  id: string;
  workspace_id: string;
  company_id: string | null;
  property_id: string | null;
  description: string;
  amount: number;
  status: PayableStatus;
  due_date: string | null;
  paid_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};
export type PayableListRow = PayableRow & { company_name: string | null; property_name: string | null; effective_status: PayableStatus };

export type MeterRow = {
  id: string;
  property_id: string;
  label: string;
  utility_account: string | null;
  meter_number: string | null;
  meter_type: string;
  status: 'active' | 'inactive';
  created_at: string;
};
export type MeterReadingRow = {
  id: string;
  meter_id: string;
  period_start: string | null;
  period_end: string;
  gallons: number | null;
  cost: number | null;
  source: 'manual' | 'import' | 'api';
  flags: Record<string, unknown>;
  created_at: string;
};
export type AlertRow = {
  id: string;
  property_id: string | null;
  meter_id: string | null;
  reading_id: string | null;
  kind: 'continuous_flow' | 'spike' | 'spend_threshold' | 'no_data';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  detail: string | null;
  status: 'open' | 'acknowledged' | 'resolved';
  detected_at: string;
  resolved_at: string | null;
};
