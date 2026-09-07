/** 2026-09-07 wording review: most clients are one business under one
 * name, so the chooser must not show or read that name twice per row. */
import { membershipA1 } from '../../auth/__tests__/fixtures';
import { chooserDetail, chooserLabel } from '../views/ScopeChooserView';

const same = {
  ...membershipA1,
  clientName: 'Harbor Light Bakery LLC',
  entityName: 'Harbor Light Bakery LLC',
};
const differs = {
  ...membershipA1,
  clientName: 'Harbor Light Group',
  entityName: 'Harbor Light Bakery LLC',
};

describe('workspace chooser rows', () => {
  it('reads the name once when the business and its entity share it', () => {
    expect(chooserLabel(same)).toBe('Harbor Light Bakery LLC, Client access');
    expect(chooserDetail(same)).toBe('Client access');
  });

  it('keeps both names when they differ', () => {
    expect(chooserLabel(differs)).toBe(
      'Harbor Light Group, Harbor Light Bakery LLC, Client access',
    );
    expect(chooserDetail(differs)).toBe('Harbor Light Group · Client access');
  });
});
