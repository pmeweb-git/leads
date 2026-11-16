export interface LeadsBinding {
  submit(input: unknown): Promise<{ ok: true; id: string; delivered: boolean; fallback: string[] } | { ok: false; error: string }>;
}
export interface LeadsEnv {
  LEADS?: LeadsBinding;
  EMAIL?: { send(m: unknown): Promise<unknown> };
  CONTACT_TO?: string;
  CONTACT_FROM?: string;
}
export interface LeadField {
  /**
   * The field's stable name, the same in every language of the form (`^[a-z][a-z0-9_]{0,39}$`), from the
   * README's « Field keys » vocabulary when one fits. Never `name`, `email`, `phone`, `message`,
   * `email_invalid` or `phone_invalid`. A malformed, reserved or repeated key is dropped (the field is kept).
   */
  key?: string;
  /** What the form shows, in the page's language. */
  label: string;
  value: string;
}
export interface LeadInput {
  /** `new URL(request.url).host`: the host the visitor used. */
  host: string;
  /** The form's Turnstile action. One that is not `^[a-z0-9-]{1,40}$` is sent as `null`. */
  formAction: string;
  page?: string | null;
  lang: 'fr' | 'en';
  /** The site's name, for the fallback email's From name (« Site <siteName> »). */
  siteName: string;
  name: string;
  /** One that is over 200 characters or not an address is sent as `null` and kept, as typed, as the first field (« Courriel (non valide) » / « Email (invalid) »). */
  email?: string | null;
  phone?: string | null;
  message?: string | null;
  /** Every other field, labelled as the form shows it, keyed by its stable name. */
  fields?: LeadField[];
  /** The site's own filter judged it spam: stored in « Indésirables », never emailed. */
  spam?: boolean;
}
export interface FallbackMail { subject: string; text: string; replyTo?: string; siteName: string }
export interface SubmitOptions { fallback?: (mail: FallbackMail) => Promise<boolean> }
export type SubmitResult = { ok: true; via: 'portal' | 'fallback' | 'spam' } | { ok: false };
export const LEADS_RPC: 1;
export function submitLead(env: LeadsEnv, input: LeadInput, options?: SubmitOptions): Promise<SubmitResult>;
export function leadsHealth(env: LeadsEnv): { leads: boolean };
