import {
  ArrowDown,
  Cloud,
  Database,
  Globe2,
  Layers2,
  Server,
} from "lucide-react";
export default function ArchitecturePreview() {
  return (
    <div
      className="architecture-preview"
      aria-label="Illustration of an example cloud architecture"
    >
      <div className="flex items-center justify-between border-b border-white/10 pb-5 text-xs">
        <span className="flex items-center gap-2 text-[var(--primary-text)]">
          <Layers2 className="h-4 w-4" /> EXAMPLE ARCHITECTURE
        </span>
        <span className="text-muted-foreground">AWS / 01</span>
      </div>
      <div className="preview-grid">
        <div className="preview-node">
          <Globe2 />
          <div>
            <strong>API Gateway</strong>
            <span>Your front door</span>
          </div>
          <span className="preview-node-index">01</span>
        </div>
        <ArrowDown className="preview-connector" />
        <div className="preview-node preview-node-featured">
          <Server />
          <div>
            <strong>Lambda</strong>
            <span>Your application logic</span>
          </div>
          <span className="preview-node-index">02</span>
        </div>
        <ArrowDown className="preview-connector" />
        <div className="preview-node">
          <Database />
          <div>
            <strong>DynamoDB</strong>
            <span>Your data layer</span>
          </div>
          <span className="preview-node-index">03</span>
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-white/10 pt-5 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          <Cloud className="h-4 w-4" /> Diagram to Terraform
        </span>
        <span className="text-[var(--primary-text)]">Built visually ↗</span>
      </div>
    </div>
  );
}
