import React from "react";
import { createRoot } from "react-dom/client";
import { BlueprintApp } from "@/components/BlueprintApp";
import "@/styles/globals.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BlueprintApp />
  </React.StrictMode>,
);
