import * as monaco from "monaco-editor/editor/editor.api";
import editorWorker from "monaco-editor/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/language/json/json.worker?worker";
import cssWorker from "monaco-editor/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/language/html/html.worker?worker";
import typescriptWorker from "monaco-editor/language/typescript/ts.worker?worker";
import "monaco-editor/languages/definitions/register.all";
import "monaco-editor/language/css/monaco.contribution";
import "monaco-editor/language/html/monaco.contribution";
import "monaco-editor/language/json/monaco.contribution";
import "monaco-editor/language/typescript/monaco.contribution";

type WorkerConstructor = new () => Worker;
const workerFor = (label: string): WorkerConstructor => {
  if (label === "json") return jsonWorker;
  if (["css", "scss", "less"].includes(label)) return cssWorker;
  if (["html", "handlebars", "razor"].includes(label)) return htmlWorker;
  if (["typescript", "javascript"].includes(label)) return typescriptWorker;
  return editorWorker;
};

globalThis.MonacoEnvironment = {
  getWorker: (_moduleId: string, label: string) => {
    const MonacoWorker = workerFor(label);
    return new MonacoWorker();
  },
};

export { monaco };
