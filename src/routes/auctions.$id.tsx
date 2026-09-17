import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/auctions/$id")({
  component: AuctionLayout,
});

function AuctionLayout() {
  return <Outlet />;
}
