import { useTranslations } from 'next-intl';

/**
 * Public connection details for the MCP server.
 *
 * The client ID is not a secret — OAuth sends it in the authorization URL, so
 * it is visible to anyone who starts the flow. The client secret is never
 * published; the connector uses PKCE and does not need one.
 */
const MCP_SERVER_URL = 'https://www.migraine.club/api/mcp';
const MCP_CLIENT_ID = 'LlUMuWLF7MHotG0V';

function Field(props: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/40 p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {props.label}
      </div>
      <code className="mt-1 block break-all font-mono text-sm">{props.value}</code>
    </div>
  );
}

function Step(props: { index: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
      >
        {props.index}
      </span>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">{props.title}</h3>
        <div className="text-sm leading-relaxed text-muted-foreground">{props.children}</div>
      </div>
    </li>
  );
}

export function AiConnectorGuide() {
  const t = useTranslations('HelpAiConnector');

  return (
    <div className="space-y-10">
      <header className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">{t('eyebrow')}</p>
        <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-base leading-relaxed text-muted-foreground">{t('intro')}</p>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t('what_title')}</h2>
        <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-muted-foreground">
          <li>{t('what_read')}</li>
          <li>{t('what_write')}</li>
          <li>{t('what_never_delete')}</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t('before_title')}</h2>
        <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-muted-foreground">
          <li>{t('before_account')}</li>
          <li>{t('before_consent')}</li>
          <li>{t('before_claude')}</li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">{t('details_title')}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('field_url')} value={MCP_SERVER_URL} />
          <Field label={t('field_client_id')} value={MCP_CLIENT_ID} />
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">{t('field_secret_note')}</p>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">{t('steps_title')}</h2>
        <ol className="space-y-5">
          <Step index={1} title={t('step1_title')}>{t('step1_body')}</Step>
          <Step index={2} title={t('step2_title')}>{t('step2_body')}</Step>
          <Step index={3} title={t('step3_title')}>{t('step3_body')}</Step>
          <Step index={4} title={t('step4_title')}>{t('step4_body')}</Step>
          <Step index={5} title={t('step5_title')}>{t('step5_body')}</Step>
        </ol>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t('try_title')}</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">{t('try_intro')}</p>
        <ul className="space-y-2 text-sm">
          <li className="rounded-lg border bg-muted/40 px-3 py-2 italic">{t('try_example_read')}</li>
          <li className="rounded-lg border bg-muted/40 px-3 py-2 italic">{t('try_example_log')}</li>
          <li className="rounded-lg border bg-muted/40 px-3 py-2 italic">{t('try_example_insight')}</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t('privacy_title')}</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">{t('privacy_body')}</p>
        <p className="text-sm leading-relaxed text-muted-foreground">{t('privacy_revoke')}</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t('trouble_title')}</h2>
        <dl className="space-y-3 text-sm leading-relaxed">
          <div>
            <dt className="font-medium">{t('trouble_consent_title')}</dt>
            <dd className="text-muted-foreground">{t('trouble_consent_body')}</dd>
          </div>
          <div>
            <dt className="font-medium">{t('trouble_nothing_title')}</dt>
            <dd className="text-muted-foreground">{t('trouble_nothing_body')}</dd>
          </div>
          <div>
            <dt className="font-medium">{t('trouble_stale_title')}</dt>
            <dd className="text-muted-foreground">{t('trouble_stale_body')}</dd>
          </div>
        </dl>
      </section>

      <p className="border-t pt-6 text-xs leading-relaxed text-muted-foreground">
        {t('disclaimer')}
      </p>
    </div>
  );
}
