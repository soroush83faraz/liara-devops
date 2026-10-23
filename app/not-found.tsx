import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { faErrors } from "@/lib/deploy/fa-errors";

export default function NotFound() {
  return (
    <main id="main-content" className="mx-auto flex min-h-dvh w-full max-w-lg items-center justify-center px-4">
      <EmptyState
        icon={<FileQuestion />}
        title={faErrors.notFound.title}
        description={faErrors.notFound.description}
        action={
          <Link href="/" className={buttonVariants({ variant: "primary" })}>
            {faErrors.notFound.home}
          </Link>
        }
      />
    </main>
  );
}
