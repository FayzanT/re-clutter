import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Tabs() {
  const pathname = usePathname();
  
  const isManage = pathname?.endsWith("/manage");
  const isAwsAccount = pathname?.endsWith("/aws-account");

  const tabBase = "px-4 py-2 text-m font-medium border-b-2 -mb-px transition-colors";
  const inactiveTab = tabBase +  " border-transparent text-muted-foreground hover:text-foreground hover:border-border";
  const activeTab = tabBase + " border-primary text-foreground";

  return (
    <nav className="border-b border-border mb-6 flex gap-4 text-m">
      <Link
        href="/settings/organization/manage"
        className={isManage ? activeTab : inactiveTab}
      >
        Manage
      </Link>
      <Link
        href="/settings/organization/aws-account"
        className={isAwsAccount ? activeTab : inactiveTab}
      >
        AWS Account
      </Link>
    </nav>
  );
}
