import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../api/client';
import type { CheckResult, Endpoint } from '../api/types';

export function useEndpointDetail(id: string) {
  const [data, setData] = useState<{ endpoint: Endpoint; checks: CheckResult[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => { setLoading(true); setRevision(value => value + 1); }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null);
    void Promise.all([api.get(id, controller.signal), api.history(id, 100, controller.signal)])
      .then(([endpoint, { checks }]) => { if (!controller.signal.aborted) setData({ endpoint, checks }); })
      .catch(failure => { if (!controller.signal.aborted) setError(errorMessage(failure)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, revision]);
  return { data, loading, error, refresh };
}
