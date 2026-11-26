export const centralMode = import.meta.env.VITE_IDENTITY_MODE !== "legacy";
export let localTesting = false;
type Session = {
  user: { id: string; username: string; role: string } | null;
  csrf: string | null;
  localDemo: boolean;
  configured: boolean;
};
const sessions = new Map<string, Promise<Session>>();
const pending = new Map<string, string>();
const base = () =>
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(
    /\/$/,
    "",
  ) || "/v1";
export async function session(surface: "member" | "console"): Promise<Session> {
  if (!sessions.has(surface))
    sessions.set(
      surface,
      (async () => {
        let response = await fetch(`${base()}/sso/session`, {
          credentials: "include",
          headers: { "x-joese-surface": surface },
        });
        if (!response.ok)
          throw new Error("The exchange identity service is unavailable.");
        let state = ((await response.json()) as { data: Session }).data;
        localTesting = state.localDemo;
        const requested = new URLSearchParams(window.location.search).get(
          "member",
        );
        const fixture =
          surface === "member" && ["alice", "bob"].includes(requested ?? "")
            ? requested
            : null;
        if (
          state.localDemo &&
          (!state.user || (fixture && state.user.id !== `demo-${fixture}`))
        ) {
          response = await fetch(`${base()}/sso/demo`, {
            method: "POST",
            credentials: "include",
            headers: {
              "content-type": "application/json",
              "x-joese-surface": surface,
            },
            body: JSON.stringify(fixture ? { member: fixture } : {}),
          });
          if (!response.ok)
            throw new Error("The local test accounts are not ready.");
          state = (
            (await (
              await fetch(`${base()}/sso/session`, {
                credentials: "include",
                headers: { "x-joese-surface": surface },
              })
            ).json()) as { data: Session }
          ).data;
        }
        return state;
      })().catch((error) => {
        sessions.delete(surface);
        throw error;
      }),
    );
  return sessions.get(surface)!;
}
export async function centralRequest<T>(
  surface: "member" | "console",
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const auth = await session(surface),
    write = init.method && !["GET", "HEAD"].includes(init.method),
    signature = `${surface}:${path}:${init.body ?? ""}`;
  if (write && !pending.has(signature))
    pending.set(signature, crypto.randomUUID());
  const response = await fetch(`${base()}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "content-type": "application/json",
      "x-joese-surface": surface,
      ...(auth.csrf ? { "x-csrf-token": auth.csrf } : {}),
      ...(write ? { "idempotency-key": pending.get(signature)! } : {}),
      ...(init.headers ?? {}),
    },
  });
  let payload: { data: T; error?: { message: string; code: string } };
  try {
    payload = await response.json();
  } catch {
    throw new Error("The exchange could not be reached. Try again shortly.");
  }
  if (!response.ok) {
    if (response.status < 500 && payload.error?.code !== "OPERATION_PLANNING")
      pending.delete(signature);
    if (response.status === 401) sessions.delete(surface);
    throw new Error(
      payload.error?.message ?? "This operation could not be completed.",
    );
  }
  pending.delete(signature);
  return payload.data;
}
export async function switchTestMember(member: "alice" | "bob") {
  const response = await fetch(`${base()}/sso/demo`, {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
      "x-joese-surface": "member",
    },
    body: JSON.stringify({ member }),
  });
  if (!response.ok) throw new Error("Could not switch test members.");
  sessions.delete("member");
}
export const signInUrl = (surface: "member" | "console") =>
  `${base()}/sso/${surface}/login`;
