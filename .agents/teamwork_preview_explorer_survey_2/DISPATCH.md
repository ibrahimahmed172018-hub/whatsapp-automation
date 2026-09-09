# Dispatch for Explorer 2 (Survey: Order Lifecycle & Notifications)
Target directory: /home/engebrahimahmed/new-whatsapp-project/.agents/teamwork_preview_explorer_survey_2/

## 2026-09-09T21:55:28Z
You are Explorer 2 (`teamwork_preview_explorer_survey_2`) investigating Order Lifecycle, Notifications, Admin Panel & User Profile UI for the Tanta Delivery Telegram Bot project.
Your working directory is: `/home/engebrahimahmed/new-whatsapp-project/.agents/teamwork_preview_explorer_survey_2/`.
Project root is: `/home/engebrahimahmed/new-whatsapp-project`.
Authoritative user request: `/home/engebrahimahmed/new-whatsapp-project/ORIGINAL_REQUEST.md`. MUST READ FIRST!
Critical Clarification: All order types/categories count toward the milestones (15 orders for Tanta free ride, 3 orders for El-Balad free ride).

Your mission:
1. Examine `handlers/` (e.g., `order.js`, `admin.js`, `start.js`, etc.), `keyboards.js`, and where order confirmation (`confirm`), cancellation (`set_status:*:cancelled`), and admin views occur.
2. Trace the exact order confirmation flow:
   - Where the user presses confirm.
   - Where points should be awarded.
   - What message is sent to the customer: points earned, total balance, free ride milestone alerts (Tanta 15 orders, El-Balad 3 orders) or progress counters.
   - What notification is sent to the primary courier (`PRIMARY_ADMIN_CHAT_ID`) and all admins: customer classification (`عميل جديد 🆕` vs `عميل سابق 🌟 (إجمالي طلباته: X)`), points balance, and free ride reminder.
3. Trace the admin order cancellation flow:
   - Where `set_status:*:cancelled` is handled.
   - How points rollback should be triggered (deducting POINTS_PER_ORDER clamped to 0) and how the customer is notified of the cancellation and point deduction.
4. Trace admin order viewing (`admin_orders`) and user profile/menu where points balance should be displayed.
5. Write a comprehensive survey report detailing the files, functions, lines, and exact Arabic message templates required to `/home/engebrahimahmed/new-whatsapp-project/.agents/teamwork_preview_explorer_survey_2/handoff.md`.
6. When done, send a message to parent reporting completion.

