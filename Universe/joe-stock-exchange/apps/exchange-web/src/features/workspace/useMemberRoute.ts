import { useEffect, useState } from "react";
import { memberPageForPath, memberPath, type MemberPage } from "./routes";
export function useMemberRoute() {
  const [location, setLocation] = useState(
    () => window.location.pathname + window.location.search,
  );
  useEffect(() => {
    const changed = () =>
      setLocation(window.location.pathname + window.location.search);
    window.addEventListener("popstate", changed);
    return () => window.removeEventListener("popstate", changed);
  }, []);
  const navigate = (
    page: Exclude<MemberPage, "not-found">,
    ticker?: string,
  ) => {
    const path =
      memberPath(page) +
      (page === "market" && ticker
        ? `?ticker=${encodeURIComponent(ticker)}`
        : "");
    if (window.location.pathname + window.location.search !== path)
      window.history.pushState({}, "", path);
    setLocation(path);
    window.scrollTo({ top: 0 });
  };
  return {
    page: memberPageForPath(location.split("?")[0]),
    location,
    navigate,
  };
}
