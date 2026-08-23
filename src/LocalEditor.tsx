import { useEffect, useRef } from "react";
import { monaco } from "./monaco";

type LocalEditorProps = {
  path: string;
  language?: string;
  value: string;
  theme: string;
  beforeMount?: (api: typeof monaco) => void;
  onMount?: (editor: monaco.editor.IStandaloneCodeEditor) => void;
  onChange?: (value: string) => void;
  revealLine?: number;
  onReveal?: () => void;
  options?: monaco.editor.IStandaloneEditorConstructionOptions;
};

export default function LocalEditor({
  path,
  language,
  value,
  theme,
  beforeMount,
  onMount,
  onChange,
  revealLine,
  onReveal,
  options,
}: LocalEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const models = useRef(new Map<string, monaco.editor.ITextModel>());
  const change = useRef(onChange);
  change.current = onChange;

  useEffect(() => {
    if (!host.current) return;
    beforeMount?.(monaco);
    const instance = monaco.editor.create(host.current, {
      ...options,
      model: null,
      theme,
    });
    editor.current = instance;
    const subscription = instance.onDidChangeModelContent(() =>
      change.current?.(instance.getValue()),
    );
    onMount?.(instance);
    return () => {
      subscription.dispose();
      instance.dispose();
      for (const model of models.current.values()) model.dispose();
      models.current.clear();
      editor.current = null;
    };
  }, []);

  useEffect(() => {
    const instance = editor.current;
    if (!instance) return;
    const uri = monaco.Uri.file(path);
    const key = uri.toString();
    let model = models.current.get(key);
    if (!model) {
      model = monaco.editor.createModel(value, language, uri);
      models.current.set(key, model);
    } else {
      if (language) monaco.editor.setModelLanguage(model, language);
      if (model.getValue() !== value) model.setValue(value);
    }
    instance.setModel(model);
    if (host.current) {
      host.current.dataset.oscodeReady = "true";
      host.current.dataset.oscodeModelLength = String(model.getValueLength());
      host.current.dataset.oscodeLanguage = model.getLanguageId();
    }
  }, [path, language]);

  useEffect(() => {
    if (!revealLine || !editor.current) return;
    editor.current.revealLineInCenter(revealLine);
    editor.current.setPosition({ lineNumber: revealLine, column: 1 });
    editor.current.focus();
    onReveal?.();
  }, [path, revealLine]);

  useEffect(() => {
    const model = editor.current?.getModel();
    if (!model) return;
    if (model.getValue() !== value) model.setValue(value);
    if (host.current)
      host.current.dataset.oscodeModelLength = String(model.getValueLength());
  }, [path, value]);

  useEffect(() => monaco.editor.setTheme(theme), [theme]);
  useEffect(() => {
    editor.current?.updateOptions(options || {});
    if (host.current)
      host.current.dataset.oscodeWordWrap = String(options?.wordWrap || "off");
  }, [options]);

  return <div className="local-editor-host" ref={host} />;
}
