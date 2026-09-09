# Orchestration Plan: Tanta Delivery Telegram Bot

## Objectives
Implement and thoroughly verify:
1. Loyalty Points Configuration & Persistence (R1)
2. Free Ride Milestones (Tanta 15 orders, El-Balad 3 orders across ALL order categories) (R2)
3. Customer Classification (New 🆕 vs. Returning 🌟 with order count) (R3)
4. Admin & Courier Notification UI Enhancements & Admin Panel View (R4)
5. Architecture Integrity, Repository Mirroring to `/home/engebrahimahmed/delivery-bot`, and Dual Remote Git Push on `main` and `master` (R5)
6. Automated E2E test verification and clean syntax check (`node --check`).

## Phases
- **Phase 0: Survey & Specification Mining**
  - Explorer 1: Codebase structure, SQLite DB schema, migrations, config, DB helper methods.
  - Explorer 2: Order lifecycle flows (confirmation, cancellation, courier/admin notification text, profile display).
  - Explorer 3: Secondary repository `/home/engebrahimahmed/delivery-bot`, git remotes, branch statuses, differences.
- **Phase 1: Project Architecture & Feature Inventory Definition**
  - Synthesize explorer findings into `PROJECT.md` and `TEST_INFRA.md`.
  - Establish milestones and interface contracts.
- **Phase 2: Dual Track Execution**
  - **Track A: E2E Testing Track**
    - Build automated end-to-end test suite (`test_loyalty_milestones.js`) testing points, rollback, customer classification, and both milestone thresholds.
    - Publish `TEST_READY.md`.
  - **Track B: Implementation Track**
    - M1: Config & DB Schema (`POINTS_PER_ORDER`, `points` column migration, db helpers `getUserPoints`, `addPoints`, `deductPoints`, `getUserOrderStats`).
    - M2: Customer Order Confirmation, Classification & Free Ride Milestone Logic & Courier/Admin notifications.
    - M3: Admin Cancellation Points Rollback & Notification.
    - M4: Admin Panel Order View & User Profile Points Display.
- **Phase 3: Integration, E2E Testing, Adversarial Verification & Forensic Audit**
  - Run automated E2E test suite.
  - Run `node --check` across all JavaScript files.
  - Challenger testing & Forensic Audit for authenticity and zero shortcuts.
- **Phase 4: Repository Mirroring & Dual Remote Git Push**
  - Mirror all changes cleanly to `/home/engebrahimahmed/delivery-bot`.
  - Verify sync and clean diff.
  - Commit and push to both remotes on `main` and `master`.
- **Phase 5: Reporting & Handoff**
  - Verify all acceptance criteria.
  - Write handoff.md and final status report to user.
