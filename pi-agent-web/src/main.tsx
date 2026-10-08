import { createRoot } from "react-dom/client";
import "katex/dist/katex.min.css";
import "./index.css";
import App from "./App";

const container = document.getElementById("root");
if (!container) throw new Error("#root not found");

createRoot(container).render(<App />);
