import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/manrope/400.css";
import "@fontsource/manrope/600.css";
import "@fontsource/playfair-display/600.css";
import "@fontsource/fira-code/400.css";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import "./advanced.css";
import "./startup.css";
import { App } from "./App";
import osCodeIcon from "./assets/oscode-icon.png";
const root = ReactDOM.createRoot(document.getElementById("root")!);
if (!window.oscode) {
  root.render(
    <div className="bridge-error">
      <img className="mark" src={osCodeIcon} alt="osCode" />
      <h1>osCode couldn't start</h1>
      <p>
        The secure desktop bridge did not load. Restart osCode or reinstall the
        latest build.
      </p>
    </div>,
  );
} else {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
