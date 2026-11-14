export interface LeadsBinding {
  submit(input: unknown): Promise<{ ok: true; id: string; delivered: boolean; fallback: string[] } | { ok: false; error: string }>;
}
export interface LeadsEnv {
  LEADS?: LeadsBinding;
  EMAIL?: { send(m: unknown): Promise<unknown> };
  CONTACT_TO?: string;
  CONTACT_FROM?: string;
}
export interface LeadInput {
  /** `new URL(request.url).host`: the host the visitor used. */
  host: string;
  /** The form's Turnstile action. */
  formAction: string;
  page?: string | null;
  lang: 'fr' | 'en';
  /** The site's name, for the fallback email's From name (« Site <siteName> »). */
  siteName: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  message?: string | null;
  /** Every other field, labelled as the form shows it. */
  fields?: { label: string; value: string }[];
  /** The site's own filter judged it spam: stored in « Indésirables », never emailed. */
  spam?: boolean;
}
export interface FallbackMail { subject: string; text: string; replyTo?: string; siteName: string }
export interface SubmitOptions { fallback?: (mail: FallbackMail) => Promise<boolean> }
export type SubmitResult = { ok: true; via: 'portal' | 'fallback' | 'spam' } | { ok: false };
export const LEADS_RPC: 1;
export function submitLead(env: LeadsEnv, input: LeadInput, options?: SubmitOptions): Promise<SubmitResult>;
export function leadsHealth(env: LeadsEnv): { leads: boolean };
