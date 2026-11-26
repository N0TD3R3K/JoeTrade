export const MEMBER_DESTINATIONS = [
  { page: "account", path: "/account", label: "Account Overview" },
  { page: "market", path: "/market", label: "Stock Listings" },
  { page: "news", path: "/news", label: "News" },
  { page: "posts", path: "/posts", label: "Posts" },
  { page: "discussion", path: "/discussion", label: "Discussion" },
  { page: "company", path: "/company", label: "My Company" },
] as const;
export type MemberPage =
  (typeof MEMBER_DESTINATIONS)[number]["page"] | "settings" | "not-found";
export function memberPageForPath(path: string): MemberPage {
  const normalized = path.replace(/\/+$/, "") || "/";
  if (normalized === "/" || normalized === "/verify") return "account";
  if (normalized === "/settings") return "settings";
  return (
    MEMBER_DESTINATIONS.find((x) => x.path === normalized)?.page ?? "not-found"
  );
}
export function memberPath(page: Exclude<MemberPage, "not-found">): string {
  return page === "settings"
    ? "/settings"
    : MEMBER_DESTINATIONS.find((x) => x.page === page)!.path;
}
