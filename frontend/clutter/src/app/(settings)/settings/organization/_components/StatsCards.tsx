import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Activity, FolderOpen, Users } from 'lucide-react';

interface StatsCardsProps {
  planType: string;
  projectCount: number;
  memberCount: number;
}

export default function StatsCards({ planType, projectCount, memberCount }: StatsCardsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
      <Card className="bg-card backdrop-blur-xl border-border">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Current Plan
          </CardTitle>
          <Activity className="w-4 h-4 text-[var(--primary-text)]" />
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-foreground">{planType}</div>
        </CardContent>
      </Card>

      <Card className="bg-card backdrop-blur-xl border-border">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Projects
          </CardTitle>
          <FolderOpen className="w-4 h-4 text-[var(--primary-text)]" />
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-foreground">{projectCount}</div>
        </CardContent>
      </Card>

      

      <Card className="bg-card backdrop-blur-xl border-border">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Members
          </CardTitle>
          <Users className="w-4 h-4 text-[var(--primary-text)]" />
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-foreground">{memberCount}</div>
        </CardContent>
      </Card>
    </div>
  );
}
