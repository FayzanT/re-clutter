import Image from "next/image";
import Link from "next/link";

export default function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      href="/"
      aria-label="Re-Clutter home"
      className="inline-flex items-center gap-3"
    >
      <Image
        src="/logos/re-cl.svg"
        alt="Re-CL"
        width={40}
        height={40}
        className="shrink-0"
      />
      {!compact && <span className="brand-wordmark">Re-Clutter</span>}
    </Link>
  );
}
