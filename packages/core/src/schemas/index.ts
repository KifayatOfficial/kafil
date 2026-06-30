// Spec source: KAFIL_SPEC_v1.1_ADDENDUM.md §2 + §2.13.
// One file per domain; this barrel re-exports them.
export * from './common';
export * from './user';
export * from './location';
export * from './specialty';
export * from './job';
export * from './application';
export * from './assignment';
export * from './review';
export * from './message';
export * from './safety';
export * from './dispute';
// §2.8 — community/directory pillars (Shops, Groups, Posts/Comments). Lifted into core
// so mobile + web + api share one contract (no schema drift). See KAFIL roadmap P1.5.
export * from './shop';
export * from './group';
export * from './post';
