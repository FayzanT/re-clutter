import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface AwsAccountDangerZoneProps {
  accountName: string;
  isDeleting: boolean;
  onRequestDelete: () => void;
}

export default function AwsAccountDangerZone({ accountName, isDeleting, onRequestDelete }: AwsAccountDangerZoneProps) {
  return (
    <Card className="border-red-900/60 bg-red-500/10 shadow-none">
      <CardHeader>
        <CardTitle className="text-xl text-red-700 dark:text-red-300">Danger zone</CardTitle>
        <CardDescription className="text-red-700 dark:text-red-300/70">
          Deleting this AWS account link removes it from the organization and returns this page to the account creation flow.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-foreground">
          Delete <span className="font-semibold text-foreground">{accountName}</span> if you need to recreate the link from scratch.
        </p>
        <Button
          type="button"
          onClick={onRequestDelete}
          disabled={isDeleting}
          className="bg-red-600 text-foreground hover:bg-red-500/100"
        >
          {isDeleting ? "Deleting account..." : "Delete account link"}
        </Button>
      </CardContent>
    </Card>
  );
}
