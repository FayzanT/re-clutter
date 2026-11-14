import WorkspaceShell from "@/components/common/WorkspaceShell";
export default function Layout({ children }: { children: React.ReactNode }) {
  return <WorkspaceShell>{children}</WorkspaceShell>;
}
