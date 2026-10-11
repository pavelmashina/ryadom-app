import { PwaLifecycle, StartupBoundary } from "./PwaLifecycle";
import React from "react";
import { createRoot } from "react-dom/client";
import CloudGate from "./CloudGate";
import { checkSupabaseConnection } from "./supabase";
import "./styles.css";
import "./cloud.css";

void checkSupabaseConnection().then((result) => {
  if (!result.ok) console.warn("Supabase недоступен:", result.error);
});

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PwaLifecycle />
    <StartupBoundary>
      <CloudGate />
    </StartupBoundary>
  </React.StrictMode>,
);
