import { useMutation, useQueryClient } from "@tanstack/react-query";
import { triggerEnrich } from "../api/client";
import type { ContactWithScoring } from "../types";

export function useEnrich() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (contactId: string) => triggerEnrich(contactId),
    onMutate: async (contactId) => {
      await qc.cancelQueries({ queryKey: ["contacts"] });

      // Optimistic: set status to pending
      qc.setQueriesData<ContactWithScoring[]>(
        { queryKey: ["contacts"] },
        (old) =>
          old?.map((c) =>
            c.id === contactId
              ? { ...c, enrichissement_status: "pending" }
              : c
          )
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
    },
  });
}
