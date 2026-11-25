import { signInUrl } from "./central-client";
export function CentralSignIn({
  surface,
  message,
}: {
  surface: "member" | "console";
  message?: string | null;
}) {
  return (
    <div className="central-signin">
      <div className="brand-gem">J</div>
      <h1>
        {surface === "console" ? "Market Operations" : "JOE Stock Exchange"}
      </h1>
      <p>
        One Joe Universe identity. Your banking account, exchange membership,
        and history stay connected.
      </p>
      {message && <div role="alert">{message}</div>}
      <a href={signInUrl(surface)}>Continue with JoeAuth</a>
      {surface === "member" && (
        <a className="member-guide-signin-link" href="/guide">
          Read the JoeSE member guide
        </a>
      )}
      <small>
        Product permissions are checked separately. J$ is fictional and has no
        real-world value.
      </small>
    </div>
  );
}
