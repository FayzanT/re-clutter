"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useTerraformFiles } from "@/lib/features/diagram/hooks";
import { filesPredateStatus } from "@/lib/features/diagram/types";

// How long the panel keeps asking for a run of the latest save before it says
// what it has. Generation normally finishes within a few seconds of a save.
const GENERATION_WAIT_MS = 10_000;

function errorMessage(error: Error): string {
  try {
    const parsed = JSON.parse(error.message);
    return typeof parsed.message === "string" ? parsed.message : error.message;
  } catch {
    return error.message;
  }
}

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Notice({ tone, onRetry, children }: {
  tone: "info" | "warning";
  onRetry?: () => void;
  children: React.ReactNode;
}) {
  const colors = tone === "warning"
    ? "border-amber-700 bg-amber-500/10 text-amber-100"
    : "border-border bg-card text-foreground";
  return (
    <div role={tone === "warning" ? "alert" : "status"} className={`mt-5 rounded-lg border p-4 text-sm ${colors}`}>
      {children}
      {onRetry && <Button onClick={onRetry} className="mt-3">Check again</Button>}
    </div>
  );
}

function PreviewBody({ token, projectId, diagramId, hasResources }: {
  token: string | null;
  projectId: string;
  diagramId: string;
  hasResources: boolean;
}) {
  const [filename, setFilename] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const query = useTerraformFiles(token, projectId, diagramId, waiting);

  useEffect(() => {
    const timer = setTimeout(() => setWaiting(false), GENERATION_WAIT_MS);
    return () => clearTimeout(timer);
  }, [attempt]);

  const retry = () => {
    setWaiting(true);
    setAttempt((value) => value + 1);
    void query.refetch();
  };

  if (query.error) {
    return (
      <Notice tone="warning" onRetry={retry}>
        <p>{errorMessage(query.error)}</p>
      </Notice>
    );
  }
  if (!query.data) {
    return <Notice tone="info"><p>Loading your Terraform…</p></Notice>;
  }

  const { files, status, generated, current } = query.data;
  const names = Object.keys(files).sort();
  const selected = filename && names.includes(filename)
    ? filename
    : names.includes("main.tf") ? "main.tf" : names[0];
  const predatesStatus = filesPredateStatus(query.data);
  const generating = !current && waiting && !predatesStatus;
  const failed = status?.state === "failed";

  return (
    <>
      {predatesStatus && (
        <Notice tone="info" onRetry={retry}>
          <p>These files were generated before status tracking. Save the diagram to refresh them.</p>
        </Notice>
      )}
      {generating && (
        <Notice tone="info">
          <p>Still generating. This panel updates when the new files are ready.</p>
          {names.length > 0 && <p className="mt-1">The files below may be from before your last save.</p>}
        </Notice>
      )}
      {!generating && failed && (
        <Notice tone="warning" onRetry={retry}>
          <p className="font-medium">The last generation failed.</p>
          <p className="mt-1 break-words">{status.error || "No details were recorded."}</p>
          <p className="mt-1">
            {names.length === 0
              ? "There are no earlier files to show."
              : status.filesIncomplete
                ? "The files shown may be incomplete, or a mix of two generations. Do not use them until a generation succeeds."
                : "The files shown are from the last successful generation."}
          </p>
        </Notice>
      )}
      {!generating && !generated && (
        <Notice tone="info" onRetry={retry}>
          <p>No Terraform has been generated yet. Save the diagram to generate it.</p>
        </Notice>
      )}
      {!generating && !failed && !predatesStatus && generated && !current && names.length > 0 && (
        <Notice tone="warning" onRetry={retry}>
          <p>Generation has not reported back, so these files may be older than your last save.</p>
        </Notice>
      )}
      {!generating && !failed && generated && names.length === 0 && (
        <Notice tone="info" onRetry={retry}>
          <p>Generation finished, but there are no Terraform files to show.</p>
        </Notice>
      )}
      {!hasResources && !generating && !failed && names.length > 0 && (
        <Notice tone="info">
          <p>This diagram has no resources, so only the provider settings are generated.</p>
        </Notice>
      )}
      {selected && (
        <>
          <div className="my-4 flex flex-wrap items-center gap-2">
            {names.map((name) => (
              <Button
                key={name}
                aria-pressed={selected === name}
                variant={selected === name ? "default" : "outline"}
                onClick={() => setFilename(name)}
              >
                {name}
              </Button>
            ))}
            {names.map((name) => (
              <Button key={name} variant="outline" onClick={() => download(name, files[name])}>
                Download {name}
              </Button>
            ))}
          </div>
          <pre
            aria-label={selected}
            className="max-h-[50vh] overflow-auto rounded-lg border border-border bg-secondary p-4 text-xs leading-6"
          >
            <code>{files[selected] || "No output in this file."}</code>
          </pre>
          <p className="mt-3 text-xs text-muted-foreground">
            {status && `Last generation finished ${new Date(status.finishedAt).toLocaleString()}. `}
            Uses the existing AWS templates. The AWS region variable and any Lambda code packages must be supplied separately before deployment.
          </p>
        </>
      )}
    </>
  );
}

export default function TerraformPreview({ token, projectId, diagramId, disabled, hasResources }: {
  token: string | null;
  projectId: string;
  diagramId: string;
  disabled: boolean;
  hasResources: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  const show = () => {
    setOpen(true);
    dialog.current?.showModal();
  };

  return (
    <>
      <Button
        onClick={show}
        disabled={disabled || !token}
        title={disabled ? "Save the diagram before previewing Terraform" : "See the Terraform generated from your saved diagram"}
        className="h-10 rounded-lg border border-border bg-card px-5 text-foreground hover:bg-card"
      >
        Preview Terraform
      </Button>
      <dialog
        ref={dialog}
        onClose={() => setOpen(false)}
        aria-labelledby="terraform-preview-title"
        className="nowheel nopan nodrag m-auto max-h-[90vh] w-[min(1100px,95vw)] rounded-xl border border-border bg-card p-6 text-foreground shadow-2xl backdrop:bg-black/70"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="terraform-preview-title" className="text-lg font-semibold">Terraform preview</h2>
            <p className="mt-1 text-sm text-muted-foreground">Generated from your saved diagram. Nothing is deployed.</p>
          </div>
          <Button autoFocus onClick={() => dialog.current?.close()} variant="outline">Close</Button>
        </div>
        {open && (
          <PreviewBody token={token} projectId={projectId} diagramId={diagramId} hasResources={hasResources} />
        )}
      </dialog>
    </>
  );
}
