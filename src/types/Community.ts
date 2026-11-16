import { z } from 'zod';

// Visibility enums for posts and comments
export const CommunityVisibility = {
  PUBLIC: 'PUBLIC',
  HIDDEN: 'HIDDEN',
  DELETED: 'DELETED',
} as const;

export type CommunityVisibilityType = keyof typeof CommunityVisibility;

// Report reason enum matching schema
export const ReportReasonEnum = {
  SPAM: 'spam',
  ABUSE: 'abuse',
  MISINFORMATION: 'misinformation',
  OTHER: 'other',
} as const;

export type ReportReasonType = (typeof ReportReasonEnum)[keyof typeof ReportReasonEnum];

// Report status enum
export const ReportStatusEnum = {
  OPEN: 'OPEN',
  RESOLVED: 'RESOLVED',
  DISMISSED: 'DISMISSED',
} as const;

export type ReportStatusType = (typeof ReportStatusEnum)[keyof typeof ReportStatusEnum];

// User role enum
export const UserRoleEnum = {
  USER: 'user',
  MODERATOR: 'moderator',
  ADMIN: 'admin',
  // Doctor account lifecycle (Feature F13)
  DOCTOR_PENDING: 'doctor_pending',
  DOCTOR_VERIFIED: 'doctor_verified',
  DOCTOR_REJECTED: 'doctor_rejected',
} as const;

export type UserRoleType = (typeof UserRoleEnum)[keyof typeof UserRoleEnum];

// Core create/update schemas
export const CreateCommunityPostSchema = z.object({
  title: z.string().min(3).max(140),
  body: z.string().min(1).max(8000),
  isAnonymous: z.boolean().default(true),
  tags: z.array(z.string().min(1).max(32)).max(8).optional(),
  episodeId: z.number().int().positive().optional(),
});

export type CreateCommunityPostInput = z.infer<typeof CreateCommunityPostSchema>;

export const ListCommunityPostsQuerySchema = z.object({
  page: z
    .number()
    .int()
    .min(1)
    .default(1),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(10),
  sort: z.enum(['new', 'top']).default('new'),
  tag: z.string().max(32).optional(),
  onlyOwn: z.boolean().default(false),
});

export type ListCommunityPostsQuery = z.infer<typeof ListCommunityPostsQuerySchema>;

export const VoteValueSchema = z.union([
  z.literal(-1),
  z.literal(0),
  z.literal(1),
]);

export type VoteValue = z.infer<typeof VoteValueSchema>;

export const VoteOnPostSchema = z.object({
  value: VoteValueSchema,
});

export type VoteOnPostInput = z.infer<typeof VoteOnPostSchema>;

export const CreateCommunityCommentSchema = z.object({
  postId: z.string().guid(),
  parentCommentId: z.string().guid().optional(),
  body: z.string().min(1).max(4000),
  isAnonymous: z.boolean().default(true),
});

export type CreateCommunityCommentInput = z.infer<
  typeof CreateCommunityCommentSchema
>;

export const CreateCommunityReportSchema = z
  .object({
    postId: z.string().guid().optional(),
    commentId: z.string().guid().optional(),
    reason: z.enum(['spam', 'abuse', 'misinformation', 'other']),
    details: z.string().max(2000).optional(),
  })
  .refine(
    (data) => {
      const hasPost = !!data.postId;
      const hasComment = !!data.commentId;
      return (hasPost || hasComment) && !(hasPost && hasComment);
    },
    {
      message: 'Either postId or commentId must be provided (but not both)',
      path: ['postId'],
    },
  );

export type CreateCommunityReportInput = z.infer<
  typeof CreateCommunityReportSchema
>;

// Moderation action schemas
export const UpdateContentVisibilitySchema = z.object({
  postId: z.string().guid().optional(),
  commentId: z.string().guid().optional(),
  visibility: z.enum(['PUBLIC', 'HIDDEN']),
}).refine(
  (data) => {
    const hasPost = !!data.postId;
    const hasComment = !!data.commentId;
    return (hasPost || hasComment) && !(hasPost && hasComment);
  },
  {
    message: 'Either postId or commentId must be provided (but not both)',
    path: ['postId'],
  },
);

export type UpdateContentVisibilityInput = z.infer<typeof UpdateContentVisibilitySchema>;

export const ResolveReportSchema = z.object({
  reportId: z.string().guid(),
  status: z.enum(['RESOLVED', 'DISMISSED']),
});

export type ResolveReportInput = z.infer<typeof ResolveReportSchema>;

export const UpdateUserRoleSchema = z.object({
  userId: z.string(),
  // Intentionally limited to moderation roles; doctor roles are managed via verification workflow.
  role: z.enum(['user', 'moderator', 'admin']),
});

export type UpdateUserRoleInput = z.infer<typeof UpdateUserRoleSchema>;

// Domain / API DTOs

export type CommunityAuthorPublic = {
  displayName: string | null;
  // Legacy fields used throughout the UI; backed by server-side role checks (Feature F13).
  isDoctor: boolean;
  isDoctorVerified: boolean;
  // New: specialty label for verified doctors (never exposes license numbers).
  doctorSpecialty?: 'neurologist' | 'gp' | 'pain_specialist' | 'other' | null;
  isAnonymous: boolean;
};

export type CommunityPostSummary = {
  id: string;
  title: string;
  bodyPreview: string;
  score: number;
  tags: string[];
  isFromEpisode: boolean;
  episodeId: number | null;
  createdAt: string;
  author: CommunityAuthorPublic;
  viewerVote: VoteValue;
  commentCount: number;
  isMine: boolean;
  // Moderation fields (only visible to moderators/admins)
  visibility?: CommunityVisibilityType;
  reportCount?: number;
};

export type CommunityComment = {
  id: string;
  postId: string;
  parentCommentId: string | null;
  body: string;
  createdAt: string;
  author: CommunityAuthorPublic;
  // Moderation fields (only visible to moderators/admins)
  visibility?: CommunityVisibilityType;
  isMine?: boolean;
};

export type CommunityPostDetail = {
  id: string;
  title: string;
  body: string;
  score: number;
  tags: string[];
  isFromEpisode: boolean;
  episodeId: number | null;
  createdAt: string;
  updatedAt: string;
  author: CommunityAuthorPublic;
  viewerVote: VoteValue;
  comments: CommunityComment[];
  // Moderation fields (only visible to moderators/admins)
  visibility?: CommunityVisibilityType;
  reportCount?: number;
};

// Report DTO for moderation dashboard
export type CommunityReportSummary = {
  id: string;
  postId: string | null;
  commentId: string | null;
  reason: ReportReasonType;
  details: string | null;
  status: ReportStatusType;
  createdAt: string;
  // Related content snippet
  contentSnippet: string;
  contentType: 'post' | 'comment';
  contentAuthor: CommunityAuthorPublic;
};

// Hidden content item for moderation dashboard
export type HiddenContentItem = {
  id: string;
  type: 'post' | 'comment';
  title?: string; // only for posts
  bodySnippet: string;
  author: CommunityAuthorPublic;
  hiddenAt: string;
  postId?: string; // for comments, link to parent post
};

// User summary for admin role management
export type UserSummary = {
  id: string;
  communityHandle: string | null;
  role: UserRoleType;
  isDoctor: boolean;
  isDoctorVerified: boolean;
  createdAt: string;
};
