'use client';

import type { FeatureRequestResolutionType } from '@/models/Schema';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useForm } from 'react-hook-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { FeatureRequestResolution } from '@/models/Schema';
import { CreateFeatureRequestSchema } from '@/types/FeatureRequest';

type FeatureRequestItem = {
  id: string;
  title: string;
  description: string;
  resolution: FeatureRequestResolutionType;
  createdAt: string;
  updatedAt: string;
};

type FeatureRequestsGetResponse = {
  requests: FeatureRequestItem[];
};

type FeatureRequestPostResponse = {
  request: FeatureRequestItem;
};

type FormData = {
  title: string;
  description: string;
};

const ACTIVE_RESOLUTIONS = new Set<string>([
  FeatureRequestResolution.SENT,
  FeatureRequestResolution.IN_REVIEW,
]);
const MAX_ACTIVE_REQUESTS = 3;

export function FeatureRequestCenter() {
  const t = useTranslations('Settings.help_faq');
  const [requests, setRequests] = useState<FeatureRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const form = useForm<FormData>({
    resolver: zodResolver(CreateFeatureRequestSchema),
    defaultValues: {
      title: '',
      description: '',
    },
  });

  const activeRequestsCount = useMemo(
    () => requests.filter(request => ACTIVE_RESOLUTIONS.has(request.resolution)).length,
    [requests],
  );
  const isLimitReached = activeRequestsCount >= MAX_ACTIVE_REQUESTS;

  const fetchRequests = useCallback(async () => {
    try {
      setLoadError(null);
      const response = await fetch('/api/feature-requests');
      if (!response.ok) {
        throw new Error('REQUESTS_LOAD_FAILED');
      }
      const data = await response.json() as FeatureRequestsGetResponse;
      setRequests(data.requests);
    } catch {
      setLoadError(t('my_requests.load_error'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  const onSubmit = async (data: FormData) => {
    setSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(false);

    try {
      const response = await fetch('/api/feature-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (response.status === 409) {
        setSubmitError(t('request_feature.limit_error', { limit: MAX_ACTIVE_REQUESTS }));
        return;
      }

      if (!response.ok) {
        throw new Error('CREATE_FAILED');
      }

      const payload = await response.json() as FeatureRequestPostResponse;
      setRequests(prev => [payload.request, ...prev]);
      form.reset({ title: '', description: '' });
      setSubmitSuccess(true);
    } catch {
      setSubmitError(t('request_feature.submit_error'));
    } finally {
      setSubmitting(false);
    }
  };

  const getResolutionLabel = (resolution: string) => {
    switch (resolution) {
      case FeatureRequestResolution.SENT:
        return t('resolutions.sent');
      case FeatureRequestResolution.IN_REVIEW:
        return t('resolutions.in_review');
      case FeatureRequestResolution.ACCEPTED:
        return t('resolutions.accepted');
      case FeatureRequestResolution.REJECTED:
        return t('resolutions.rejected');
      default:
        return resolution;
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border p-4">
        <div className="mb-3 text-sm text-muted-foreground">
          {t('request_feature.limit_hint', {
            active: activeRequestsCount,
            limit: MAX_ACTIVE_REQUESTS,
          })}
        </div>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('request_feature.title_label')}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder={t('request_feature.title_placeholder')}
                      disabled={submitting || isLimitReached}
                      maxLength={140}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('request_feature.description_label')}</FormLabel>
                  <FormControl>
                    <textarea
                      {...field}
                      rows={5}
                      maxLength={4000}
                      placeholder={t('request_feature.description_placeholder')}
                      disabled={submitting || isLimitReached}
                      className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {submitError && (
              <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
                {submitError}
              </div>
            )}

            {submitSuccess && (
              <div className="rounded-md bg-emerald-500/15 p-3 text-sm text-emerald-600 dark:text-emerald-400">
                {t('request_feature.submit_success')}
              </div>
            )}

            <Button
              type="submit"
              disabled={submitting || isLimitReached}
              className="min-h-[44px] w-full sm:w-auto"
            >
              {submitting
                ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      {t('request_feature.submitting')}
                    </>
                  )
                : (
                    <>
                      <Send className="mr-2 size-4" />
                      {t('request_feature.submit')}
                    </>
                  )}
            </Button>
          </form>
        </Form>
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold">{t('my_requests.title')}</h3>

        {loading && (
          <div className="flex items-center gap-2 rounded-lg border p-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t('my_requests.loading')}
          </div>
        )}

        {!loading && loadError && (
          <div className="rounded-lg border border-destructive/40 p-4 text-sm text-destructive">
            {loadError}
          </div>
        )}

        {!loading && !loadError && requests.length === 0 && (
          <div className="rounded-lg border p-4 text-sm text-muted-foreground">
            {t('my_requests.empty')}
          </div>
        )}

        {!loading && !loadError && requests.map(request => (
          <div key={request.id} className="rounded-lg border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="font-medium">{request.title}</h4>
              <Badge variant="outline">{getResolutionLabel(request.resolution)}</Badge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{request.description}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              {t('my_requests.submitted_at', {
                date: new Date(request.createdAt).toLocaleString(),
              })}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
