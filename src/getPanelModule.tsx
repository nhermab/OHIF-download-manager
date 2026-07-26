import React from 'react';
import DownloadManagerPanel from './components/DownloadManagerPanel';

export default function getPanelModule({
  commandsManager,
  extensionManager,
  servicesManager,
}: any) {
  return [
    {
      name: 'downloadManager',
      iconName: 'tab-download',
      iconLabel: 'Download',
      label: 'Download Manager',
      component: (props: any) => (
        <DownloadManagerPanel
          {...props}
          servicesManager={servicesManager}
          commandsManager={commandsManager}
        />
      ),
    },
  ];
}
