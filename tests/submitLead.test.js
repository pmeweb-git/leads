import { afterEach, describe, expect, it, vi } from 'vitest';
import { leadsHealth, submitLead } from '../src/index.js';

const input = { host: 'www.atelier.ca', formAction: 'contact', page: '/contact/', lang: 'fr', siteName: 'Atelier', name: 'Jo Tremblay', email: 'jo@exemple.ca', phone: '514-555-0101', message: 'Une table', fields: [{ label: 'Ville', value: 'Laval' }] };
function env(answer, o = {}) {
  const sent = [];
  const calls = [];
  return {
    sent, calls,
    env: {
      LEADS: answer === undefined ? undefined : { submit: async (i) => { calls.push(i); if (answer instanceof Error) throw answer; return answer; } },
      EMAIL: { send: async (m) => { if (o.emailFails) throw new Error('x'); sent.push(m); } },
      CONTACT_TO: 'luc@atelier.ca', CONTACT_FROM: 'formulaire@atelier.ca',
    },
  };
}
afterEach(() => vi.restoreAllMocks());

describe('submitLead', () => {
  it('a field key travels with its field; the fallback email shows the label only', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const e = env({ ok: true, id: 'l', delivered: false, fallback: [] });
    await submitLead(e.env, { ...input, fields: [{ key: 'city', label: 'Ville', value: 'Laval' }] });
    expect(e.calls[0].fields).toEqual([{ key: 'city', label: 'Ville', value: 'Laval' }]);
    expect(e.sent[0].text).toContain('Ville');
    expect(e.sent[0].text).not.toContain('city');
  });
  it('a field without a key is sent without one', async () => {
    const e = env({ ok: true, id: 'l', delivered: true, fallback: [] });
    await submitLead(e.env, input);
    expect(e.calls[0].fields[0]).not.toHaveProperty('key');
  });
  it('a malformed, reserved or repeated key is dropped, the field kept, and named in the log (never a value)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const e = env({ ok: true, id: 'l', delivered: true, fallback: [] });
    const fields = [
      { key: 'Ville', label: 'A', value: 'Laval' }, { key: 42, label: 'B', value: 'b' }, { key: 'x'.repeat(41), label: 'C', value: 'c' },
      { key: 'email', label: 'D', value: 'd' }, { key: 'email_invalid', label: 'E', value: 'e' },
      { key: 'city', label: 'F', value: 'f' }, { key: 'city', label: 'G', value: 'g' },
    ];
    await submitLead(e.env, { ...input, fields });
    expect(e.calls[0].fields).toEqual([
      { label: 'A', value: 'Laval' }, { label: 'B', value: 'b' }, { label: 'C', value: 'c' },
      { label: 'D', value: 'd' }, { label: 'E', value: 'e' },
      { key: 'city', label: 'F', value: 'f' }, { label: 'G', value: 'g' },
    ]);
    const dropped = err.mock.calls.filter((c) => c[0] === '[leads] field key dropped').map((c) => c[1]);
    expect(dropped).toEqual(['malformed', 'malformed', 'malformed', 'email', 'email_invalid', 'city']);
    expect(err.mock.calls.flat().join(' ')).not.toContain('Laval');
  });
  it('an empty field does not take its key', async () => {
    const e = env({ ok: true, id: 'l', delivered: true, fallback: [] });
    await submitLead(e.env, { ...input, fields: [{ key: 'company', label: 'Entreprise', value: '  ' }, { key: 'company', label: 'Company', value: 'Acme' }] });
    expect(e.calls[0].fields).toEqual([{ key: 'company', label: 'Company', value: 'Acme' }]);
  });
  it('the portal took it: no email', async () => {
    const e = env({ ok: true, id: 'l', delivered: true, fallback: [] });
    expect(await submitLead(e.env, input)).toEqual({ ok: true, via: 'portal' });
    expect(e.calls[0]).toEqual({ rpc: 1, host: 'www.atelier.ca', source: 'form', formAction: 'contact', page: '/contact/', lang: 'fr', name: 'Jo Tremblay', email: 'jo@exemple.ca', phone: '514-555-0101', message: 'Une table', fields: [{ label: 'Ville', value: 'Laval' }], spam: false });
    expect(e.sent).toEqual([]);
  });
  it('spam: submitted, never emailed, whatever the answer', async () => {
    const e = env(new Error('down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await submitLead(e.env, { ...input, spam: true })).toEqual({ ok: true, via: 'spam' });
    expect(e.sent).toEqual([]);
  });
  it.each([
    ['no binding', undefined, '[portail indisponible] '],
    ['a throw', new Error('down'), '[portail indisponible] '],
    ['ok: false', { ok: false, error: 'unknown_site' }, '[portail indisponible] '],
    ['delivered: false', { ok: true, id: 'l', delivered: false, fallback: [] }, '[aucun destinataire vérifié] '],
  ])('%s: one fallback email, reply-to the visitor, every field', async (_n, answer, prefix) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const e = env(answer);
    expect(await submitLead(e.env, input)).toEqual({ ok: true, via: 'fallback' });
    expect(e.sent).toHaveLength(1);
    const m = e.sent[0];
    expect(m).toMatchObject({ from: { name: 'Site Atelier', email: 'formulaire@atelier.ca' }, to: 'luc@atelier.ca', replyTo: 'jo@exemple.ca' });
    expect(m.subject.startsWith(prefix)).toBe(true);
    for (const s of ['Jo Tremblay', 'jo@exemple.ca', '514-555-0101', 'Une table', 'Ville', 'Laval', '/contact/']) expect(m.text).toContain(s);
  });
  it('the fallback fails or is not configured: ok false (the route answers 502)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await submitLead(env(undefined, { emailFails: true }).env, input)).toEqual({ ok: false });
    expect(await submitLead({}, input)).toEqual({ ok: false });
  });
  it('a site\'s own fallback sender is used instead of EMAIL', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const mine = vi.fn(async () => true);
    expect(await submitLead({}, input, { fallback: mine })).toEqual({ ok: true, via: 'fallback' });
    expect(mine.mock.calls[0][0]).toMatchObject({ subject: expect.stringContaining('Jo Tremblay'), replyTo: 'jo@exemple.ca' });
  });
  it('clamps what the portal would refuse rather than losing the lead', async () => {
    const e = env({ ok: true, id: 'l', delivered: true, fallback: [] });
    await submitLead(e.env, { ...input, name: `Jo\n${'x'.repeat(300)}`, email: 'pas une adresse', page: 'https://x/y', formAction: 'Contact Form', fields: Array.from({ length: 30 }, (_, i) => ({ label: `L${i}`, value: 'v' })) });
    const sent = e.calls[0];
    expect(sent.name.length).toBeLessThanOrEqual(120);
    expect(sent.name).not.toContain('\n');
    expect(sent.email).toBeNull();
    expect(sent.page).toBeNull();
    expect(sent.formAction).toBeNull();
    expect(sent.fields).toHaveLength(20);
  });
  it('an invalid email is kept as a field, for the portal and the fallback', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const e = env({ ok: false, error: 'bad_args' });
    expect(await submitLead(e.env, { ...input, email: ' jo@exemple\n', phone: '' })).toEqual({ ok: true, via: 'fallback' });
    expect(e.calls[0].email).toBeNull();
    expect(e.calls[0].fields[0]).toEqual({ key: 'email_invalid', label: 'Courriel (non valide)', value: 'jo@exemple' });
    expect(e.sent[0].text).toContain('jo@exemple');
    expect(e.sent[0].replyTo).toBeUndefined();
    const en = env({ ok: true, id: 'l', delivered: true, fallback: [] });
    await submitLead(en.env, { ...input, lang: 'en', email: 'nope' });
    expect(en.calls[0].fields[0]).toEqual({ key: 'email_invalid', label: 'Email (invalid)', value: 'nope' });
  });
  it('an email over 200 characters is dropped whole and kept as a field, never truncated', async () => {
    const e = env({ ok: true, id: 'l', delivered: true, fallback: [] });
    const long = `${'a'.repeat(195)}@exemple.ca`;
    await submitLead(e.env, { ...input, email: long });
    expect(e.calls[0].email).toBeNull();
    expect(e.calls[0].fields[0]).toEqual({ key: 'email_invalid', label: 'Courriel (non valide)', value: long });
  });
  it('the invalid-email field counts within the 20-field cap', async () => {
    const e = env({ ok: true, id: 'l', delivered: true, fallback: [] });
    await submitLead(e.env, { ...input, email: 'x', fields: Array.from({ length: 30 }, (_, i) => ({ label: `L${i}`, value: 'v' })) });
    expect(e.calls[0].fields).toHaveLength(20);
    expect(e.calls[0].fields[0].label).toBe('Courriel (non valide)');
  });
  it('a synchronous or throwing custom fallback does not break submitLead', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await submitLead({}, input, { fallback: () => true })).toEqual({ ok: true, via: 'fallback' });
    expect(await submitLead({}, input, { fallback: () => { throw new TypeError('jo@exemple.ca'); } })).toEqual({ ok: false });
    expect(err.mock.calls.some((c) => c[0] === '[leads] custom fallback failed' && c[1] === 'TypeError')).toBe(true);
    expect(err.mock.calls.flat().join(' ')).not.toContain('jo@');
  });
  it('logs the error name only, never the visitor', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await submitLead(env(new TypeError('jo@exemple.ca')).env, input);
    expect(err.mock.calls.flat().join(' ')).not.toMatch(/jo@|Jo Tremblay|Une table/);
  });
});

describe('leadsHealth', () => {
  it('says whether the binding exists', () => {
    expect(leadsHealth({ LEADS: {} })).toEqual({ leads: true });
    expect(leadsHealth({})).toEqual({ leads: false });
  });
});
