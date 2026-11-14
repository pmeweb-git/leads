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
