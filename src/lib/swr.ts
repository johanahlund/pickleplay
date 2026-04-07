import useSWR, { mutate } from "swr";

const fetcher = (url: string) => fetch(url).then((r) => {
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
});

/** Fetch event data with SWR */
export function useEvent(eventId: string | null) {
  const { data, error, isLoading, mutate: revalidate } = useSWR(
    eventId ? `/api/events/${eventId}` : null,
    fetcher,
    { revalidateOnFocus: true, dedupingInterval: 2000 }
  );
  return { event: data, error, isLoading, revalidate };
}

/** Fetch club data with SWR */
export function useClub(clubId: string | null) {
  const { data, error, isLoading, mutate: revalidate } = useSWR(
    clubId ? `/api/clubs/${clubId}` : null,
    fetcher,
    { revalidateOnFocus: true, dedupingInterval: 2000 }
  );
  return { club: data, error, isLoading, revalidate };
}

/** Fetch my clubs */
export function useMyClubs() {
  const { data, error, isLoading, mutate: revalidate } = useSWR(
    "/api/clubs",
    fetcher,
    { revalidateOnFocus: true }
  );
  return { clubs: data || [], error, isLoading, revalidate };
}

/** Revalidate a specific key globally */
export function revalidateEvent(eventId: string) {
  mutate(`/api/events/${eventId}`);
}

export function revalidateClub(clubId: string) {
  mutate(`/api/clubs/${clubId}`);
}

export { fetcher, mutate };
