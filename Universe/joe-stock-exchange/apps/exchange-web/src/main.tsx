import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@joese/ui/theme.css";
import { App } from "./App";
import { MemberGuide } from "./features/guide/MemberGuide";
import "./styles.css";
import "./features/guide/member-guide.css";

// The guide is a public, shareable route and never starts a member API session.
const isGuide = /^\/guide\/?$/.test(window.location.pathname);

createRoot(document.getElementById("root")!).render(
  <StrictMode>{isGuide ? <MemberGuide /> : <App />}</StrictMode>,
);

import "../../shared/listing.css";
