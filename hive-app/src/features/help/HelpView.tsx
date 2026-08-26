/** Help: static, versioned content shipped with the app (WO-002 R4).
 *
 * No remote CMS and no network read — help must work when the rest of the
 * app cannot reach the server, which is exactly when someone needs it.
 * The wording is placeholder pending Stacie's relationship language
 * (D4); the contact route is deliberately described rather than wired,
 * because no support address, phone number, or destination has been
 * approved, and inventing one would be inventing a channel. */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, useThemeColors } from '@/ui';
import { radii, spacing } from '@/ui/tokens';

/** Bumped whenever the content below changes, so a support conversation
 * can establish which help text a given build actually shipped. */
export const HELP_CONTENT_VERSION = '1.0.0';

interface HelpSection {
  id: string;
  /** Written out as a literal so maestro:validate can prove a flow
   * selector matches a testID that really exists (a template literal
   * would defeat that check). */
  testID: string;
  heading: string;
  body: string;
}

const SECTIONS: readonly HelpSection[] = [
  {
    id: 'what-hive-shows',
    testID: 'help-section-what-hive-shows',
    heading: 'What this app shows',
    body: 'HIVE shows the current status of your work with Honeybee Accounting, anything that needs your attention, and who owns the next step. It is a view of that work, not a place to store records.',
  },
  {
    id: 'requests',
    testID: 'help-section-requests',
    heading: 'Requests',
    body: 'Requests are the things Honeybee Accounting is waiting on from you. In this version you can read them here; responding and sending documents are handled the way you do today.',
  },
  {
    id: 'activity',
    testID: 'help-section-activity',
    heading: 'Activity',
    body: 'Activity lists what has happened in this workspace, with the date and the role that acted. It does not list individual people.',
  },
  {
    id: 'workspaces',
    testID: 'help-section-workspaces',
    heading: 'Workspaces',
    body: 'If you are authorized for more than one business, each one is a separate workspace. Switching workspaces changes everything shown in the app; nothing is carried across.',
  },
  {
    id: 'contact',
    testID: 'help-section-contact',
    heading: 'Getting help from a person',
    body: 'For anything that needs a person, contact Honeybee Accounting the way you normally reach your team. Support contact details will be listed here once they are confirmed.',
  },
];

const styles = StyleSheet.create({
  container: { gap: spacing.lg },
  section: {
    borderRadius: radii.md,
    borderWidth: 1,
    padding: spacing.md,
    gap: spacing.xs,
  },
  list: { gap: spacing.sm },
});

export function HelpView(): React.JSX.Element {
  const colors = useThemeColors();
  return (
    <View style={styles.container} testID="help">
      <AppText variant="title" accessibilityRole="header">
        Help
      </AppText>
      <View style={styles.list}>
        {SECTIONS.map((section) => (
          <View
            key={section.id}
            style={[
              styles.section,
              { backgroundColor: colors.surface, borderColor: colors.divider },
            ]}
            testID={section.testID}
          >
            <AppText variant="heading" accessibilityRole="header">
              {section.heading}
            </AppText>
            <AppText variant="body">{section.body}</AppText>
          </View>
        ))}
      </View>
      <AppText variant="caption" tone="secondary" testID="help-version">
        {`Help content version ${HELP_CONTENT_VERSION}`}
      </AppText>
    </View>
  );
}
