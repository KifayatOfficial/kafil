import { z } from 'zod';
import { IdempotencyKey, Timestamp, Uuid } from './common';

// §2.8 + §4 — posts live inside a group; comments live on a post. These power the
// community feed (the §6.1 habit-former). Moderation hooks: `status` gates visibility,
// link-stripping + PII redaction happen server-side (§5/§10) like chat messages.
//
// Post kinds mirror the spec's post-type examples (§ COMPLETE_SPEC community section):
//   discussion   — general talk / question
//   announcement — pinned-worthy community notice (water shortage, event)
//   offer        — selling/offering (used scaffolding, bulk discount)
//   request      — looking-for (need a tool, want to buy)
export const PostKind = z.enum(['discussion', 'announcement', 'offer', 'request']);
export type PostKind = z.infer<typeof PostKind>;

export const PostStatus = z.enum(['visible', 'hidden', 'removed']);
export type PostStatus = z.infer<typeof PostStatus>;

export const Post = z.object({
  id: Uuid,
  group_id: Uuid,
  author_id: Uuid,
  kind: PostKind,
  body: z.string().max(4000).nullable(),
  images: z.array(z.string().url()),
  pinned: z.boolean(),
  comment_count: z.number().int().nonnegative(),
  status: PostStatus,
  created_at: Timestamp,
});
export type Post = z.infer<typeof Post>;

export const CreatePostInput = z.object({
  kind: PostKind.default('discussion'),
  // Body OR at least one image must be present (refine below) — a photo-only post is
  // valid for low-literacy users (§12).
  body: z.string().max(4000).optional(),
  images: z.array(z.string().url()).max(10).default([]),
  idempotency_key: IdempotencyKey,
});
export type CreatePostInput = z.infer<typeof CreatePostInput>;

export const CreatePostInputChecked = CreatePostInput.refine(
  (v) => (!!v.body && v.body.trim().length > 0) || v.images.length > 0,
  { message: 'a post needs body text or at least one image' },
);

export const Comment = z.object({
  id: Uuid,
  post_id: Uuid,
  author_id: Uuid,
  body: z.string().max(2000).nullable(),
  status: PostStatus,
  created_at: Timestamp,
});
export type Comment = z.infer<typeof Comment>;

export const CreateCommentInput = z.object({
  body: z.string().min(1).max(2000),
  idempotency_key: IdempotencyKey,
});
export type CreateCommentInput = z.infer<typeof CreateCommentInput>;
