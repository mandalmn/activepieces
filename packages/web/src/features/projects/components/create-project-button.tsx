import { ProjectWithLimits } from '@activepieces/shared';
import { t } from 'i18next';
import { Plus } from 'lucide-react';

import { AnimatedIconButton } from '@/components/custom/animated-icon-button';
import { PlusIcon } from '@/components/icons/plus';
import { Button } from '@/components/ui/button';
import { SidebarMenuButton } from '@/components/ui/sidebar-shadcn';
import { cn } from '@/lib/utils';

import { NewProjectDialog } from './new-project-dialog';

export function CreateProjectButton({
  variant,
  onCreate,
  className,
}: CreateProjectButtonProps) {
  const trigger = triggerFor({ variant, className });

  return <NewProjectDialog onCreate={onCreate}>{trigger}</NewProjectDialog>;
}

function triggerFor({ variant, className, onClick }: TriggerForParams) {
  switch (variant) {
    case 'icon':
      return (
        <Button
          variant="ghost"
          size="icon"
          className={cn('h-6 w-6 hover:bg-accent', className)}
          onClick={onClick}
        >
          <Plus />
        </Button>
      );
    case 'full':
      return (
        <AnimatedIconButton
          icon={PlusIcon}
          iconSize={16}
          size="sm"
          className={className}
          onClick={onClick}
        >
          {t('New Project')}
        </AnimatedIconButton>
      );
    case 'sidebar-menu':
      return (
        <SidebarMenuButton
          className={cn('text-muted-foreground gap-2', className)}
          onClick={onClick}
        >
          <Plus className="size-4" />
          <span>{t('Add team project')}</span>
        </SidebarMenuButton>
      );
  }
}

type CreateProjectButtonVariant = 'icon' | 'full' | 'sidebar-menu';

type TriggerForParams = {
  variant: CreateProjectButtonVariant;
  className?: string;
  onClick?: () => void;
};

type CreateProjectButtonProps = {
  variant: CreateProjectButtonVariant;
  onCreate?: (project: ProjectWithLimits) => void;
  className?: string;
};
