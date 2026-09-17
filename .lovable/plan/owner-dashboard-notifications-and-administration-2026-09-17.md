# Owner dashboard, notifications, and administration

## What will be built

### Owner dashboard
- Upgrade **My auctions** into a dashboard showing every owned auction, live status, current price, bid count, end time, and quick open/edit/end controls.
- Subscribe to auction and bid changes so counts and prices update without refreshing.
- Add a chronological history per auction for price changes, setting edits, status changes, and closing events, including who made each change and when.

### Notifications
- Add a notification inbox in the header with unread count, read state, and links back to the relevant auction.
- Notify all prior participants and the owner when a new bid is accepted, with unread notifications coalesced per auction to prevent a stress burst from flooding the inbox.
- Notify the owner, winner, and all participants when an auction closes.
- Add per-account email preferences for bid and closing alerts.
- Use Lovable managed email delivery; no user API keys or project email queue. The app and templates can be completed now, while delivery begins after the sender domain is verified.

### Admin panel
- Create a protected `/admin` panel with tabs for auctions, bids, and accounts.
- Add filters for date/time range, minimum/maximum price, bidder/account search, auction status, and auction title.
- Paginate results and show useful totals without exposing private account data to ordinary users.
- Add secure admin-role management so an administrator can promote or remove selected admin accounts. Bootstrap the current project account as the first administrator.

### Vibrant visual refresh
- Refresh the full auction experience with a richer multi-color palette: energetic amber for bids, teal for live activity, coral for urgent closing states, and crisp neutral surfaces.
- Add stronger visual hierarchy to prices, status indicators, activity rows, notification badges, and dashboard totals while keeping the existing compact, professional feel.
- Use restrained color bands, icons, and subtle motion for live updates rather than decorative gradients or effects that reduce readability.
- Preserve fast mobile bidding, clear contrast, and the current responsive structure across auction, owner, notification, and admin pages.

## Security and data rules
- Store roles only in a dedicated `user_roles` table and check them server-side with a security-definer `has_role` function.
- Keep admin reads and role changes behind authenticated server functions that verify the caller before privileged access.
- Store durable in-app notifications, preferences, and auction history with row-level access rules.
- Record bid and auction history transactionally, preserving the existing serialized bid invariant.
- Avoid sending emails inside the bid transaction. The accepted bid remains fast; managed email sending is invoked after acceptance and deduplicated with stable idempotency keys.
- Treat an auction past its end time as closed immediately in the interface and bid function. Materialize the closing event once when it is next observed, preventing duplicate close notifications.

## Technical implementation
- Add one database migration for roles, notifications, preferences, auction events, grants, policies, indexes, Realtime publication, role checks, and transactional event/notification triggers.
- Extend the atomic bid function to create coalesced participant notifications while retaining its row lock and gapless sequence behavior.
- Add authenticated server functions for admin lists, filtering, role management, closing synchronization, and managed email dispatch.
- Add managed React email templates and server routes for bid and auction-close messages.
- Add `/notifications` and `/admin` routes, update shared navigation, and rebuild `/manage` as the owner dashboard.

## Validation
- Verify ordinary users cannot access admin data or promote themselves.
- Verify selected admins can filter auctions, bids, and accounts and manage admin access.
- Create and edit an auction, place bids from multiple participants, and confirm live owner counts, audit history, and inbox updates.
- Close an auction and confirm exactly one closing event and one coalesced notification per recipient.
- Re-run a real concurrent database burst and confirm the bid sequence remains unique, gapless, and strictly increasing.
- Check desktop and mobile layouts, build output, runtime errors, and email-template rendering. Live email delivery remains dependent on sender-domain verification.
- Verify the refreshed palette and live states remain readable and polished across desktop and mobile viewports.
