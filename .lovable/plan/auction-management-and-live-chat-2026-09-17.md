# Auction management and live chat

## Build
- Add an edit panel to each owned auction for starting price, minimum increment, and end time, with save feedback and safe numeric/date validation.
- Keep the live auction page focused on fast mobile bidding: current price first, a minimum-bid shortcut, clear auction timing/status, and a full-width submit action on small screens.
- Add a persistent chat feed per auction. Signed-in bidders can post messages; everyone viewing the auction can read new messages instantly.
- Keep the existing live bid feed and owner-only database stress test intact.

## Data and access
- Add an `auction_messages` table with explicit database grants and row-level access rules.
- Allow public message reading, authenticated posting only as the signed-in user, and no client-side editing or deletion.
- Publish chat inserts to the existing real-time stream and index messages for efficient auction-by-auction loading.

## Validation
- Confirm auction edits save and refresh correctly.
- Confirm chat messages appear instantly and persist after reload.
- Check the auction page at desktop and mobile sizes, then confirm the current build is healthy.

## Technical details
- Reuse the existing Lovable Cloud client, query cache, and current design controls.
- Store the sender display name with each message for stable chat history.
- Treat an empty end-time field as no deadline and send saved dates in UTC.
