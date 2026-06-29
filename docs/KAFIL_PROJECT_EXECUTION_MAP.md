# KAFIL: Project Execution Map

> ## ⚠️ READ FIRST — DOCUMENT PRECEDENCE (added 2026-06-29)
> This execution map was written against **v1.0** and contains diagrams and a week-by-week plan now **superseded by `KAFIL_SPEC_v1.1_ADDENDUM.md`**. Where they conflict, **v1.1 wins.** Known overrides:
> - **The database ERD in Part 1 is obsolete.** It shows split `workers`/`employers` tables and FK-less `ratings`. Use the single-identity model in **v1.1 §2–§3**. (The old ERD cannot be built: `jobs.employer_id` references a table that isn't defined.)
> - **"Next.js 14"** → use current stable (**Next.js 16** at build time).
> - **The data-flow SQL** (`specialties @> ['Mason']`) reflects the old array model; v1.1 normalizes specialties into a vocabulary + join tables.
> - **The Weeks 3–12 roadmap** builds features in an order that skips the non-negotiable foundation. Follow the **corrected roadmap in v1.1 §22** (Tier A foundation first).
> - **The commission/payment steps** inherit v1.0's disintermediation flaw — see **v1.1 §5/§6**.
>
> Still useful for: dependency thinking, risk timeline, metrics dashboard, file-structure intent (refined in v1.1 §2/P2). See **`KAFIL_DOCS_INDEX.md`**.

**Complete timeline, dependencies, architecture, and build roadmap**

---

## PART 1: TECHNOLOGY ARCHITECTURE MAP

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            USER LAYER                                   │
│  Web (kafil.pk) | Mobile PWA | iOS App (future) | Android App (future) │
└────────────────┬────────────────────────────────────┬────────────────────┘
                 │                                    │
                 ↓                                    ↓
        ┌─────────────────────┐          ┌──────────────────────┐
        │   Vercel Edge        │          │  Cloudflare CDN      │
        │   (30+ locations)    │          │  (Static assets)     │
        │   - Next.js 14       │          │  - JavaScript/CSS    │
        │   - API Routes       │          │  - Images (optimized)│
        │   - Serverless       │          │  - DDoS protection   │
        └──────────┬───────────┘          └──────────┬───────────┘
                   │                                 │
                   └──────────────┬──────────────────┘
                                  ↓
        ┌─────────────────────────────────────────┐
        │     Application Logic Layer              │
        │  ┌─────────────────────────────────────┐ │
        │  │  Next.js 14 + React 18 + TypeScript │ │
        │  │                                     │ │
        │  │  /pages                             │ │
        │  │  ├─ /workers                        │ │
        │  │  ├─ /jobs                           │ │
        │  │  ├─ /groups                         │ │
        │  │  ├─ /shops                          │ │
        │  │  ├─ /map                            │ │
        │  │  └─ /admin                          │ │
        │  │                                     │ │
        │  │  /api/routes                        │ │
        │  │  ├─ /auth                           │ │
        │  │  ├─ /workers                        │ │
        │  │  ├─ /jobs                           │ │
        │  │  ├─ /notifications                  │ │
        │  │  └─ /webhooks                       │ │
        │  └─────────────────────────────────────┘ │
        │                                           │
        │  State Management                        │
        │  ├─ TanStack Query (server state)        │
        │  ├─ Zustand (client state)               │
        │  └─ Supabase Realtime (subscriptions)    │
        │                                           │
        │  UI Components                            │
        │  ├─ Shadcn/ui                            │
        │  ├─ TailwindCSS                          │
        │  └─ Custom components                    │
        └───────┬──────────┬──────────┬─────────────┘
                │          │          │
    ┌───────────┴──┐   ┌───┴────────┐ │
    │              │   │            │ │
    ↓              ↓   ↓            ↓ ↓
┌─────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐
│ Supabase│  │  Redis Cache │  │  AWS S3 +    │  │   Twilio    │
│(Database)  │ (Hot data)   │  │  CloudFront  │  │  (WhatsApp) │
│           │              │  │  (Photos)    │  │             │
│ PostgreSQL│ Session data  │  │              │  │  - Messages │
│ Auth      │ Job cache     │  │  - Compress  │  │  - Alerts   │
│ Realtime  │ User prefs    │  │  - Optimize  │  │  - Delivery │
└─────────┘  └──────────────┘  └──────────────┘  └─────────────┘
```

### Data Flow Architecture

```
USER ACTION:
Worker searches for jobs in Mingora

FLOW:
1. Frontend (React)
   └─ User enters filter: location=Mingora, specialty=Mason
   └─ TanStack Query checks cache
   └─ Cache miss? Query database

2. Backend (Next.js API)
   └─ GET /api/jobs?location=Mingora&specialty=Mason
   └─ Check Redis cache (5 min TTL)
   └─ Cache miss? Query Supabase PostgreSQL
   └─ Redis cache result (5 min)

3. Database (Supabase/PostgreSQL)
   └─ SELECT * FROM jobs WHERE location='Mingora' AND specialties @> ['Mason']
   └─ WITH ratings (avg_rating FROM ratings GROUP BY job_id)
   └─ ORDER BY avg_rating DESC, created_at DESC
   └─ LIMIT 20

4. Results
   └─ 20 jobs returned to frontend
   └─ Cached in browser (1 week)
   └─ Cached in Redis (5 minutes)
   └─ Cached in CDN (varies)

5. Frontend Rendering
   └─ React renders job cards
   └─ Images lazy-loaded from CloudFront
   └─ Worker can click to apply

PERFORMANCE:
- First request: 500ms (database hit)
- Subsequent requests: 50ms (cache hit)
- Real users: 80% hit redis cache
```

### Database Schema Dependencies

> 🛑 **OBSOLETE DIAGRAM (superseded by v1.1 §2–§3).** The ERD below splits identity into `workers` and `employers` tables — but in Swat the same person is routinely both, so this halves reputation, collides on `phone UNIQUE`, and forces duplicate accounts. It also draws `ratings` with bare `rater_id`/`ratee_id` (no FKs, no direction) and references an `employers` table that the v1.0 SQL never actually defines. **Use the single-identity `users` + `user_roles` + role-profile model in v1.1 §2.1/§3, the slot-based multi-worker job model in v1.1 §2.3, and the FK-backed double-blind `reviews` table in v1.1 §2.5.** The diagram is retained only to show the original dependency intent.

```
┌─────────────┐
│   users     │ (Supabase Auth)
│ ├─ id       │
│ ├─ phone    │
│ ├─ email    │
│ └─ created  │
└────┬────────┘
     │
     ├─────────────────────────────────────────────────┐
     │                                                 │
     ↓                                                 ↓
┌─────────────┐                              ┌──────────────┐
│  workers    │                              │  employers   │
│ ├─ id (FK)  │                              │ ├─ id (FK)   │
│ ├─ name     │                              │ ├─ company   │
│ ├─ photo    │                              │ └─ type      │
│ ├─ rating   │ ←────────────────────────────┤             │
│ └─ jobs[]   │        (has many)            └──────┬──────┘
└────┬────────┘                                     │
     │                                              │
     │                                              ↓
     │                                      ┌──────────────┐
     │                                      │    jobs      │
     │ ┌──────────────────────────────────→ │ ├─ id        │
     │ │ (applies to)                      │ ├─ employer_id│
     │ │                                    │ ├─ location  │
     ├─────────────────────────────────────→ │ ├─ rate      │
     │ (completes)                         │ └─ status    │
     │                                      └────┬─────────┘
     ↓                                           │
┌─────────────┐                                  │
│applications │                                  │
│ ├─ id       │                                  │
│ ├─ worker   │◄─────────────────────────────────┘
│ ├─ job      │        (has many)
│ └─ status   │
└─────────────┘
     │
     ├──────────────────────────────┐
     │                              ↓
     │                       ┌─────────────┐
     │                       │   ratings   │
     │                       │ ├─ job_id   │
     │                       │ ├─ rater_id │
     │                       │ ├─ ratee_id │
     │                       │ └─ stars    │
     │                       └─────────────┘
     │
     └──────────────────────────────┐
                                    ↓
                         ┌──────────────────┐
                         │ community_groups │
                         │ ├─ id            │
                         │ ├─ name          │
                         │ └─ category      │
                         └────────┬─────────┘
                                  │
                                  ↓
                          ┌──────────────────┐
                          │  group_posts     │
                          │ ├─ id            │
                          │ ├─ group_id      │
                          │ ├─ author_id     │
                          │ └─ content       │
                          └──────────────────┘

SHOPS:
┌──────────────┐
│    shops     │
│ ├─ id        │
│ ├─ owner_id  │
│ ├─ location  │
│ ├─ what_sell │
│ └─ rating    │
└──────────────┘
```

---

## PART 2: COMPLETE BUILD ROADMAP

### Week-by-Week Timeline

#### WEEK 1-2: Foundation & Validation

**Goal:** Validate product-market fit before building

**Tasks:**

```
Week 1:
├─ [Founder] Interview 5 contractors in Mingora
│  └─ Questions: Current hiring process, pain points, willingness to pay
│
├─ [Founder] Interview 5 workers
│  └─ Questions: How find jobs, trust in platforms, verification needs
│
├─ [Founder] Interview 3 shop owners
│  └─ Questions: Customer discovery, pricing, inventory
│
├─ [Founder] Interview 2 community leaders
│  └─ Questions: Dispute resolution, trust model, adoption barriers
│
├─ [Dev Setup] Set up local development environment
│  └─ Node.js 20, npm, GitHub
│
└─ [Infrastructure] Create Supabase project
   └─ Database created, auth enabled

Week 2:
├─ [Analysis] Compile interview findings
│  └─ Create summary of key insights, validate assumptions
│
├─ [Product] Finalize MVP feature list based on interviews
│  └─ Priority: Must-have vs. nice-to-have
│
├─ [Brand] Domain purchased (kafil.pk)
│  └─ DNS configured, SSL ready
│
├─ [Infra] Register Vercel account
│  └─ GitHub connected, deployments configured
│
├─ [Dev] Design database schema
│  └─ Draw ERD, identify relationships, indexing strategy
│
└─ [Decision] Go/no-go decision
   └─ Based on market validation
```

**Deliverables:**
- Validated MVP feature list
- Database schema diagram
- Development environment ready
- GO signal to build

**Assumption validation:**
- ✅ Contractors will pay for verified workers (2-3% commission)
- ✅ Workers prefer single platform over Facebook groups
- ✅ Community leaders accept digital reputation system
- ✅ WhatsApp is preferred notification channel

---

#### WEEK 3-4: Core Backend + Basic Frontend

**Goal:** Build job marketplace core (no fancy UI yet)

**Tasks (Full-stack):**

```
Week 3:
├─ [Backend] Set up Next.js 14 project
│  ├─ TypeScript configured
│  ├─ API route structure
│  └─ Supabase client initialized
│
├─ [Database] Create core tables
│  ├─ users, workers, employers, jobs, applications
│  └─ Run migrations, verify schema
│
├─ [API] Implement authentication
│  ├─ POST /api/auth/register (phone + password)
│  ├─ POST /api/auth/verify-otp (SMS verification)
│  ├─ POST /api/auth/login
│  └─ Middleware: Verify JWT tokens
│
├─ [API] Implement worker endpoints
│  ├─ POST /api/workers (create profile)
│  ├─ GET /api/workers/:id (get profile)
│  ├─ PATCH /api/workers/:id (update profile)
│  └─ GET /api/workers (search + filter)
│
└─ [Frontend] Basic authentication UI
   ├─ Sign-up form (Pashto/Urdu labels)
   ├─ Phone input validation
   ├─ OTP entry form
   └─ Login form

Week 4:
├─ [API] Implement job endpoints
│  ├─ POST /api/jobs (post new job)
│  ├─ GET /api/jobs (list with filters)
│  ├─ GET /api/jobs/:id
│  ├─ PATCH /api/jobs/:id (update)
│  └─ Full-text search on title/description
│
├─ [API] Implement application endpoints
│  ├─ POST /api/jobs/:id/apply (worker applies)
│  ├─ GET /api/applications (list user's applications)
│  └─ PATCH /api/applications/:id (employer accepts/rejects)
│
├─ [API] Photo upload to S3
│  ├─ Presigned URLs (secure upload)
│  ├─ Image compression on backend
│  └─ CloudFront CDN setup
│
├─ [Frontend] Minimal UI
│  ├─ Worker profile creation flow
│  ├─ Job posting form
│  ├─ Job listing page (unstyled)
│  └─ Search filters (basic)
│
├─ [Infra] GitHub Actions CI/CD
│  ├─ Test runner (jest)
│  ├─ Type checking (tsc)
│  └─ Deploy to Vercel on push
│
└─ [Testing] Manual testing
   ├─ Test full user flow (sign up → create job → apply)
   └─ Test photo uploads
```

**Deliverables:**
- Working job marketplace (backend complete)
- Basic auth system (phone-based)
- Job posting and applications functional
- Photo uploads working
- CI/CD pipeline automated

**Metrics to measure:**
- ✅ Zero errors on core flows
- ✅ All API endpoints working
- ✅ Photos upload < 5 seconds

---

#### WEEK 5-6: Transactional Features + Notifications

**Goal:** Complete job transaction flow, add ratings, notifications

**Tasks:**

```
Week 5:
├─ [API] Implement ratings endpoints
│  ├─ POST /api/jobs/:id/rate (employer rates worker)
│  ├─ GET /api/ratings/:userId (get user's ratings)
│  └─ Calculate average rating, update worker profile
│
├─ [API] Job status tracking
│  ├─ Status: open → in_progress → completed → rated
│  └─ Trigger notifications on status changes
│
├─ [API] Notification system
│  ├─ In-app notifications (database)
│  ├─ WhatsApp integration (Twilio API)
│  │  ├─ Job alert notification
│  │  ├─ Application received
│  │  └─ Job rating notification
│  └─ Notification preferences (user can toggle)
│
├─ [API] Community groups endpoints
│  ├─ GET /api/groups (list groups)
│  ├─ POST /api/groups (create group)
│  ├─ GET /api/groups/:id/posts (get posts)
│  ├─ POST /api/groups/:id/posts (post in group)
│  └─ POST /api/groups/:id/posts/:postId/comments
│
├─ [API] Shop endpoints
│  ├─ GET /api/shops (search shops)
│  ├─ POST /api/shops (create shop profile)
│  ├─ PATCH /api/shops/:id (update)
│  └─ GET /api/shops (search by category/location)
│
└─ [Frontend] Rating UI
   ├─ Rating form (1-5 stars + comment)
   ├─ Review display
   └─ Rating summary on profile

Week 6:
├─ [Frontend] Community groups UI
│  ├─ Group list page
│  ├─ Group feed (posts + comments)
│  ├─ Post creation form
│  ├─ Comment UI
│  └─ Pinning (admin only)
│
├─ [Frontend] Shop directory UI
│  ├─ Shop list (grid/list view)
│  ├─ Shop profile page
│  ├─ Bulk discount display
│  └─ "Message" button (WhatsApp link)
│
├─ [Frontend] Job completion flow
│  ├─ "Mark job complete" button (employer)
│  ├─ "Confirm completion" (worker)
│  ├─ Rating prompts
│  └─ Success confirmation
│
├─ [API] Map/location endpoints
│  ├─ GET /api/map/search (search by location)
│  └─ GET /api/map/nearby (jobs/shops/workers near coordinates)
│
├─ [Frontend] Map integration
│  ├─ Show workers by location
│  ├─ Show jobs by location
│  ├─ Show shops by location
│  ├─ Click markers to see profiles
│  └─ Search radius filter
│
└─ [Testing] End-to-end flow testing
   ├─ Post job → Apply → Accept → Rate → Complete
   └─ Test notifications
```

**Deliverables:**
- Complete job transaction flow (post → apply → complete → rate)
- Notification system (WhatsApp + in-app)
- Community groups (posts, comments, pins)
- Shop directory
- Map integration (basic)

**Metrics:**
- ✅ Job completion flow works end-to-end
- ✅ WhatsApp notifications deliver < 10 seconds
- ✅ Map loads in < 2 seconds

---

#### WEEK 7-8: Polish, Launch, First Users

**Goal:** Production-ready MVP, soft launch with beta users

**Tasks:**

```
Week 7:
├─ [Performance] Image optimization
│  ├─ Implement Next.js Image component
│  ├─ Lazy loading for job photos
│  ├─ WebP format conversion
│  └─ Measure Core Web Vitals (LCP, FID, CLS)
│
├─ [Performance] Code splitting
│  ├─ Analyze bundle size
│  ├─ Lazy load job search page
│  ├─ Lazy load groups page
│  └─ Target: <50KB initial load
│
├─ [Frontend] PWA setup
│  ├─ Service worker registration
│  ├─ Offline mode (cache strategy)
│  ├─ Install prompt ("Add to home screen")
│  ├─ Push notifications setup
│  └─ App manifest (name, icon, colors)
│  # 🛑 SUPERSEDED (v1.1 §23): mobile-first now. Replace "PWA setup" with
│  #   "EAS build (Expo) for Android+iOS + APK distribution + QR/deep-links +
│  #    store listings." PWA is not the primary client. Native push/offline instead.
│
├─ [Frontend] Dark mode
│  ├─ CSS variables for theme
│  ├─ System preference detection
│  ├─ Manual toggle in settings
│  └─ Persistence (localStorage)
│
├─ [Frontend] Mobile responsive
│  ├─ Test on small screens (280px)
│  ├─ Touch-friendly buttons (44px+)
│  ├─ Swipe gestures (optional)
│  ├─ Thumb-zone optimization
│  └─ Viewport meta tags
│
├─ [Frontend] Pashto/Urdu UI
│  ├─ i18n setup (next-intl)
│  ├─ UI labels translated
│  ├─ RTL support (right-to-left)
│  ├─ Date/number formatting (local)
│  └─ Language switcher
│
├─ [Security] Security review
│  ├─ Input validation (SQL injection prevention)
│  ├─ CSRF tokens on forms
│  ├─ HTTPS everywhere
│  ├─ Password hashing (bcrypt)
│  ├─ Rate limiting (prevent abuse)
│  └─ Penetration testing
│
└─ [Testing] Unit + integration tests
   ├─ Auth flow tests
   ├─ Job posting tests
   ├─ Application tests
   ├─ Rating tests
   └─ Coverage target: 70%+

Week 8:
├─ [Infra] Production deployment
│  ├─ Deploy to kafil.pk (Vercel)
│  ├─ Configure Cloudflare CDN
│  ├─ Set up monitoring (Sentry)
│  ├─ Set up analytics (PostHog)
│  └─ Health checks automated
│
├─ [Admin] Admin dashboard (basic)
│  ├─ User management (list, verify, suspend)
│  ├─ Job management (list, delete)
│  ├─ Group moderation (delete posts)
│  ├─ Stats dashboard (user count, jobs, revenue)
│  └─ Admin authentication
│
├─ [Marketing] Landing page
│  ├─ kafil.pk homepage
│  ├─ About/features page
│  ├─ "Sign up" CTAs
│  ├─ Social proof (testimonials)
│  └─ FAQ
│
├─ [Beta Launch] Recruit 20-30 beta users
│  ├─ Contact contractors you interviewed
│  ├─ Invite to exclusive beta
│  ├─ Set expectations (bugs may exist)
│  ├─ Feedback form (in-app + WhatsApp group)
│  └─ Daily check-ins
│
├─ [Documentation] Deployment runbook
│  ├─ How to deploy
│  ├─ How to scale database
│  ├─ How to handle incident
│  └─ Rollback procedure
│
└─ [Launch] Soft launch
   ├─ kafil.pk goes live
   ├─ Beta users invited
   ├─ Support monitoring (24/7 availability)
   └─ Bug tracking system live
```

**Deliverables:**
- ✅ Production-ready MVP (kafil.pk live)
- ✅ PWA fully functional (offline, installable)
- ✅ Pashto/Urdu UI complete
- ✅ Dark mode working
- ✅ Mobile responsive
- ✅ Monitoring + analytics
- ✅ Admin dashboard v1
- ✅ 20-30 beta users testing

**Launch metrics to track:**
- ✅ Page load time: <2 seconds on 3G
- ✅ Lighthouse score: >85
- ✅ Zero critical bugs (P0)
- ✅ Uptime: >99.5%

---

#### WEEK 9-12: Growth & Iteration

**Goal:** Scale to 500-1000 active users, iterate based on feedback

**Tasks:**

```
Week 9:
├─ [Feedback] Daily user feedback collection
│  ├─ WhatsApp group with beta users
│  ├─ In-app feedback form
│  ├─ Weekly video calls with key users
│  └─ Compile issues/feature requests
│
├─ [Bugs] Critical bug fixes (prioritized)
│  ├─ P0 (breaks core flow): Fix today
│  ├─ P1 (major feature broken): Fix this week
│  ├─ P2 (minor issues): Fix next week
│  └─ P3 (nice to have): Backlog
│
├─ [Features] Quick wins (high-impact, low-effort)
│  ├─ Example: Add "available now" toggle
│  ├─ Example: Improve search filters
│  ├─ Example: Better job notifications
│  └─ Deploy each day
│
├─ [Growth] Expand beta user group
│  ├─ Recruit 50 more users (100 total)
│  ├─ Target: Mix of workers, contractors, shop owners
│  ├─ Referral incentive: 300 PKR credit per referral
│  └─ Track retention weekly
│
└─ [Analysis] Metrics dashboard
   ├─ DAU (daily active users)
   ├─ Jobs posted/week
   ├─ Applications/job
   ├─ Completion rate
   ├─ Avg rating
   └─ Churn rate

Week 10:
├─ [Marketing] Press outreach
│  ├─ Local news (Peshawar/Mingora)
│  ├─ Tech blogs
│  ├─ Angle: "New platform helps Swat workers"
│  ├─ Goal: 1-2 news features
│  └─ Use for credibility
│
├─ [Growth] Community partnerships
│  ├─ Partner with 1-2 construction contractors
│  ├─ Get them to evangelize platform
│  ├─ Incentive: Featured profile, early features
│  └─ Their networks = organic growth
│
├─ [Product] Feature improvements
│  ├─ Improve job search relevance
│  ├─ Better job recommendations
│  ├─ Enhanced worker profiles
│  └─ Faster job matching
│
├─ [Monetization] Commission model live
│  ├─ Start collecting 2% commission on jobs
│  ├─ Transparent: Show commission breakdown
│  ├─ Payment method: Bank transfer / JazzCash
│  └─ Automate commission collection
│
└─ [Support] Customer support workflow
   ├─ WhatsApp support group
   ├─ Email support (kafil@example.com)
   ├─ Response time: <4 hours
   └─ Escalation path for disputes

Week 11:
├─ [Regional] Prepare Peshawar expansion
│  ├─ Research Peshawar contractors (10-20 key ones)
│  ├─ Plan targeted outreach
│  ├─ Create Peshawar-specific groups
│  └─ Timeline: Week 12 launch
│
├─ [Analytics] Deep dive analysis
│  ├─ Cohort analysis (when did users join)
│  ├─ Retention curves (weekly/monthly)
│  ├─ Feature usage (what do users do most)
│  ├─ Churn analysis (why do users leave)
│  └─ Actionable improvements
│
├─ [Admin] Dashboard enhancements
│  ├─ User activity logs
│  ├─ Transaction history
│  ├─ Dispute tracking
│  ├─ Revenue dashboard
│  └─ Alerts for anomalies
│
└─ [Documentation] Case studies
   ├─ Interview 3-5 success stories
   ├─ Document results (jobs completed, earnings)
   ├─ Get testimonials/photos
   └─ Use for marketing

Week 12:
├─ [Regional] Peshawar soft launch
│  ├─ Announce in local groups
│  ├─ Target 50-100 Peshawar users
│  ├─ Recruit 3-5 key contractors
│  └─ Monitor adoption closely
│
├─ [Product] Feature freeze (stabilization)
│  ├─ Focus on reliability, not new features
│  ├─ Bug fixes only
│  ├─ Testing before release
│  └─ Slow rollout (gradual deployment)
│
├─ [Metrics] Milestone celebration
│  ├─ Milestone 1: 100 completed jobs ✅
│  ├─ Milestone 2: 500 active users ✅
│  ├─ Milestone 3: 4.5+ avg rating ✅
│  ├─ Milestone 4: 1000 jobs posted ✅
│  └─ Announce wins internally + to users
│
└─ [Planning] Month 4+ roadmap
   ├─ Finalize next features
   ├─ Plan hiring (frontend dev?)
   ├─ Define regional strategy
   └─ Set Year 1 revenue goals
```

**Success metrics for end of Week 12:**
- ✅ 500+ active users (Mingora + Peshawar)
- ✅ 100+ jobs completed
- ✅ 4.5+ average rating
- ✅ <10% weekly churn
- ✅ 5-10 jobs/day posted
- ✅ $3-5k revenue from commissions
- ✅ Zero critical bugs in production

---

### Timeline Summary Table

```
┌──────┬──────────────────────────┬──────────────────┬──────────────┐
│Week  │ Focus Area               │ Key Deliverables │ Team Size    │
├──────┼──────────────────────────┼──────────────────┼──────────────┤
│1-2   │ Validation + Setup        │ MVP spec         │ 1 (founder)  │
│      │ Market research          │ Tech ready       │              │
├──────┼──────────────────────────┼──────────────────┼──────────────┤
│3-4   │ Core marketplace build   │ Job marketplace  │ 1 (founder)  │
│      │ Backend + basic frontend │ Auth system      │ 60-80 hrs/wk │
├──────┼──────────────────────────┼──────────────────┼──────────────┤
│5-6   │ Transactional features   │ Ratings          │ 1 (founder)  │
│      │ Groups, shops, map       │ Notifications    │ 60-80 hrs/wk │
│      │                          │ Communities      │              │
├──────┼──────────────────────────┼──────────────────┼──────────────┤
│7-8   │ Polish + launch          │ Production MVP   │ 1 (founder)  │
│      │ PWA, dark mode, Pashto   │ kafil.pk live    │ 70-80 hrs/wk │
│      │ Security, testing        │ 20-30 beta users │              │
├──────┼──────────────────────────┼──────────────────┼──────────────┤
│9-12  │ Growth + iteration       │ 500+ users       │ 1 (founder)  │
│      │ Feedback, bugs, features │ 100+ jobs        │ + advisor    │
│      │ Regional expansion       │ $3-5k revenue    │ (part-time)  │
└──────┴──────────────────────────┴──────────────────┴──────────────┘
```

---

## PART 3: CRITICAL PATH & DEPENDENCIES

### Feature Dependencies (What blocks what)

```
CRITICAL PATH (Must complete in order):

Authentication System
  ↓ (blocks all features)
Worker Profile Creation
  ↓ (blocks marketplace)
├─ Job Posting
│   ↓ (blocks applications)
│   ├─ Job Applications
│   │   ↓ (blocks completion)
│   │   └─ Job Completion + Ratings
│   │       ↓ (blocks trust system)
│   │       └─ Reputation Display
│   │           ↓ (blocks growth)
│   │           └─ Search Ranking by Rating
│   │
│   └─ Photo Upload (S3 + compression)
│       ↓ (blocks portfolio)
│       └─ Profile Portfolio
│
└─ Map Integration
    ↓ (blocks location-based discovery)
    └─ Location-based Search

PARALLEL TRACKS (Can build simultaneously):

├─ Community Groups (posts, comments)
├─ Shop Directory
├─ Notifications (WhatsApp + in-app)
├─ Admin Dashboard
└─ PWA Setup

AFTER MVP:
├─ Regional expansion
├─ Mobile apps (Capacitor)
├─ Integrated payments
└─ Advanced features (AI, micro-credentials)
```

### Resource Dependencies

```
FOUNDER CAPACITY (Kifayat):

Weeks 1-2:
├─ 40% Development (setup)
├─ 30% Market validation
└─ 30% Planning

Weeks 3-4:
├─ 80% Development (backend)
└─ 20% Customer support (beta interviews)

Weeks 5-6:
├─ 80% Development (features)
└─ 20% Admin tasks

Weeks 7-8:
├─ 70% Development (polish)
├─ 20% QA/Testing
└─ 10% Launch preparation

Weeks 9-12:
├─ 60% Development (bug fixes + features)
├─ 20% Customer support
├─ 15% Growth/marketing
└─ 5% Planning

EXTERNAL DEPENDENCIES:

Supabase:
  - Database hosting (free tier sufficient)
  - Auth service
  - Realtime subscriptions
  - Dependency: PostgreSQL knowledge helpful

Vercel:
  - Hosting (free tier sufficient)
  - CI/CD deployment
  - Dependency: GitHub repo management

AWS S3:
  - Image storage
  - CDN delivery
  - Dependency: AWS API familiarity

Twilio:
  - WhatsApp integration
  - SMS fallback
  - Cost: ~$0.01 per message (~$100/month at scale)
  - Dependency: API integration

GitHub:
  - Code repository
  - CI/CD triggers
  - Dependency: Git version control
```

---

## PART 4: RISK TIMELINE

### When risks happen (timeline-based)

```
WEEK 1-2 RISKS (Validation phase):
├─ Market doesn't show interest
│  └─ Mitigation: Pivot messaging or problem
├─ Contractors too busy to interview
│  └─ Mitigation: Approach during off-hours
└─ Early sign of adoption problems
   └─ Mitigation: Adjust assumptions immediately

WEEK 3-4 RISKS (Development):
├─ Scope creep (want to build too much)
│  └─ Mitigation: Stick to MVP feature list
├─ Technical blockers (Supabase limits, etc)
│  └─ Mitigation: Workaround or switch platforms
└─ Burnout (80 hours/week is unsustainable)
   └─ Mitigation: Reduce scope or extend timeline

WEEK 5-6 RISKS (Feature expansion):
├─ Feature incomplete before Week 7
│  └─ Mitigation: Cut features, focus on core
├─ Performance issues (app slow)
│  └─ Mitigation: Optimize before launch
└─ Security vulnerabilities discovered
   └─ Mitigation: Pause launch, fix immediately

WEEK 7-8 RISKS (Launch):
├─ Critical bugs found in production
│  └─ Mitigation: Quick hotfix, rollback if needed
├─ Beta users overwhelm support
│  └─ Mitigation: Scale support workflow
└─ Low initial adoption
   └─ Mitigation: Double down on contractor recruitment

WEEK 9-12 RISKS (Growth):
├─ Churn higher than expected
│  └─ Mitigation: Exit interviews, product improvements
├─ Infrastructure can't scale
│  └─ Mitigation: Optimize database or upgrade tier
├─ Commission payment issues
│  └─ Mitigation: Manual payments first, automate later
└─ Community moderation needed (harassment)
   └─ Mitigation: Policies + quick moderation
```

---

## PART 5: METRICS DASHBOARD

### What to measure (Week-by-week)

```
WEEK 1-2:
├─ # of interviews conducted (target: 15+)
├─ % willing to use platform (target: >70%)
├─ Average pain point severity (1-10 scale)
└─ Go/no-go decision: YES or PIVOT

WEEK 3-4:
├─ Code commits (target: 20+ per week)
├─ API endpoints completed (target: 15+)
├─ Test coverage (target: >70%)
├─ Zero production errors (all in dev/staging)

WEEK 5-6:
├─ Feature completion rate (% of planned features)
├─ Performance: Page load time (target: <2s)
├─ WhatsApp notification delivery rate (target: >99%)
├─ Rating system working (tested with fake data)

WEEK 7-8:
├─ Lighthouse score (target: >85)
├─ Core Web Vitals (LCP <2.5s, FID <100ms)
├─ Mobile responsiveness (tested on 3 device sizes)
├─ PWA installation successful
├─ Production uptime (target: >99.5%)
└─ Zero critical security issues

WEEK 9-12:
├─ DAU (Daily Active Users)
│  ├─ Week 9: 50-100
│  ├─ Week 10: 100-200
│  ├─ Week 11: 200-400
│  └─ Week 12: 400-700
├─ Jobs posted/week
│  ├─ Week 9: 5-10
│  ├─ Week 10: 10-20
│  ├─ Week 11: 20-40
│  └─ Week 12: 40-80
├─ Job completion rate (% accepted jobs completed)
│  └─ Target: >80%
├─ Avg rating per job
│  └─ Target: >4.0 stars
├─ Revenue from commissions
│  ├─ Week 9: 10-20k PKR
│  ├─ Week 10: 20-50k PKR
│  ├─ Week 11: 50-150k PKR
│  └─ Week 12: 150-300k PKR
├─ Churn rate (% users who don't return)
│  └─ Target: <10% week-over-week
└─ Support tickets (issues per day)
   └─ Target: <5/day
```

---

## PART 6: DECISION TREES

### Week 1: Go/No-Go Decision

```
Are 80%+ of interviewed contractors interested?
├─ NO → Pivot: Change value prop, different problem
└─ YES ↓

Would contractors pay 2-3% commission?
├─ NO → Pivot: Different revenue model
└─ YES ↓

Are workers actively looking for jobs online?
├─ NO → Pivot: Target different user group
└─ YES ↓

Is WhatsApp preferred over new app?
├─ NO → Reconsider app-first strategy
└─ YES ↓

DECISION: GO TO BUILD
```

### Week 8: Launch Go/No-Go

```
Are all critical features working (no P0 bugs)?
├─ NO → Delay launch, fix critical issues
└─ YES ↓

Is performance acceptable (<2s load on 3G)?
├─ NO → Optimize, delay launch
└─ YES ↓

Do we have 20+ beta users signed up?
├─ NO → Recruit more, launch tomorrow
└─ YES ↓

Is infrastructure stable (99%+ uptime)?
├─ NO → Fix before launch
└─ YES ↓

DECISION: LAUNCH TO kafil.pk
```

### Week 12: Regional Expansion Go/No-Go

```
Did Mingora reach 200+ active users?
├─ NO → Focus on Mingora, delay expansion
└─ YES ↓

Are weekly jobs posted 20+?
├─ NO → Improve job discovery, delay expansion
└─ YES ↓

Is avg rating 4.0+?
├─ NO → Quality issues, fix first
└─ YES ↓

Is churn <10% weekly?
├─ NO → Retention issues, investigate first
└─ YES ↓

DECISION: EXPAND TO PESHAWAR
```

---

## PART 7: SUCCESS CRITERIA

### MVP Success (Week 8)

```
✅ kafil.pk is live and stable (99%+ uptime)
✅ 20+ beta users actively testing
✅ 5+ jobs completed successfully
✅ Zero P0 bugs (critical failures fixed)
✅ Avg rating: 4.0+ stars
✅ WhatsApp notifications working
✅ Page load < 2 seconds on 3G
✅ Mobile app responsive (PWA working)
✅ Founder has bandwidth for support
```

### Post-MVP Success (Week 12)

```
✅ 500+ active users (Mingora + early Peshawar)
✅ 100+ jobs completed
✅ 4.5+ average rating
✅ <10% weekly churn
✅ 40-80 jobs posted per week
✅ $3-5k cumulative revenue
✅ Media mention (1+ news article)
✅ 5-10 contractor advocates
✅ Ready for regional expansion
✅ Founder burned out but motivated
```

### Year 1 Success

```
✅ 10,000+ active users (KP Province)
✅ 1,000+ jobs completed
✅ 4.5+ average rating maintained
✅ <10% monthly churn
✅ 100+ jobs/week posted
✅ $100k+ annual revenue
✅ Featured in major tech publications
✅ Repeat business from top 100 contractors
✅ Strong community moderation system
✅ Ready for national expansion
```

---

## APPENDIX: COMPLETE FILE STRUCTURE

```
kafil-project/
├─ /docs
│  ├─ README.md (Project overview)
│  ├─ GETTING_STARTED.md (How to run locally)
│  ├─ API.md (All endpoints, parameters)
│  ├─ DATABASE.md (Schema, relationships)
│  ├─ DEPLOYMENT.md (How to deploy)
│  ├─ CONTRIBUTING.md (Team guidelines)
│  └─ /runbooks (How to handle scenarios)
│
├─ /src
│  ├─ /app (Next.js pages + layout)
│  │  ├─ /layout.tsx (Root layout)
│  │  ├─ /page.tsx (Homepage)
│  │  ├─ /(auth) (Auth routes)
│  │  ├─ /(dashboard) (Protected routes)
│  │  │  ├─ /workers
│  │  │  ├─ /jobs
│  │  │  ├─ /groups
│  │  │  ├─ /shops
│  │  │  ├─ /map
│  │  │  └─ /admin
│  │  └─ /api (API routes)
│  │     ├─ /auth (Authentication)
│  │     ├─ /workers (Worker endpoints)
│  │     ├─ /jobs (Job endpoints)
│  │     ├─ /groups (Community endpoints)
│  │     ├─ /shops (Shop endpoints)
│  │     ├─ /notifications (Notifications)
│  │     └─ /webhooks (Third-party webhooks)
│  │
│  ├─ /components
│  │  ├─ /common (Button, Card, Modal, etc)
│  │  ├─ /features
│  │  │  ├─ /workers (Worker cards, profiles)
│  │  │  ├─ /jobs (Job cards, forms)
│  │  │  ├─ /groups (Group posts, feeds)
│  │  │  └─ /shops (Shop listings)
│  │  └─ /layouts (Header, sidebar, footer)
│  │
│  ├─ /hooks (Custom React hooks)
│  │  ├─ useWorkers.ts
│  │  ├─ useJobs.ts
│  │  ├─ useAuth.ts
│  │  └─ useNotifications.ts
│  │
│  ├─ /lib
│  │  ├─ supabase.ts (Supabase client)
│  │  ├─ api.ts (API client)
│  │  ├─ auth.ts (Auth utilities)
│  │  └─ utils.ts (Helper functions)
│  │
│  ├─ /types (TypeScript types)
│  │  ├─ index.ts
│  │  ├─ database.ts
│  │  └─ api.ts
│  │
│  ├─ /services
│  │  ├─ notificationService.ts (WhatsApp integration)
│  │  ├─ imageService.ts (S3 uploads)
│  │  └─ searchService.ts (Full-text search)
│  │
│  ├─ /config
│  │  ├─ constants.ts
│  │  ├─ env.ts
│  │  └─ theme.ts
│  │
│  └─ /styles
│     ├─ globals.css
│     └─ variables.css
│
├─ /public
│  ├─ /icons
│  ├─ /images
│  └─ /manifest.json (PWA manifest)
│
├─ /database
│  ├─ /migrations (SQL migration files)
│  ├─ schema.sql (Full schema)
│  └─ seed.sql (Test data)
│
├─ /.github
│  ├─ /workflows
│  │  ├─ test.yml (Run tests on PR)
│  │  └─ deploy.yml (Deploy on merge to main)
│  └─ ISSUE_TEMPLATE.md
│
├─ package.json
├─ tsconfig.json
├─ next.config.js
├─ .env.example
├─ .gitignore
└─ README.md
```

---

**END OF PROJECT EXECUTION MAP**

This completes the full KAFIL specification, architecture, timeline, and execution roadmap.
