import Navbar from "@/components/common/Navbar";
import ArchitecturePreview from "@/components/common/ArchitecturePreview";
import Brand from "@/components/common/Brand";
import { Button } from "@/components/ui/button";
import { ArrowUpRight, GitBranch, MousePointer2, Terminal } from "lucide-react";
import Link from "next/link";
export default function Home() {
  return (
    <div className="product-public">
      <Navbar />
      <main>
        <section className="landing-hero">
          <div>
            <p className="section-label">YOUR IDEAS. YOUR INFRASTRUCTURE.</p>
            <h1 className="display-heading">
              Build your cloud.
              <br />
              See the whole <em>picture.</em>
            </h1>
            <p className="hero-description">
              Give your infrastructure a shape. Connect your services, see the
              Terraform, and bring your architecture to life from one visual
              workspace.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-5">
              <Button asChild size="lg">
                <Link href="/login">
                  Start building <ArrowUpRight />
                </Link>
              </Button>
              <a
                href="#how-it-works"
                className="text-sm underline underline-offset-8"
              >
                Take a closer look ↓
              </a>
            </div>
            <p className="mt-10 text-xs text-muted-foreground">
              DESIGN VISUALLY <span className="mx-3 text-[var(--primary-text)]">✦</span>{" "}
              DEPLOY WITH TERRAFORM
            </p>
          </div>
          <div className="hero-art">
            <div className="hero-art-orbit" />
            <ArchitecturePreview />
            <span className="hero-art-caption">
              VISUAL DESIGN / REAL INFRASTRUCTURE
            </span>
          </div>
        </section>
        <section id="how-it-works" className="how-section">
          <div className="flex flex-wrap items-end justify-between gap-5">
            <div>
              <p className="section-label">A WORKFLOW THAT FLOWS</p>
              <h2 className="section-heading">
                Connect. Configure.
                <br />
                <em>Make it happen.</em>
              </h2>
            </div>
            <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
              One place to draw, configure, and understand the cloud you are
              about to create.
            </p>
          </div>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {[
              {
                number: "01",
                icon: MousePointer2,
                title: "Design your architecture",
                description:
                  "Build an architecture by dragging AWS resources onto your canvas. Connect the services that belong together.",
              },
              {
                number: "02",
                icon: GitBranch,
                title: "Configure with clarity",
                description:
                  "Configure each resource and save your diagram. Preview the generated Terraform before you run it.",
              },
              {
                number: "03",
                icon: Terminal,
                title: "Deploy from your canvas",
                description:
                  "Deploy to your connected AWS account and follow execution in the logs, right beside your architecture.",
              },
            ].map((step) => (
              <article key={step.number} className="workflow-step">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {step.number} /
                  </span>
                  <step.icon className="h-5 w-5 text-[var(--primary-text)]" />
                </div>
                <h3 className="mt-8 text-xl font-semibold">{step.title}</h3>
                <p className="mt-4 text-sm leading-7 text-muted-foreground">
                  {step.description}
                </p>
              </article>
            ))}
          </div>
        </section>
        <section className="landing-cta">
          <p className="section-label">YOUR NEXT BUILD STARTS HERE</p>
          <h2 className="section-heading">
            Turn your next idea
            <br />
            <em>into infrastructure.</em>
          </h2>
          <Button asChild size="lg" className="mt-8">
            <Link href="/login">
              Open Re-Clutter <ArrowUpRight />
            </Link>
          </Button>
        </section>
      </main>
      <footer className="public-footer">
        <Brand />
        <span className="text-xs text-muted-foreground">
          A visual workspace for cloud infrastructure.
        </span>
        <span className="text-xs text-muted-foreground">
          © {new Date().getFullYear()} Re-Clutter
        </span>
      </footer>
    </div>
  );
}
