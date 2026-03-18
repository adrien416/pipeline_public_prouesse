import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchContacts,
  createContact,
  updateContact,
} from "../api/client";
import type {
  ContactFilters,
  ContactCreatePayload,
  ContactUpdatePayload,
  ContactWithScoring,
} from "../types";

export function useContacts(filters?: ContactFilters) {
  return useQuery({
    queryKey: ["contacts", filters],
    queryFn: () => fetchContacts(filters),
  });
}

export function useCreateContact() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (data: ContactCreatePayload) => createContact(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
    },
  });
}

export function useUpdateContact() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (data: ContactUpdatePayload) => updateContact(data),
    onMutate: async (data) => {
      await qc.cancelQueries({ queryKey: ["contacts"] });

      const previous = qc.getQueriesData<ContactWithScoring[]>({
        queryKey: ["contacts"],
      });

      // Optimistic update
      qc.setQueriesData<ContactWithScoring[]>(
        { queryKey: ["contacts"] },
        (old) =>
          old?.map((c) =>
            c.id === data.id ? { ...c, ...data } as ContactWithScoring : c
          )
      );

      return { previous };
    },
    onError: (_err, _data, context) => {
      // Rollback
      if (context?.previous) {
        for (const [key, value] of context.previous) {
          qc.setQueryData(key, value);
        }
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
    },
  });
}
