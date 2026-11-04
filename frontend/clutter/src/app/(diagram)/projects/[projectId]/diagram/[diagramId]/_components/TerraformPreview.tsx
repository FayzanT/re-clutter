"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useTerraformPreview } from "@/lib/features/diagram/hooks";

type Filename = "main.tf" | "outputs.tf";

function errorMessage(error: Error): string {
  try {
    const parsed = JSON.parse(error.message);
    return typeof parsed.error === "string" ? parsed.error : error.message;
  } catch {
    return error.message;
  }
}

export default function TerraformPreview({ token, projectId, diagramId, disabled }: {
  token: string | null;
  projectId: string;
  diagramId: string;
  disabled: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const preview = useTerraformPreview(token);
  const [filename, setFilename] = useState<Filename>("main.tf");

  const generate = () => {
    setFilename("main.tf");
    dialog.current?.showModal();
    preview.mutate({ projectId, diagramId });
  };

  const download = (name: Filename) => {
    const content = preview.data?.files[name];
    if (!content) return;
    const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return <>
    <Button
      onClick={generate}
      disabled={disabled || !token || preview.isPending}
      title={disabled ? "Save the diagram before previewing Terraform" : "View Terraform without deploying"}
      className="h-10 rounded-lg border border-slate-600 bg-slate-900 px-5 text-white hover:bg-slate-800"
    >
      {preview.isPending ? "Generating…" : "Preview Terraform"}
    </Button>
    <dialog
      ref={dialog}
      aria-labelledby="terraform-preview-title"
      className="m-auto w-[min(1100px,95vw)] max-h-[90vh] rounded-xl border border-slate-700 bg-slate-950 p-6 text-slate-100 shadow-2xl backdrop:bg-black/70"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="terraform-preview-title" className="text-lg font-semibold">Terraform preview</h2>
          <p className="mt-1 text-sm text-slate-400">Generated from your saved diagram. Nothing is deployed.</p>
        </div>
        <Button autoFocus onClick={() => dialog.current?.close()} variant="outline">Close</Button>
      </div>
      {preview.isPending && <p role="status" className="py-8">Generating Terraform…</p>}
      {preview.error && <div role="alert" className="mt-5 rounded-lg border border-red-800 p-4">
        <p>{errorMessage(preview.error)}</p>
        <Button onClick={generate} className="mt-3">Retry</Button>
      </div>}
      {preview.data && !preview.isPending && <>
        <div className="my-4 flex flex-wrap items-center gap-2">
          {(["main.tf", "outputs.tf"] as const).map((name) => <Button
            key={name}
            aria-pressed={filename === name}
            variant={filename === name ? "default" : "outline"}
            onClick={() => setFilename(name)}
          >{name}</Button>)}
          <Button variant="outline" onClick={() => download("main.tf")}>Download main.tf</Button>
          <Button variant="outline" onClick={() => download("outputs.tf")}>Download outputs.tf</Button>
        </div>
        <pre aria-label={filename} className="max-h-[60vh] overflow-auto rounded-lg border border-slate-800 bg-black/40 p-4 text-xs leading-6">
          <code>{preview.data.files[filename] || "No output in this file."}</code>
        </pre>
        <p className="mt-3 text-xs text-slate-400">Uses the existing AWS templates. The AWS region variable and any Lambda code packages must be supplied separately before deployment.</p>
      </>}
    </dialog>
  </>;
}
