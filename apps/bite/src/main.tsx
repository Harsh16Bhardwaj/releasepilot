import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { TrafficLab } from "./TrafficLab.js";
import "./style.css";
import "./readability.css";
createRoot(document.getElementById("root")!).render(
  location.pathname === "/lab" ? <TrafficLab /> : <App />,
);
