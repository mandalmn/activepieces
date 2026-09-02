import {
  UserInvitation,
  UserStatus,
  UserWithMetaInformation,
} from '@activepieces/shared';
import { t } from 'i18next';
import { User } from 'lucide-react';
import { useMemo, useState } from 'react';

import { DashboardPageHeader } from '@/app/components/dashboard-page-header';
import LockedFeatureGuard from '@/app/components/locked-feature-guard';
import { DataTable } from '@/components/custom/data-table';
import { UserRoundPlusIcon } from '@/components/icons/user-round-plus';
import { Button } from '@/components/ui/button';
import { internalErrorToast } from '@/components/ui/sonner';
import { InviteUserDialog } from '@/features/members';
import {
  platformUserHooks,
  platformUserMutations,
} from '@/features/platform-admin/hooks/platform-user-hooks';
import { platformHooks } from '@/hooks/platform-hooks';

import { UserActions } from './actions/user-actions';
import { createUsersTableColumns } from './columns';

export type UserRowData =
  | {
      id: string;
      type: 'user';
      data: UserWithMetaInformation;
    }
  | {
      id: string;
      type: 'invitation';
      data: UserInvitation;
    };

export default function UsersPage() {
  const [inviteOpen, setInviteOpen] = useState(false);

  const {
    data: usersData,
    isLoading: usersLoading,
    refetch: refetchUsers,
  } = platformUserHooks.useUsers();

  const {
    data: invitationsData,
    isLoading: invitationsLoading,
    refetch: refetchInvitations,
  } = platformUserHooks.usePlatformInvitations();

  const refetch = () => {
    refetchUsers();
    refetchInvitations();
  };

  const combinedData: UserRowData[] = useMemo(() => {
    const users: UserRowData[] =
      usersData?.data?.map((user) => ({
        id: user.id,
        type: 'user' as const,
        data: user,
      })) ?? [];

    const pendingInvitations: UserRowData[] =
      invitationsData?.map((invitation) => ({
        id: invitation.id,
        type: 'invitation' as const,
        data: invitation,
      })) ?? [];

    return [...users, ...pendingInvitations];
  }, [usersData, invitationsData]);

  const isLoading = usersLoading || invitationsLoading;

  const { platform } = platformHooks.useCurrentPlatform();

  const { mutate: transferOwnership, isPending: isTransferringOwnership } =
    platformUserMutations.useTransferOwnership({
      platformId: platform.id,
      onSuccess: refetch,
    });

  const { mutate: deleteUser } = platformUserMutations.useDeleteUser({
    onSuccess: refetch,
  });

  const { mutate: deleteInvitation } =
    platformUserMutations.useDeleteInvitation({ onSuccess: refetch });

  const { mutate: updateUserStatus, isPending: isUpdatingStatus } =
    platformUserMutations.useUpdateUserStatus({
      onSuccess: refetch,
      onError: () => {
        internalErrorToast();
      },
    });

  const handleDelete = (id: string, isInvitation: boolean) => {
    if (isInvitation) {
      deleteInvitation(id);
    } else {
      deleteUser(id);
    }
  };

  const handleToggleStatus = (userId: string, currentStatus: UserStatus) => {
    updateUserStatus({
      userId,
      status:
        currentStatus === UserStatus.ACTIVE
          ? UserStatus.INACTIVE
          : UserStatus.ACTIVE,
    });
  };

  const columns = createUsersTableColumns();

  return (
    <LockedFeatureGuard
      locked={false}
      lockTitle={t('Unlock Users')}
      lockDescription={t('Manage your users and their access to your projects')}
    >
      <div className="flex flex-col w-full">
        <DashboardPageHeader
          title={t('Users')}
          description={t(
            'Manage, delete, activate and deactivate users on platform',
          )}
        />
        <DataTable
          emptyStateTextTitle={t('No users found')}
          emptyStateTextDescription={t('Start inviting users to your project')}
          emptyStateIcon={<User className="size-14" />}
          columns={columns}
          page={{
            data: combinedData,
            next: usersData?.next || null,
            previous: usersData?.previous || null,
          }}
          hidePagination={true}
          isLoading={isLoading}
          toolbarButtons={[
            <Button
              key="invite"
              className="gap-2"
              size="sm"
              onClick={() => setInviteOpen(true)}
            >
              <UserRoundPlusIcon size={16} />
              <span className="text-sm font-medium">{t('Invite')}</span>
            </Button>,
          ]}
          actions={[
            (row) => (
              <UserActions
                row={row}
                isUpdatingStatus={isUpdatingStatus}
                onDelete={handleDelete}
                onToggleStatus={handleToggleStatus}
                onUpdate={refetch}
                onMakeOwner={transferOwnership}
                isCurrentOwner={
                  row.type !== 'invitation' && row.data.id === platform.ownerId
                }
                isTransferringOwnership={isTransferringOwnership}
              />
            ),
          ]}
        />
      </div>
      <InviteUserDialog
        open={inviteOpen}
        setOpen={setInviteOpen}
        onInviteSuccess={refetch}
      />
    </LockedFeatureGuard>
  );
}
