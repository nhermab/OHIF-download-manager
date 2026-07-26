import { id } from './id';
import getCommandsModule from './getCommandsModule';
import getPanelModule from './getPanelModule';
import { loadLastDirectoryHandle, state } from './state';
import { setOhifServices } from './ohif-state';
import { isEnabled } from './config';
import './plugin.css';

const downloadManagerExtension = {
  /**
   * Unique identifier across extensions
   */
  id,

  preRegistration({ servicesManager, extensionManager }: any) {
    if (!isEnabled()) {
      return;
    }
    setOhifServices(servicesManager, extensionManager);
    loadLastDirectoryHandle();
  },

  onModeEnter({ servicesManager }: any) {
    if (!isEnabled()) {
      return;
    }
    const { toolbarService } = servicesManager.services;
    if (toolbarService) {
      toolbarService.register([
        {
          id: 'DownloadManager',
          uiType: 'ohif.toolButton',
          props: {
            icon: 'Download',
            label: 'Download',
            tooltip: 'Download DICOM images',
            commands: 'openDownloadManager',
            evaluate: 'evaluate.action',
          },
        },
      ]);
      // Modes own toolbar layout. Registering a button must never replace the
      // host mode's primary toolbar section.
    }
  },

  onModeExit() {
    state.activeAbortController?.abort();
    state.activeAbortController = null;
    state.downloadStats = null;
  },

  getCommandsModule,
  getPanelModule,
};

export default downloadManagerExtension;
