import React from 'react';

import { useAuthState } from '@/auth/provider';
import { guardRedirect } from '@/auth/route-guard';
import { AppText, Notice, Screen } from '@/ui';

export default function FatalRoute(): React.JSX.Element {
  const state = useAuthState();
  const redirect = guardRedirect(state, 'fatal');
  if (redirect) return redirect;
  return (
    <Screen testID="fatal-screen">
      <AppText variant="title" accessibilityRole="header">
        HIVE
      </AppText>
      <Notice
        tone="danger"
        title="HIVE stopped to keep your information safe"
        body="An unrecoverable problem occurred. Close the app fully and open it again. If this keeps happening, contact Honeybee Accounting."
      />
    </Screen>
  );
}
