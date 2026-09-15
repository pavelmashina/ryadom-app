import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
if ("serviceWorker" in navigator && !location.hostname.match(/^(localhost|127\.0\.0\.1)$/)) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/ryadom-app/sw.js", { scope: "/ryadom-app/" })
      .catch((error) => console.warn("Не удалось включить работу без сети", error));
  });
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
