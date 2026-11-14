// @pmeweb/leads: a PmeWeb site's request form hands its submission to the portal's leads foundation
// (websites docs/superpowers/specs/2026-11-14-leads-foundation-design.md § 5, § 9). The portal stores
// it, delivers it to the client's chosen recipients and keeps it 12 months.
//
// THE FALLBACK (hub spec D12): when the portal does not take the lead (no LEADS binding, a throw, an
// `ok: false`, or `delivered: false` because nobody can receive it), the site emails it itself, as
// before the foundation, subject « [portail indisponible] » or « [aucun destinataire vérifié] ». A
// lead the SITE flagged as spam is never emailed. Nothing here logs the visitor's data: error names
// and codes only.
//
// Values are clamped to what LeadsApi accepts (worker/leadsApiEntrypoint.ts in pmeweb-portail):
// losing a lead to a 121-character name would be the worst trade.
export const LEADS_RPC = 1;
const NB = '\u00a0';
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/;
const oneLine = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
const cut = (s, n) => (s.length > n ? s.slice(0, n) : s);
const ACTION_RE = /^[a-z0-9-]{1,40}$/;

function clean(i) {
  const lang = i.lang === 'en' ? 'en' : 'fr';
  // An email over 200 characters or that does not look like one is never truncated into a valid
  // shape: it is dropped from `email` and kept, as typed, as the first field, so the portal and the
  // fallback email still carry the contact the visitor gave.
  const rawEmail = oneLine(i.email);
  const email = rawEmail.length <= 200 && EMAIL_RE.test(rawEmail) ? rawEmail : null;
  const badEmail = rawEmail && !email
    ? [{ label: lang === 'en' ? 'Email (invalid)' : 'Courriel (non valide)', value: cut(rawEmail, 2000) }]
    : [];
  const page = typeof i.page === 'string' && i.page.startsWith('/') ? cut(i.page, 300) : null;
  return {
    rpc: LEADS_RPC, host: i.host, source: 'form',
    formAction: typeof i.formAction === 'string' && ACTION_RE.test(i.formAction) ? i.formAction : null, page, lang,
    name: cut(oneLine(i.name), 120) || '?',
    email,
    phone: cut(oneLine(i.phone), 40) || null,
    message: i.message ? cut(String(i.message).trim(), 5000) : null,
    fields: [...badEmail, ...(Array.isArray(i.fields) ? i.fields : [])
      .map((f) => ({ label: cut(oneLine(f?.label), 80), value: cut(String(f?.value ?? '').trim(), 2000) }))
      .filter((f) => f.label && f.value)].slice(0, 20),
    spam: i.spam === true,
  };
}

function fallbackMail(i, v, delivered) {
  const fr = v.lang !== 'en';
  const sep = fr ? `${NB}:` : ':';
  const prefix = delivered === false ? '[aucun destinataire vérifié] ' : '[portail indisponible] ';
  const head = [
    `${fr ? 'Nom' : 'Name'}${sep} ${v.name}`,
    v.email ? `${fr ? 'Courriel' : 'Email'}${sep} ${v.email}` : '',
    v.phone ? `${fr ? 'Téléphone' : 'Phone'}${sep} ${v.phone}` : '',
    ...v.fields.map((f) => `${f.label}${sep} ${f.value}`),
    v.page ? `Page${sep} ${v.page}` : '',
  ].filter(Boolean);
  const lines = v.message ? [...head, '', v.message] : head;
  return {
    subject: `${prefix}${fr ? `Site web${NB}: demande de` : 'Website: request from'} ${v.name}`,
    text: lines.join('\n'),
    replyTo: v.email ?? undefined,
    siteName: i.siteName,
  };
}

/** The default fallback: Cloudflare Email Sending, from CONTACT_FROM to CONTACT_TO. */
async function emailSending(env, mail) {
  if (!env.EMAIL || !env.CONTACT_TO || !env.CONTACT_FROM) return false;
  try {
    await env.EMAIL.send({
      from: { name: `Site ${mail.siteName}`, email: env.CONTACT_FROM }, to: env.CONTACT_TO,
      subject: mail.subject, text: mail.text, ...(mail.replyTo ? { replyTo: mail.replyTo } : {}),
    });
    return true;
  } catch (e) {
    console.error('[leads] fallback email failed', e instanceof Error ? e.name : 'unknown');
    return false;
  }
}

export async function submitLead(env, input, options = {}) {
  const v = clean(input);
  let answer = null;
  if (env.LEADS) {
    try {
      answer = await env.LEADS.submit(v);
    } catch (e) {
      console.error('[leads] LeadsApi.submit failed', e instanceof Error ? e.name : 'unknown');
    }
  } else {
    console.error('[leads] no LEADS binding');
  }
  if (v.spam) return { ok: true, via: 'spam' };
  if (answer && answer.ok === true && answer.delivered === true) return { ok: true, via: 'portal' };
  if (answer && answer.ok === false) console.error('[leads] LeadsApi refused', answer.error);
  const mail = fallbackMail(input, v, answer && answer.ok === true ? answer.delivered : undefined);
  const sent = options.fallback
    ? await Promise.resolve().then(() => options.fallback(mail)).catch((e) => {
      console.error('[leads] custom fallback failed', e instanceof Error ? e.name : 'unknown');
      return false;
    })
    : await emailSending(env, mail);
  return sent ? { ok: true, via: 'fallback' } : { ok: false };
}

/** For the site's signed form-health route (@pmeweb/turnstile handleFormHealth `checks`). */
export function leadsHealth(env) {
  return { leads: Boolean(env.LEADS) };
}
