import { z } from 'zod';
import { ACTIVITY_TYPES, COMPANY_TYPES, EMAIL_STATUSES, MANUAL_ACTIVITY_TYPES, METER_STATUSES, PAYABLE_STATUSES, ROLE_CATEGORIES, STAGES, TASK_PRIORITIES, TASK_TYPES } from './types';

/** Trimmed optional string: '' -> null, undefined stays undefined (so PATCH can tell "omit" from "clear"). */
const str = (max = 500) =>
  z.string().trim().max(max).nullish().transform((v) => (v === undefined ? undefined : v === null || v === '' ? null : v));

const num = z.preprocess(
  (v) => (v === '' || v === null ? null : typeof v === 'string' ? Number(v.replace(/[$,\s]/g, '')) : v),
  z.number().finite().nullable().optional(),
);
const int = z.preprocess(
  (v) => (v === '' || v === null ? null : typeof v === 'string' ? Number(v.replace(/[,\s]/g, '')) : v),
  z.number().int().nonnegative().nullable().optional(),
);
const date = z.preprocess((v) => (v === '' ? null : v), z.union([z.string().datetime({ offset: true }), z.string().regex(/^\d{4}-\d{2}-\d{2}/)]).nullable().optional());
const tags = z.array(z.string().trim().min(1).max(40)).max(30).optional()
  .transform((t) => (t ? [...new Set(t)] : undefined));
const uuid = z.string().uuid();
const uuidOpt = z.preprocess((v) => (v === '' ? null : v), uuid.nullable().optional());

export const stageSchema = z.enum(STAGES);

export const companyFields = {
  name: z.string().trim().min(1).max(200),
  legal_name: str(200),
  website: str(300),
  phone: str(40),
  email: str(200),
  address: str(300),
  city: str(100),
  state: str(40),
  zip: str(20),
  company_type: z.enum(COMPANY_TYPES).optional(),
  stage: stageSchema.optional(),
  owner_user_id: uuidOpt,
  score: z.preprocess((v) => (v === '' ? null : v), z.number().int().min(0).max(100).nullable().optional()),
  portfolio_buildings: int,
  portfolio_units: int,
  portfolio_basis: str(300),
  est_annual_water_spend: num,
  tags,
  description: str(4000),
  linkedin_url: str(300),
  next_follow_up_at: date,
};
export const companyCreateSchema = z.object(companyFields).strict();
export const companyPatchSchema = z.object({ ...companyFields, name: companyFields.name.optional() }).strict();

export const contactFields = {
  company_id: uuidOpt,
  first_name: str(100),
  last_name: str(100),
  full_name: z.string().trim().min(1).max(200),
  title: str(200),
  role_category: z.enum(ROLE_CATEGORIES).optional(),
  is_decision_maker: z.boolean().optional(),
  email: str(200),
  email_status: z.enum(EMAIL_STATUSES).optional(),
  phone: str(40),
  mobile: str(40),
  linkedin_url: str(300),
  address: str(300),
  tags,
  notes: str(4000),
};
export const contactCreateSchema = z.object({ ...contactFields, full_name: contactFields.full_name.optional() }).strict()
  .refine((v) => v.full_name || v.first_name || v.last_name || v.email, { message: 'A name or email is required.' });
export const contactPatchSchema = z.object({ ...contactFields, full_name: contactFields.full_name.optional() }).strict();

export const propertyFields = {
  company_id: uuidOpt,
  name: str(200),
  address: z.string().trim().min(1).max(300),
  city: str(100),
  state: str(40),
  zip: str(20),
  county: str(100),
  units: int,
  buildings: int,
  year_built: int,
  stories: int,
  building_class: str(100),
  gross_sqft: int,
  assessed_value: num,
  owner_name_on_record: str(200),
  manager_name: str(200),
  utility_name: str(200),
  utility_pwsid: str(40),
  meter_status: z.enum(METER_STATUSES).optional(),
  est_annual_water_gallons: num,
  est_annual_water_cost: num,
  notes: str(4000),
};
export const propertyCreateSchema = z.object(propertyFields).strict();
export const propertyPatchSchema = z.object({ ...propertyFields, address: propertyFields.address.optional() }).strict();

export const activityCreateSchema = z.object({
  company_id: uuidOpt,
  contact_id: uuidOpt,
  property_id: uuidOpt,
  type: z.enum(MANUAL_ACTIVITY_TYPES).default('note'),
  subject: str(300),
  body: str(10000),
  occurred_at: date,
  meta: z.record(z.string(), z.unknown()).optional(),
}).strict().refine((v) => v.company_id || v.contact_id || v.property_id, { message: 'Link the activity to a company, contact or property.' })
  .refine((v) => v.subject || v.body, { message: 'Write something first.' });
export const activityPatchSchema = z.object({ subject: str(300), body: str(10000), occurred_at: date }).strict();
export const activityTypeSchema = z.enum(ACTIVITY_TYPES);

export const taskFields = {
  company_id: uuidOpt,
  contact_id: uuidOpt,
  property_id: uuidOpt,
  title: z.string().trim().min(1).max(300),
  notes: str(4000),
  type: z.enum(TASK_TYPES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  due_at: date,
  assignee_id: uuidOpt,
};
export const taskCreateSchema = z.object(taskFields).strict();
export const taskPatchSchema = z.object({ ...taskFields, title: taskFields.title.optional(), status: z.enum(['open', 'done']).optional() }).strict();

export const payableFields = {
  company_id: uuidOpt,
  property_id: uuidOpt,
  description: z.string().trim().min(1).max(300),
  amount: z.preprocess((v) => (typeof v === 'string' ? Number(v.replace(/[$,\s]/g, '')) : v), z.number().finite().min(0).max(1e10)),
  status: z.enum(PAYABLE_STATUSES).optional(),
  due_date: date,
  notes: str(2000),
};
export const payableCreateSchema = z.object(payableFields).strict();
export const payablePatchSchema = z.object({
  ...payableFields,
  description: payableFields.description.optional(),
  amount: payableFields.amount.optional(),
}).strict();

/** Drops undefined keys and strips a trailing "T.." date for date-only columns. */
export function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}
