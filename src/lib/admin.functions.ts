import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const filtersSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  minPrice: z.number().nonnegative().optional(),
  maxPrice: z.number().nonnegative().optional(),
  bidder: z.string().max(100).optional(),
  title: z.string().max(100).optional(),
  status: z.string().max(30).optional(),
});

type AdminContext = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  userId: string;
};

async function requireAdmin(context: AdminContext) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error || !data) throw new Error("Forbidden");
}

export const getAdminOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => filtersSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let auctionQuery = supabaseAdmin.from("auctions").select("*").order("created_at", { ascending: false }).limit(200);
    if (data.from) auctionQuery = auctionQuery.gte("created_at", data.from);
    if (data.to) auctionQuery = auctionQuery.lte("created_at", data.to);
    if (data.minPrice !== undefined) auctionQuery = auctionQuery.gte("current_price", data.minPrice);
    if (data.maxPrice !== undefined) auctionQuery = auctionQuery.lte("current_price", data.maxPrice);
    if (data.title) auctionQuery = auctionQuery.ilike("title", `%${data.title}%`);
    if (data.status) auctionQuery = auctionQuery.eq("status", data.status);

    let bidQuery = supabaseAdmin.from("bids").select("*").order("created_at", { ascending: false }).limit(300);
    if (data.from) bidQuery = bidQuery.gte("created_at", data.from);
    if (data.to) bidQuery = bidQuery.lte("created_at", data.to);
    if (data.minPrice !== undefined) bidQuery = bidQuery.gte("amount", data.minPrice);
    if (data.maxPrice !== undefined) bidQuery = bidQuery.lte("amount", data.maxPrice);
    if (data.bidder) bidQuery = bidQuery.ilike("bidder_name", `%${data.bidder}%`);

    const [auctionsResult, bidsResult, profilesResult, rolesResult, usersResult] = await Promise.all([
      auctionQuery,
      bidQuery,
      supabaseAdmin.from("profiles").select("*").order("created_at", { ascending: false }).limit(200),
      supabaseAdmin.from("user_roles").select("user_id, role"),
      supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 }),
    ]);
    const error = auctionsResult.error || bidsResult.error || profilesResult.error || rolesResult.error || usersResult.error;
    if (error) throw error;

    const roles = new Map((rolesResult.data ?? []).map((role) => [role.user_id, role.role]));
    const profiles = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile]));
    const accounts = (usersResult.data.users ?? []).map((user) => ({
      id: user.id,
      email: user.email ?? "",
      displayName: profiles.get(user.id)?.display_name ?? "",
      createdAt: user.created_at,
      role: roles.get(user.id) ?? "user",
    }));

    return {
      currentUserId: context.userId,
      auctions: auctionsResult.data ?? [],
      bids: bidsResult.data ?? [],
      accounts,
    };
  });

export const updateAdminRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ userId: z.string().uuid(), enabled: z.boolean() }).parse(input))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { error } = await context.supabase.rpc("set_admin_role", {
      p_user_id: data.userId,
      p_enabled: data.enabled,
    });
    if (error) throw error;
    return { ok: true };
  });