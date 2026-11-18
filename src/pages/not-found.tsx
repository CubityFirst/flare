import { Link } from "react-router";
import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  return (
    <div className="flex flex-col items-center gap-4 py-24 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <Button asChild variant="outline">
        <Link to="/">Back to your feed</Link>
      </Button>
    </div>
  );
}
