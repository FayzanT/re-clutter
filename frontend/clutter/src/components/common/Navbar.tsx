import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import ThemeToggle from "./ThemeToggle";
import Brand from "./Brand";
import { Button } from "@/components/ui/button";
export default function Navbar({ showLogin = true }: { showLogin?: boolean }) {
  return (
    <header className="public-nav">
      <Brand />
      <nav aria-label="Public navigation" className="flex items-center gap-6">
        <Link
          href="/#how-it-works"
          className="hidden text-sm text-muted-foreground hover:text-foreground sm:block"
        >
          How it works
        </Link>
        {showLogin ? (
          <Button asChild>
            <Link href="/login">
              Enter your workspace <ArrowUpRight />
            </Link>
          </Button>
        ) : (
          <Link
            href="/"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Back to home ↗
          </Link>
        )}
        <ThemeToggle />
      </nav>
    </header>
  );
}
