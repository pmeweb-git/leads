# @pmeweb/leads

The one way a PmeWeb site hands a request form's submission (contact, quote, appointment) to the
portal's leads foundation. The portal stores the request, delivers it to the people the client
chose, on the channels each chose, and deletes it 12 months after it arrived.

When the portal does not take the request, the site emails it itself, so a request is never lost.

## The binding

In the site's `wrangler.jsonc`:

```jsonc
"services": [
  { "binding": "LEADS", "service": "pmeweb-portail", "entrypoint": "LeadsApi" }
]
```

## The call

In the form's worker route, AFTER Turnstile, the honeypot and the site's own validation:

```js
import { submitLead } from '@pmeweb/leads';

const r = await submitLead(env, {
  host: new URL(request.url).host,  // the host the visitor used
  formAction: 'contact',            // the form's Turnstile action
  page: '/contact/',                // the page as served, a path
  lang: 'fr',
  siteName: 'Atelier Boisclair',    // the fallback email's From name: « Site <siteName> »
  name, email, phone, message,
  fields: [{ label: 'Ville', value: ville }], // every other field, labelled as the form shows it
  spam: false,                      // true when the site's own filter judged it spam
});
return r.ok ? json({ ok: true }, 200) : json({ ok: false, error: 'unavailable' }, 502);
```

`r` is `{ ok: true, via: 'portal' | 'fallback' | 'spam' }` or `{ ok: false }` (the portal did not
take it AND the fallback email failed: the route answers 502 so the visitor knows to call).

Every value is clamped to what `LeadsApi` accepts (a name of 120 characters, one line; an email of
200 that looks like one, else `null`; a phone of 40; a message of 5 000; a page that is a path of
300; at most 20 fields, labels of 80, values of 2 000). A value the portal would refuse is cut or
dropped rather than losing the request. A form with neither a valid email nor a phone is still
refused by the portal; it then goes out by the fallback.

**Never send a newsletter signup through it.** It is for requests a person answers.

## The fallback

When the portal does not take the request (no `LEADS` binding, a throw, `ok: false`, or
`delivered: false` because nobody can receive it), the site emails it, reply-to the visitor, with
every field:

- subject « [portail indisponible] … » when the portal did not answer or refused it;
- subject « [aucun destinataire vérifié] … » when it stored it but nobody can receive it.

By default the email goes through Cloudflare Email Sending: the `EMAIL` binding (`send_email`),
from `CONTACT_FROM` to `CONTACT_TO`. A site whose recipient is a constant, or which sends another
way, passes its own sender:

```js
await submitLead(env, input, {
  fallback: async (mail) => { /* mail: { subject, text, replyTo?, siteName } */ return true; },
});
```

It returns `true` when the email left. A request the SITE flagged as spam is submitted (the client
sees it in « Indésirables ») and never emailed.

Nothing here logs the visitor's data: error names and codes only.

## Form health

`leadsHealth(env)` answers `{ leads: true | false }` (whether the binding exists), for the site's
signed form-health route (`@pmeweb/turnstile` `handleFormHealth`).

## The privacy page

Every site using it states, in its « Conservation » paragraph:

> Les demandes envoyées par un formulaire de ce site sont conservées dans le portail de PmeWeb,
> notre fournisseur web, 12 mois après leur réception, puis supprimées; vous pouvez en demander la
> suppression avant. Nous en sommes avisés par courriel ou par texto (voip.ms, Montréal).

> Requests sent through a form on this site are kept in the portal of PmeWeb, our web provider,
> for 12 months after they arrive, then deleted; you may ask for their deletion sooner. We are
> notified by email or by text message (voip.ms, Montréal).

It names voip.ms on every site, whatever the client's settings: a built page cannot follow a
setting the client changes in the portal.

## The RPC version

Every call carries `rpc: 1` (`LEADS_RPC`). The versions the portal accepts are in its
`plugin-rpc.json` under `leads`. Run `node scripts/plugin-status.mjs` from the workspace before
changing anything this package sends or reads.
