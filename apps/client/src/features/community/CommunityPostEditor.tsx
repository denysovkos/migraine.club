'use client';

import type { Episode } from '@/types/Episode';
import { BookOpen, Eye, EyeOff, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreateCommunityPost } from '@/hooks/useCommunity';
import { cn } from '@/utils/Helpers';
import { normalizeToPainLevel, painLevelDisplay } from '@/utils/painLevel';

const AVAILABLE_TAGS = [
  'Episode story',
  'Trigger',
  'Medication',
  'Advice',
  'Weather',
  'Work',
  'Stress',
  'Sleep',
];

type CommunityPostEditorProps = {
  episode?: Episode | null;
  onSuccess?: (postId: string) => void;
  onCancel?: () => void;
};

export function CommunityPostEditor({
  episode,
  onSuccess,
  onCancel,
}: CommunityPostEditorProps) {
  const t = useTranslations('Community');
  const tEpisode = useTranslations('EpisodeForm');
  const router = useRouter();
  const { createPost, loading, error } = useCreateCommunityPost();

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(true);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  // Pre-fill when sharing an episode
  useEffect(() => {
    if (episode) {
      const date = new Date(episode.startTime).toLocaleDateString();
      setTitle(t('episode_share_title', { date }));

      // Build episode summary
      const parts: string[] = [];

      // Duration
      if (episode.endTime) {
        const start = new Date(episode.startTime);
        const end = new Date(episode.endTime);
        const durationHours = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60));
        if (durationHours > 0) {
          parts.push(t('episode_share_duration', { duration: `${durationHours}h` }));
        }
      } else if (episode.isOngoing) {
        parts.push(t('episode_share_duration', { duration: 'Ongoing' }));
      }

      // Intensity
      const level = normalizeToPainLevel(episode.intensity);
      parts.push(t('episode_share_intensity', { intensity: level ? painLevelDisplay(level) : '—' }));

      // Triggers
      if (episode.triggers && episode.triggers.length > 0) {
        const triggerLabels = episode.triggers.map(tr =>
          tEpisode(`trigger_${tr.toLowerCase()}` as any),
        );
        parts.push(t('episode_share_triggers', { triggers: triggerLabels.join(', ') }));
      }

      // Symptoms
      if (episode.symptoms && episode.symptoms.length > 0) {
        const symptomLabels = episode.symptoms.map(s =>
          tEpisode(`symptom_${s.toLowerCase()}` as any),
        );
        parts.push(t('episode_share_symptoms', { symptoms: symptomLabels.join(', ') }));
      }

      // Medications
      if (episode.medicationIntakes && episode.medicationIntakes.length > 0) {
        const medNames = [...new Set(episode.medicationIntakes.map(m => m.label).filter(Boolean))];
        if (medNames.length > 0) {
          parts.push(t('episode_share_medications', { medications: medNames.join(', ') }));
        }
      }

      // Notes
      if (episode.notes) {
        parts.push(`\n\n${episode.notes}`);
      }

      setBody(parts.join('\n'));
      setSelectedTags(['Episode story']);
    }
  }, [episode, t, tEpisode]);

  const toggleTag = (tag: string) => {
    setSelectedTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim() || !body.trim()) {
      return;
    }

    try {
      const post = await createPost({
        title: title.trim(),
        body: body.trim(),
        isAnonymous,
        tags: selectedTags,
        episodeId: episode?.id,
      });

      if (post) {
        onSuccess?.(post.id);
        router.push(`/dashboard/community/${post.id}`);
      }
    } catch {
      // Error is handled by the hook
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Episode context banner */}
      {episode && (
        <div className="flex items-start gap-3 rounded-lg border bg-primary/5 p-3">
          <BookOpen className="mt-0.5 size-5 text-primary" />
          <div className="flex-1">
            <p className="text-sm font-medium">{t('editor_episode_context')}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {new Date(episode.startTime).toLocaleDateString()}
              {' '}
              •
              {' '}
              {t('episode_share_intensity', { intensity: episode.intensity })}
            </p>
          </div>
        </div>
      )}

      {/* Title */}
      <div className="space-y-2">
        <Label htmlFor="post-title">{t('editor_title_label')}</Label>
        <Input
          id="post-title"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder={t('editor_title_placeholder')}
          maxLength={140}
          required
        />
      </div>

      {/* Body */}
      <div className="space-y-2">
        <Label htmlFor="post-body">{t('editor_body_label')}</Label>
        <textarea
          id="post-body"
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder={t('editor_body_placeholder')}
          rows={6}
          maxLength={8000}
          required
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        />
        <p className="text-xs text-muted-foreground">
          {body.length}
          /8000
        </p>
      </div>

      {/* Tags */}
      <div className="space-y-2">
        <Label>{t('editor_tags_label')}</Label>
        <div className="flex flex-wrap gap-2">
          {AVAILABLE_TAGS.map(tag => (
            <Badge
              key={tag}
              variant={selectedTags.includes(tag) ? 'default' : 'outline'}
              className={cn(
                'cursor-pointer transition-colors',
                selectedTags.includes(tag)
                  ? 'bg-primary hover:bg-primary/90'
                  : 'hover:bg-muted',
              )}
              onClick={() => toggleTag(tag)}
            >
              {tag}
              {selectedTags.includes(tag) && <X className="ml-1 size-3" />}
            </Badge>
          ))}
        </div>
      </div>

      {/* Anonymity toggle */}
      <div className="rounded-lg border p-4">
        {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={isAnonymous}
            onChange={e => setIsAnonymous(e.target.checked)}
            className="mt-1 size-4 rounded border-gray-300"
          />
          <div className="flex-1">
            <div className="flex items-center gap-2 font-medium">
              {isAnonymous ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              <span>{t('post_as_anonymous')}</span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {isAnonymous ? t('anonymous_on_help') : t('anonymous_off_help')}
            </p>
          </div>
        </label>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <Button type="submit" disabled={loading || !title.trim() || !body.trim()}>
          {loading ? t('sharing') : t('share_to_community')}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('cancel_button')}
          </Button>
        )}
      </div>
    </form>
  );
}
