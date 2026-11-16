'use client';

import type {
  CommunityReportSummary,
  CommunityVisibilityType,
  HiddenContentItem,
  ReportReasonType,
  ReportStatusType,
  UserRoleType,
  UserSummary,
} from '@/types/Community';

import { useCallback, useEffect, useState } from 'react';

// Hook to get current user's role
export function useUserRole() {
  const [role, setRole] = useState<UserRoleType>('user');
  const [isModerator, setIsModerator] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchRole() {
      try {
        const response = await fetch('/api/moderation/role');
        if (response.ok) {
          const data = await response.json();
          setRole(data.role);
          setIsModerator(data.isModerator);
          setIsAdmin(data.isAdmin);
        }
      } catch {
        // Silent fail - default to 'user'
      } finally {
        setLoading(false);
      }
    }

    fetchRole();
  }, []);

  return { role, isModerator, isAdmin, loading };
}

// Hook for fetching open reports
export function useOpenReports() {
  const [reports, setReports] = useState<CommunityReportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchReports = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/moderation/reports');
      if (!response.ok) {
        if (response.status === 403) {
          throw new Error('Not authorized');
        }
        throw new Error('Failed to load reports');
      }

      const data = await response.json();
      setReports(data.reports);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load reports');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  return { reports, loading, error, refetch: fetchReports };
}

// Hook for resolving reports
export function useResolveReport() {
  const [loading, setLoading] = useState(false);

  const resolveReport = useCallback(async (
    reportId: string,
    status: ReportStatusType,
  ): Promise<boolean> => {
    setLoading(true);

    try {
      const response = await fetch('/api/moderation/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId, status }),
      });

      return response.ok;
    } catch {
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  return { resolveReport, loading };
}

// Hook for fetching hidden content
export function useHiddenContent() {
  const [items, setItems] = useState<HiddenContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHiddenContent = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/moderation/visibility');
      if (!response.ok) {
        if (response.status === 403) {
          throw new Error('Not authorized');
        }
        throw new Error('Failed to load hidden content');
      }

      const data = await response.json();
      setItems(data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load hidden content');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHiddenContent();
  }, [fetchHiddenContent]);

  return { items, loading, error, refetch: fetchHiddenContent };
}

// Hook for updating content visibility (hide/unhide)
export function useUpdateVisibility() {
  const [loading, setLoading] = useState(false);

  const updateVisibility = useCallback(async (params: {
    postId?: string;
    commentId?: string;
    visibility: CommunityVisibilityType;
  }): Promise<boolean> => {
    setLoading(true);

    try {
      const response = await fetch('/api/moderation/visibility', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });

      return response.ok;
    } catch {
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  return { updateVisibility, loading };
}

// Hook for fetching users (admin only)
export function useUsers(search?: string) {
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (search) {
        params.set('search', search);
      }

      const response = await fetch(`/api/moderation/users?${params}`);
      if (!response.ok) {
        if (response.status === 403) {
          throw new Error('Not authorized');
        }
        throw new Error('Failed to load users');
      }

      const data = await response.json();
      setUsers(data.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  return { users, loading, error, refetch: fetchUsers };
}

// Hook for updating user role (admin only)
export function useUpdateUserRole() {
  const [loading, setLoading] = useState(false);

  const updateRole = useCallback(async (
    userId: string,
    role: UserRoleType,
  ): Promise<boolean> => {
    setLoading(true);

    try {
      const response = await fetch('/api/moderation/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, role }),
      });

      return response.ok;
    } catch {
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  return { updateRole, loading };
}

// Hook for submitting reports (with structured reason)
export function useSubmitReport() {
  const [loading, setLoading] = useState(false);

  const submitReport = useCallback(async (params: {
    postId?: string;
    commentId?: string;
    reason: ReportReasonType;
    details?: string;
  }): Promise<boolean> => {
    setLoading(true);

    try {
      const response = await fetch('/api/community/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });

      return response.ok;
    } catch {
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  return { submitReport, loading };
}
