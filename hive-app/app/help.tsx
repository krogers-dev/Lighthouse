import React from 'react';

import { HelpView } from '@/features/help/HelpView';
import { AuthorizedScreen } from '@/features/shared/AuthorizedScreen';

export default function HelpRoute(): React.JSX.Element {
  // Help is static content shipped with the app: no repository, no network
  // read, so it still works when the server cannot be reached.
  return (
    <AuthorizedScreen current="help" testID="help-screen">
      <HelpView />
    </AuthorizedScreen>
  );
}
