/**
 * Copyright (c) 2026 Nick Hermans (UZ Leuven)
 * SPDX-License-Identifier: MIT
 */

import type { Types } from '@ohif/core';
import DownloadManagerModal from './components/DownloadManagerModal';
import { isEnabled } from './config';

export default function getCommandsModule({
  servicesManager,
}: Types.Extensions.ExtensionParams): Types.Extensions.CommandsModule {
  const actions = {
    openDownloadManager: () => {
      if (!isEnabled()) {
        return;
      }
      const { displaySetService, uiNotificationService, uiModalService } = servicesManager.services;
      const displaySets = displaySetService?.getActiveDisplaySets?.() || [];

      if (!displaySets.length) {
        uiNotificationService?.show?.({
          title: 'Download Manager',
          message: 'No study is currently available to download.',
          type: 'info',
          duration: 4000,
        });
        return;
      }

      if (uiModalService) {
        uiModalService.show({
          title: 'Download Medical Images',
          content: DownloadManagerModal,
          contentProps: {
            servicesManager,
            hideModal: () => uiModalService.hide(),
          },
          containerClassName:
            'w-[min(96vw,1024px)] max-w-5xl h-[90vh] max-h-[900px] overflow-hidden p-4 sm:p-6',
        });
      }
    },
  };

  return {
    actions,
    definitions: {
      openDownloadManager: {
        commandFn: actions.openDownloadManager,
        storeContexts: [],
        options: {},
      },
    },
    defaultContext: 'DEFAULT',
  };
}
