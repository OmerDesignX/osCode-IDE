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
import osCodeIcon from "./assets/oscode-icon.png";

type MonacoRequire = {
  config(options: { paths: { vs: string } }): void;
  (
    modules: string[],
    ready: () => void,
    failed: (error: unknown) => void,
  ): void;
};

async function loadMonaco() {
  const target = globalThis as typeof globalThis & {
    monaco?: unknown;
    require?: MonacoRequire;
  };
  if (target.monaco) return;
  const runtime = new URL("./monaco/vs/", window.location.href);
  await new Promise<void>((resolve, reject) => {
    const loader = document.createElement("script");
    loader.src = new URL("loader.js", runtime).toString();
    loader.addEventListener("error", () =>
      reject(new Error("The bundled Monaco loader is unavailable")),
    );
    loader.addEventListener("load", () => {
      const amd = target.require;
      if (!amd) {
        reject(new Error("The bundled Monaco loader did not initialize"));
        return;
      }
      amd.config({ paths: { vs: runtime.toString().replace(/\/$/, "") } });
      amd(["vs/editor/editor.main"], resolve, reject);
    });
    document.head.append(loader);
  });
}

const root = ReactDOM.createRoot(document.getElementById("root")!);

function renderStartupError(message: string) {
  root.render(
    <div className="bridge-error">
      <img className="mark" src={osCodeIcon} alt="osCode" />
      <h1>osCode couldn't start</h1>
      <p>{message}</p>
    </div>,
  );
}

if (!window.oscode) {
  renderStartupError(
    "The secure desktop bridge did not load. Restart osCode or reinstall the latest build.",
  );
} else {
  void loadMonaco()
    .then(() => import("./App"))
    .then(({ App }) => {
      root.render(
        <React.StrictMode>
          <App />
        </React.StrictMode>,
      );
    })
    .catch(() =>
      renderStartupError(
        "The bundled editor could not load. Restart osCode or reinstall the latest build.",
      ),
    );
}
