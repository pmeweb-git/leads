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
  fields: [{ key: 'city', label: 'Ville', value: ville }], // every other field: its key, its label as shown
  spam: false,                      // true when the site's own filter judged it spam
});
return r.ok ? json({ ok: true }, 200) : json({ ok: false, error: 'unavailable' }, 502);
```

`r` is `{ ok: true, via: 'portal' | 'fallback' | 'spam' }` or `{ ok: false }` (the portal did not
take it AND the fallback email failed: the route answers 502 so the visitor knows to call).

Every value is clamped to what `LeadsApi` accepts (a name of 120 characters, one line; an email of
at most 200 that looks like one, else `null` with what the visitor typed kept as the first
field, « Courriel (non valide) » / « Email (invalid) », never truncated; a phone of 40; a message of 5 000; a page that is a path of
300; at most 20 fields, labels of 80, values of 2 000). A value the portal would refuse is cut or
dropped rather than losing the request. A form with neither a valid email nor a phone is still
refused by the portal; it then goes out by the fallback.

## Field keys

Every field carries a `key`: its stable name, the SAME in every language and wording of the form, so the
portal can count and compare it (« Entreprise » on `/contact/` and « Company » on `/en/contact/` are both
`company`). Write it in the one object that builds the field, beside the label:

```js
fields: [
  { key: 'company', label: lang === 'en' ? 'Company' : 'Entreprise', value: company },
  { key: 'service', label: lang === 'en' ? 'Type of work' : 'Type de travaux', value: work },
],
```

- `^[a-z][a-z0-9_]{0,39}$`; never derived from the label; one key per thing the form asks, and the same key
  on every form of the site that asks it.
- Use the vocabulary's key when one fits; a site adds its own otherwise (snake_case English, named after
  what is asked, not how).
- A key names the FIELD. The value stays what the visitor typed or picked, in the page's language.
- Reserved, never a site's: `name`, `email`, `phone`, `message` (the lead's own columns), `email_invalid`,
  `phone_invalid` (the package and the portal key the « Courriel (non valide) » / « Téléphone (non valide) »
  fields themselves).
- A malformed, reserved or repeated key is dropped and the field kept (`[leads] field key dropped` in the
  log). The site's handler test asserts the keys.

| Key | The field | Labels seen |
|---|---|---|
| `company` | the visitor's company or organisation | Entreprise / Company |
| `role` | the visitor's job title | Fonction / Role |
| `subject` | the topic picked for the message | Sujet, Type de demande / Subject |
| `service` | which of the business's services, kind of work or project is asked for | Type de travaux, Type de projet / Type of work |
| `city` | the visitor's or the job's city | Ville / City |
| `address` | a street address | Adresse / Address |
| `budget` | the budget the visitor gives | Budget |
| `timeline` | when the work should happen | Échéancier, Délai / Timeline |
| `preferred_date` | a date or time the visitor asks for | Date souhaitée / Preferred date |
| `how_heard` | how the visitor heard of the business | Comment nous avez-vous connus / How did you hear about us |

A key is additive: a portal that predates it ignores it, and `rpc` stays 1.

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

## Versions

- **1.1.0**: a field may carry a `key` (« Field keys »); the invalid-email field is keyed `email_invalid`.
  Additive, `rpc` 1.
- **1.0.0**: `submitLead`, `leadsHealth`, the fallback email.
