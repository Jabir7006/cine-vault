import { useQueryClient } from "@tanstack/react-query";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

interface SectionErrorProps extends ErrorComponentProps {
  queryKey: unknown[];
  title: string;
}

const SectionError = ({ reset, queryKey, title }: SectionErrorProps) => {
  const queryClient = useQueryClient();

  const handleRetry = () => {
    queryClient.resetQueries({ queryKey });
    reset();
  };

  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-white/10 bg-white/5 p-10 text-center backdrop-blur-xl">
      <p className="text-sm text-neutral-300">
        We couldn't load {title}. Please try again.
      </p>
      <Button
        variant="outline"
        onClick={handleRetry}
        className="rounded-full border-white/15 bg-white/10 text-white backdrop-blur-md hover:bg-white/20 hover:text-white"
      >
        <RefreshCw className="size-4" />
        Retry
      </Button>
    </div>
  );
};

export default SectionError;