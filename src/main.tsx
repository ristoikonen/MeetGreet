import React from "react";
import { createRoot } from "react-dom/client";
import { Router, Route, Switch } from "wouter";
import App from "./App";
import GlowForm from "./GlowForm";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Router>
      <Switch>
        <Route path="/glow2" component={GlowForm} />
        <Route path="/glow2.html" component={GlowForm} />
        <Route path="/" component={App} />
        <Route component={App} />
      </Switch>
    </Router>
  </React.StrictMode>,
);