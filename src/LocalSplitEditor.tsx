import { useEffect, useRef } from "react";
import { monaco } from "./monaco";

export default function LocalSplitEditor({
  path,
  value,
  theme,
  options,
  onChange,
}: {
  path: string;
  value: string;
  theme: string;
  options: monaco.editor.IStandaloneEditorConstructionOptions;
  onChange: (value: string) => void;
}) {
  const left = useRef<HTMLDivElement>(null);
  const right = useRef<HTMLDivElement>(null);
  const change = useRef(onChange);
  change.current = onChange;
  useEffect(() => {
    if (!left.current || !right.current) return;
    const uri = monaco.Uri.parse(
      `inmemory://oscode/split/${encodeURIComponent(path)}`,
    );
    const model = monaco.editor.createModel(value, undefined, uri);
    const first = monaco.editor.create(left.current, {
      ...options,
      model,
      theme,
    });
    const second = monaco.editor.create(right.current, {
      ...options,
      model,
      theme,
    });
    const subscription = model.onDidChangeContent(() =>
      change.current(model.getValue()),
    );
    return () => {
      subscription.dispose();
      first.dispose();
      second.dispose();
      model.dispose();
    };
  }, [path]);
  useEffect(() => monaco.editor.setTheme(theme), [theme]);
  return (
    <div className="split-editor-host">
      <div ref={left} />
      <div ref={right} />
    </div>
  );
}
