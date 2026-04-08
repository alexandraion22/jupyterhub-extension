import { ServerConnection } from '@jupyterlab/services';

const settings = ServerConnection.makeSettings();

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

export const shareFolder = async (
  directoryName: string,
  shareWithUser: string,
  accessRights: string,
  token: string
): Promise<{ message: string; volume_name: string }> => {
  const response = await ServerConnection.makeRequest(
    `${settings.baseUrl}jlab-examples/share`,
    {
      method: 'POST',
      body: JSON.stringify({
        directory_name: directoryName,
        share_with_user: shareWithUser,
        access_rights: accessRights,
        token: token
      })
    },
    settings
  );

  const data = await response.json();
  if (!response.ok) {
    const msg = data?.error?.message || data?.error || response.statusText;
    throw new Error(msg);
  }
  return data;
};

export interface Permission {
  user_email: string;
  access_level: string;
  created_at: string | null;
}

export interface PermissionsResponse {
  volume_name: string;
  display_name: string;
  owner: string;
  permissions: Permission[];
}

export const fetchPermissions = async (
  directoryName: string,
  token: string
): Promise<PermissionsResponse> => {
  const response = await ServerConnection.makeRequest(
    `${settings.baseUrl}jlab-examples/permissions?directory=${encodeURIComponent(directoryName)}`,
    {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    },
    settings
  );

  const data = await response.json();
  if (!response.ok) {
    const msg = data?.error?.message || data?.error || response.statusText;
    throw new Error(msg);
  }
  return data;
};

export const revokeAccess = async (
  volumeName: string,
  userEmail: string,
  token: string
): Promise<{ message: string }> => {
  const response = await ServerConnection.makeRequest(
    `${settings.baseUrl}jlab-examples/permissions`,
    {
      method: 'DELETE',
      body: JSON.stringify({
        volume_name: volumeName,
        user_email: userEmail,
        token: token
      })
    },
    settings
  );

  const data = await response.json();
  if (!response.ok) {
    const msg = data?.error?.message || data?.error || response.statusText;
    throw new Error(msg);
  }
  return data;
};
