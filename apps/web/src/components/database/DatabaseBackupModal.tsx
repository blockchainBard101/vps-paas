'use client';

import React from 'react';
import { DatabaseSettingsModal, DatabaseSettingsModalProps } from './DatabaseSettingsModal';

export type { DatabaseSettingsModalProps as DatabaseBackupModalProps };

export function DatabaseBackupModal(props: DatabaseSettingsModalProps) {
  return <DatabaseSettingsModal {...props} />;
}
