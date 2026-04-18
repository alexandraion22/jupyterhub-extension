import { ServerConnection } from '@jupyterlab/services';

const settings = ServerConnection.makeSettings();

export type Role = 'viewer' | 'editor';
export type GeneralAccess = 'restricted' | 'domain';
export type AccessLevel = 'read' | 'write';

export interface Recipient {
  email: string;
  role: Role;
}

export interface Permission {
  user_email: string;
  access_level: AccessLevel;
  created_at: string | null;
}

export interface PermissionsResponse {
  volume_name: string;
  display_name: string;
  owner: string;
  is_owner: boolean;
  owner_domain: string;
  general_access: GeneralAccess;
  link_access_level: AccessLevel;
  permissions: Permission[];
}

export interface ShareSummary {
  volume_name: string;
  display_name: string;
  owner: string;
  access_level: AccessLevel;
  is_owner: boolean;
  general_access: GeneralAccess;
  link_access_level: AccessLevel;
  via: 'owner' | 'direct' | 'domain-link';
}

const jsonError = async (response: Response, fallback: string): Promise<string> => {
  try {
    const data = await response.json();
    return data?.error?.message || data?.error || fallback;
  } catch {
    return fallback;
  }
};

const request = async <T>(path: string, init: RequestInit, token?: string): Promise<T> => {
  const headers = new Headers(init.headers as HeadersInit);
  headers.set('Content-Type', 'application/json');
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const response = await ServerConnection.makeRequest(
    `${settings.baseUrl}${path}`,
    { ...init, headers },
    settings
  );
  if (!response.ok) {
    throw new Error(await jsonError(response, response.statusText));
  }
  return (await response.json()) as T;
};

export const fetchApiToken = async (): Promise<string | null> => {
  try {
    const response = await ServerConnection.makeRequest(
      `${settings.baseUrl}jlab-examples/google-token`,
      {},
      settings
    );
    if (!response.ok) {
      console.error('Failed to fetch API token:', response.statusText);
      return null;
    }
    const data = (await response.json()) as { token?: string };
    return data.token ?? null;
  } catch (error) {
    console.error('Error fetching API token:', error);
    return null;
  }
};

export interface ShareRequest {
  directoryName: string;
  recipients: Recipient[];
  generalAccess?: GeneralAccess;
  linkAccessLevel?: AccessLevel;
}

export interface ShareResponse {
  message: string;
  volume_name: string;
  display_name: string;
  general_access: GeneralAccess;
  link_access_level: AccessLevel;
  added: string[];
}

export const shareFolder = (req: ShareRequest, token: string): Promise<ShareResponse> =>
  request<ShareResponse>(
    'jlab-examples/share',
    {
      method: 'POST',
      body: JSON.stringify({
        directory_name: req.directoryName,
        recipients: req.recipients,
        general_access: req.generalAccess,
        link_access_level: req.linkAccessLevel,
        token
      })
    }
  );

export const fetchPermissions = (
  directoryName: string,
  token: string
): Promise<PermissionsResponse> =>
  request<PermissionsResponse>(
    `jlab-examples/permissions?directory=${encodeURIComponent(directoryName)}`,
    { method: 'GET' },
    token
  );

export const fetchPermissionsByVolume = (
  volumeName: string,
  token: string
): Promise<PermissionsResponse> =>
  request<PermissionsResponse>(
    `jlab-examples/permissions?volume_name=${encodeURIComponent(volumeName)}`,
    { method: 'GET' },
    token
  );

export const revokeAccess = (
  volumeName: string,
  userEmail: string,
  token: string
): Promise<{ message: string }> =>
  request<{ message: string }>(
    'jlab-examples/permissions',
    {
      method: 'DELETE',
      body: JSON.stringify({
        volume_name: volumeName,
        user_email: userEmail,
        token
      })
    }
  );

export const setGeneralAccess = (
  volumeName: string,
  generalAccess: GeneralAccess,
  linkAccessLevel: AccessLevel,
  token: string
): Promise<{ volume_name: string; general_access: GeneralAccess; link_access_level: AccessLevel }> =>
  request(
    `jlab-examples/general-access/${encodeURIComponent(volumeName)}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        general_access: generalAccess,
        link_access_level: linkAccessLevel,
        token
      })
    }
  );

export const acceptShare = (volumeName: string, token: string): Promise<{ message: string }> =>
  request<{ message: string }>(
    `jlab-examples/accept/${encodeURIComponent(volumeName)}`,
    { method: 'POST' },
    token
  );

export const fetchMyShares = (token: string): Promise<{ shares: ShareSummary[] }> =>
  request<{ shares: ShareSummary[] }>('jlab-examples/my-shares', { method: 'GET' }, token);

export interface MeResponse {
  email: string;
  domain: string;
}

export const fetchMe = async (): Promise<MeResponse | null> => {
  try {
    const response = await ServerConnection.makeRequest(
      `${settings.baseUrl}jlab-examples/me`,
      {},
      settings
    );
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as MeResponse;
  } catch {
    return null;
  }
};

export const buildShareLink = (volumeName: string): string => {
  // Use user-redirect so any authenticated user lands in their own lab pod;
  // the extension picks up ?share-link=<volume_name> on startup and accepts.
  const origin = window.location.origin;
  return `${origin}/hub/user-redirect/lab?share-link=${encodeURIComponent(volumeName)}`;
};
