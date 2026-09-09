# BRIEFING — 2026-09-09T22:08:30Z

## Mission
Investigate Order Lifecycle, Notifications, Admin Panel & User Profile UI for Tanta Delivery Telegram Bot, tracing confirmation, cancellation, points, free ride milestones, and customer classifications.

## 🔒 My Identity
- Archetype: explorer
- Roles: investigator, surveyor, synthesizer
- Working directory: /home/engebrahimahmed/new-whatsapp-project/.agents/teamwork_preview_explorer_survey_2
- Original parent: d1badb06-c9bf-445e-82a7-d1bf766fdd73
- Milestone: survey

## 🔒 Key Constraints
- Read-only investigation — do NOT implement
- All order types/categories count toward the milestones (15 orders for Tanta free ride, 3 orders for El-Balad free ride)
- 5-Component Handoff Report in handoff.md
- Report completion via send_message to parent (d1badb06-c9bf-445e-82a7-d1bf766fdd73)

## Current Parent
- Conversation ID: d1badb06-c9bf-445e-82a7-d1bf766fdd73
- Updated: 2026-09-09T22:08:30Z

## Investigation State
- **Explored paths**:
  - `handlers/customer.js`: lines 148-170 (`data === 'confirm'`)
  - `handlers/admin.js`: lines 14-43 (`notifyAdmins`), lines 98-115 (`set_status:`), lines 118-144 (`admin_orders`)
  - `index.js`: lines 48-56, 83-91, 129-131 (`ctx.orderToNotify`)
  - `keyboards.js`: lines 11-15 (`buildMainMenuKeyboard`), lines 25-36 (`getOrderActionKeyboard`)
  - `config.js`: lines 31-36 (`CUSTOMER_STATUS_NOTIFICATIONS`), `POINTS_PER_ORDER`
  - `db.js`: `users`, `orders` tables, `lastOrders`, helper queries
- **Key findings**:
  - Exact confirmation point is in `handlers/customer.js` (line 148). Points must be awarded immediately after `insertOrder.run(...)`.
  - Notification to admins and courier is handled in `handlers/admin.js:notifyAdmins()`, dispatched via `ctx.orderToNotify` in `index.js`.
  - Cancellation is handled in `handlers/admin.js` line 98 (`set_status:*:cancelled`). Points rollback must be clamped to 0 and idempotent (`order.status !== 'cancelled'`).
  - Admin view in `admin_orders` must display customer classification, points, and free ride eligibility.
  - User profile & menu should display points balance in `/start`, `/menu`, and via dedicated `'user_profile'` inline button and command.
- **Unexplored areas**: None within Explorer 2 scope. All target files and flows mapped.

## Key Decisions Made
- Mapped all Arabic message templates for customer confirmation, admin/courier notification, customer cancellation, admin order cards, and user profile.
- Clarified milestone math: `totalOrders % 15 === 0` for Tanta, `totalOrders % 3 === 0` for El-Balad; countdown remaining: `15 - (totalOrders % 15)` and `3 - (totalOrders % 3)`.
- Classification: `totalOrders <= 1` -> `عميل جديد 🆕`, `totalOrders > 1` -> `عميل سابق 🌟 (إجمالي طلباته: X)`.

## Artifact Index
- handoff.md — Comprehensive survey report
